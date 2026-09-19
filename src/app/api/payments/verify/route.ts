import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { isRazorpayConfigured, verifyCheckoutSignature } from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

/**
 * Step 2 of checkout: Razorpay Standard Checkout returns
 * (order_id, payment_id, signature) to the browser. The browser forwards them
 * here; the server re-computes HMAC-SHA256 with the secret and only then
 * activates the membership with activate_membership() (idempotent, also runs
 * from the webhook — whichever arrives first wins).
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
    razorpay_order_id?: string
    razorpay_payment_id?: string
    razorpay_signature?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const orderId = body.razorpay_order_id ?? ''
  const paymentId = body.razorpay_payment_id ?? ''
  const signature = body.razorpay_signature ?? ''
  if (!orderId || !paymentId || !signature) {
    return NextResponse.json({ error: 'Missing payment details.' }, { status: 400 })
  }

  // The signature is verified then DISCARDED — it is never stored (only the
  // secret could have produced it; persisting it proves nothing afterwards).
  const ok = verifyCheckoutSignature({ orderId, paymentId, signature })
  if (!ok) {
    return NextResponse.json(
      { error: 'Payment verification failed. If you were charged, it will be refunded automatically.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data: payment, error: findError } = await admin
    .from('payments')
    .select('id, user_id, package_id, status, kind')
    .eq('razorpay_order_id', orderId)
    .maybeSingle()
  if (findError || !payment) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }
  if (payment.user_id !== user.id) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }

  await admin
    .from('payments')
    .update({ razorpay_payment_id: paymentId })
    .eq('id', payment.id)

  if (payment.status !== 'captured') {
    // Branch on the payment kind — membership vs. standalone boost add-on.
    const isBoost = payment.kind === 'boost'
    const { error: actError } = isBoost
      ? await admin.rpc('activate_boost_purchase', { p_payment_id: payment.id })
      : payment.package_id != null
        ? await admin.rpc('activate_membership', {
            p_user_id: payment.user_id,
            p_package_id: payment.package_id,
            p_payment_id: payment.id,
          })
        : { error: null }
    if (actError) {
      return NextResponse.json(
        { error: 'Payment verified, but activation failed. Please contact support.' },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ status: 'ok', kind: payment.kind ?? 'package' })
}
