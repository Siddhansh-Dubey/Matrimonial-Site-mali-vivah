import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import {
  fetchRazorpayPayment,
  isRazorpayConfigured,
  verifyCheckoutSignature,
} from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

function validValue(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/**
 * Verifies the browser return from Razorpay. A valid HMAC is necessary but not
 * sufficient: the server also checks the provider payment's order, amount,
 * currency and capture state against the local payment attempt before calling
 * the service-role activation RPC.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured || !isRazorpayConfigured()) {
    return NextResponse.json({ error: 'Payments are not enabled.' }, { status: 503 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }

  let body: {
    razorpay_order_id?: unknown
    razorpay_payment_id?: unknown
    razorpay_signature?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const orderId = body.razorpay_order_id
  const paymentId = body.razorpay_payment_id
  const signature = body.razorpay_signature
  if (!validValue(orderId) || !validValue(paymentId) || !validValue(signature, 256)) {
    return NextResponse.json({ error: 'Missing payment details.' }, { status: 400 })
  }
  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
    return NextResponse.json(
      { error: 'Payment verification failed. If you were charged, it will be refunded automatically.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data: payment, error: findError } = await admin
    .from('payments')
    .select('id, user_id, package_id, package_slug, amount_inr, currency, status, kind, razorpay_payment_id, razorpay_order_id')
    .eq('razorpay_order_id', orderId)
    .maybeSingle()
  if (findError || !payment || payment.user_id !== user.id) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }
  if (payment.razorpay_payment_id && payment.razorpay_payment_id !== paymentId) {
    return NextResponse.json({ error: 'Payment identity conflict.' }, { status: 409 })
  }
  if (payment.status === 'refunded' || payment.status === 'failed' || payment.status === 'cancelled') {
    return NextResponse.json({ error: 'This payment attempt is no longer payable.' }, { status: 409 })
  }

  let providerPayment: Awaited<ReturnType<typeof fetchRazorpayPayment>>
  try {
    providerPayment = await fetchRazorpayPayment(paymentId)
  } catch {
    return NextResponse.json({ error: 'Payment confirmation is still pending. Please retry shortly.' }, { status: 202 })
  }

  const providerCaptured = providerPayment.status === 'captured' || providerPayment.captured === true
  const providerAuthorized = providerPayment.status === 'authorized'
  if (
    providerPayment.id !== paymentId ||
    providerPayment.order_id !== orderId ||
    providerPayment.amount !== payment.amount_inr * 100 ||
    providerPayment.currency !== payment.currency
  ) {
    return NextResponse.json({ error: 'Payment/order details do not match this checkout.' }, { status: 400 })
  }
  if (!providerCaptured && !providerAuthorized) {
    return NextResponse.json({ error: 'Razorpay has not captured this payment.' }, { status: 409 })
  }

  const { error: identityError } = await admin
    .from('payments')
    .update({
      razorpay_payment_id: paymentId,
      ...(providerAuthorized && !providerCaptured ? { status: 'authorized' as const } : {}),
    })
    .eq('id', payment.id)
    .in('status', ['created', 'authorized', 'captured'])
  if (identityError) {
    return NextResponse.json({ error: 'Could not record payment confirmation.' }, { status: 500 })
  }

  if (providerAuthorized && !providerCaptured) {
    return NextResponse.json({ status: 'pending', kind: payment.kind ?? 'package' }, { status: 202 })
  }

  // The RPC re-checks local ownership, package identity and status under a
  // transaction lock. Calling it on every retry repairs a captured payment if
  // a webhook/verify request previously ended after the provider capture but
  // before entitlement creation.
  const isBoost = payment.kind === 'boost'
  const { data: activation, error: activationError } = isBoost
    ? await admin.rpc('activate_boost_purchase', { p_payment_id: payment.id })
    : payment.package_id != null
      ? await admin.rpc('activate_membership', {
          p_user_id: payment.user_id,
          p_package_id: payment.package_id,
          p_payment_id: payment.id,
        })
      : { data: null, error: { message: 'Payment has no authoritative package relationship' } }

  if (activationError) {
    return NextResponse.json(
      { error: 'Payment was captured but activation is pending. Please refresh shortly.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ status: 'ok', activation, kind: payment.kind ?? 'package' })
}
