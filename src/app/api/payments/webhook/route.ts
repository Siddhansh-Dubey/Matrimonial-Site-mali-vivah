import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { isRazorpayWebhookConfigured, verifyWebhookSignature } from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

type PaymentEntity = {
  id?: unknown
  order_id?: unknown
  status?: unknown
  captured?: unknown
  amount?: unknown
  currency?: unknown
  error_description?: unknown
}

type WebhookEvent = {
  event?: unknown
  payload?: {
    payment?: { entity?: PaymentEntity }
    refund?: { entity?: { id?: unknown; payment_id?: unknown; amount?: unknown; currency?: unknown } }
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function eventIdentity(req: Request, raw: string): string {
  const header = stringValue(req.headers.get('x-razorpay-event-id'))
  return header && header.length <= 200
    ? header
    : `body:${createHash('sha256').update(raw, 'utf8').digest('hex')}`
}

async function rememberEvent(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  eventType: string,
  orderId: string | null,
  paymentId: string | null
) {
  const { error } = await admin.from('payment_webhook_events').upsert(
    {
      event_id: eventId,
      event_type: eventType,
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
    },
    { onConflict: 'event_id', ignoreDuplicates: true }
  )
  if (error) throw new Error('Webhook replay ledger write failed')
}

/**
 * Razorpay's signed webhook is authoritative for provider state. Invalid or
 * malformed requests are rejected; valid duplicate deliveries are harmless.
 * Only known local order/payment identities can mutate local financial state.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured || !isRazorpayWebhookConfigured()) {
    return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 })
  }

  const raw = await req.text()
  if (raw.length === 0 || raw.length > 1_000_000) {
    return NextResponse.json({ error: 'Malformed webhook.' }, { status: 400 })
  }
  const signature = req.headers.get('x-razorpay-signature')
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 })
  }

  let event: WebhookEvent
  try {
    event = JSON.parse(raw) as WebhookEvent
  } catch {
    return NextResponse.json({ error: 'Malformed webhook JSON.' }, { status: 400 })
  }

  const type = stringValue(event.event)
  if (!type) return NextResponse.json({ error: 'Webhook event type is required.' }, { status: 400 })

  const admin = createAdminClient()
  const id = eventIdentity(req, raw)
  const { data: prior } = await admin
    .from('payment_webhook_events')
    .select('event_id')
    .eq('event_id', id)
    .maybeSingle()
  if (prior) return NextResponse.json({ status: 'already_processed' }, { status: 200 })

  const paymentEntity = event.payload?.payment?.entity
  const paymentId = stringValue(paymentEntity?.id)
  const orderId = stringValue(paymentEntity?.order_id)

  if (type === 'payment.captured') {
    if (
      !paymentId ||
      !orderId ||
      paymentEntity?.status !== 'captured' ||
      typeof paymentEntity.amount !== 'number' ||
      typeof paymentEntity.currency !== 'string'
    ) {
      return NextResponse.json({ error: 'Malformed captured event.' }, { status: 400 })
    }
    const { data: payment } = await admin
      .from('payments')
      .select('id, user_id, package_id, amount_inr, currency, status, kind, razorpay_payment_id')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()
    if (!payment) {
      // The provider can deliver immediately after order creation. Do not
      // permanently consume an event before the local order write is visible.
      return NextResponse.json({ status: 'pending_local_order' }, { status: 202 })
    }
    if (payment.razorpay_payment_id && payment.razorpay_payment_id !== paymentId) {
      return NextResponse.json({ error: 'Payment identity conflict.' }, { status: 409 })
    }
    if (
      paymentEntity.amount !== payment.amount_inr * 100 ||
      paymentEntity.currency !== payment.currency
    ) {
      return NextResponse.json({ error: 'Webhook amount or currency mismatch.' }, { status: 400 })
    }
    if (payment.status !== 'refunded' && payment.status !== 'failed' && payment.status !== 'cancelled') {
      const { error: saveError } = await admin
        .from('payments')
        .update({ razorpay_payment_id: paymentId })
        .eq('id', payment.id)
        .in('status', ['created', 'authorized', 'captured'])
      if (saveError) return NextResponse.json({ error: 'Could not record payment.' }, { status: 500 })

      // A deleted account is deliberately retained as an orphaned ledger row.
      // Marking the provider payment captured is safe; activation is not.
      if (payment.user_id) {
        const { error: activationError } = payment.kind === 'boost'
          ? await admin.rpc('activate_boost_purchase', { p_payment_id: payment.id })
          : payment.package_id != null
            ? await admin.rpc('activate_membership', {
                p_user_id: payment.user_id,
                p_package_id: payment.package_id,
                p_payment_id: payment.id,
              })
            : { error: { message: 'missing package relationship' } }
        if (activationError) {
          return NextResponse.json({ error: 'Payment captured but activation is pending.' }, { status: 500 })
        }
      } else {
        const { error: captureError } = await admin
          .from('payments')
          .update({ status: 'captured' })
          .eq('id', payment.id)
          .in('status', ['created', 'authorized', 'captured'])
        if (captureError) return NextResponse.json({ error: 'Could not record orphaned payment.' }, { status: 500 })
      }
    }
    await rememberEvent(admin, id, type, orderId, paymentId)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  if (type === 'payment.failed') {
    if (
      !paymentId ||
      !orderId ||
      paymentEntity?.status !== 'failed' ||
      typeof paymentEntity.amount !== 'number' ||
      typeof paymentEntity.currency !== 'string'
    ) {
      return NextResponse.json({ error: 'Malformed failed event.' }, { status: 400 })
    }
    const { data: payment } = await admin
      .from('payments')
      .select('id, user_id, amount_inr, currency, status, razorpay_payment_id')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()
    if (!payment) {
      return NextResponse.json({ status: 'pending_local_order' }, { status: 202 })
    }
    if (payment) {
      if (payment.razorpay_payment_id && payment.razorpay_payment_id !== paymentId) {
        return NextResponse.json({ error: 'Payment identity conflict.' }, { status: 409 })
      }
      if (
        paymentEntity.amount !== payment.amount_inr * 100 ||
        paymentEntity.currency !== payment.currency
      ) {
        return NextResponse.json({ error: 'Webhook amount or currency mismatch.' }, { status: 400 })
      }
      const { error } = await admin
        .from('payments')
        .update({
          razorpay_payment_id: paymentId,
          failure_reason: 'Razorpay reported payment failure',
          status: 'failed',
        })
        .eq('id', payment.id)
        .in('status', ['created', 'authorized'])
      if (error && payment.status !== 'captured' && payment.status !== 'refunded') {
        return NextResponse.json({ error: 'Could not record failed payment.' }, { status: 500 })
      }
    }
    await rememberEvent(admin, id, type, orderId, paymentId)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  if (type === 'refund.processed') {
    const refund = event.payload?.refund?.entity
    const refundId = stringValue(refund?.id)
    const refundPaymentId = stringValue(refund?.payment_id)
    if (
      !refundId ||
      !refundPaymentId ||
      typeof refund?.amount !== 'number' ||
      typeof refund.currency !== 'string'
    ) {
      return NextResponse.json({ error: 'Malformed refund event.' }, { status: 400 })
    }
    const { data: payment } = await admin
      .from('payments')
      .select('id, amount_inr, currency, razorpay_order_id, razorpay_payment_id, status')
      .eq('razorpay_payment_id', refundPaymentId)
      .maybeSingle()
    if (!payment) {
      return NextResponse.json({ status: 'pending_local_payment' }, { status: 202 })
    }
    if (
      refund.amount !== payment.amount_inr * 100 ||
      refund.currency !== payment.currency
    ) {
      return NextResponse.json({ error: 'Refund amount or currency mismatch.' }, { status: 400 })
    }
    if (payment.status === 'failed' || payment.status === 'cancelled') {
      return NextResponse.json({ error: 'Refund does not reference a refundable payment.' }, { status: 409 })
    }
    const { error } = await admin.rpc('refund_membership', { p_payment_id: payment.id })
    if (error) return NextResponse.json({ error: 'Refund processing is pending.' }, { status: 500 })
    await rememberEvent(admin, id, type, payment.razorpay_order_id, refundPaymentId)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  // Signed but unknown Razorpay event types are retained for replay identity
  // and deliberately do not mutate membership, payment or entitlement state.
  await rememberEvent(admin, id, type, orderId, paymentId)
  return NextResponse.json({ status: 'ignored_event' }, { status: 200 })
}
