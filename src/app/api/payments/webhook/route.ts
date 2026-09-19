import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { isRazorpayConfigured, verifyWebhookSignature } from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

/**
 * Razorpay webhook — the AUTHORITATIVE payment signal.
 * Configure in the Razorpay Dashboard → Webhooks:
 *   URL:    https://<your-domain>/api/payments/webhook
 *   Secret: RAZORPAY_WEBHOOK_SECRET
 *   Events: payment.captured, payment.failed, refund.processed
 *
 * The signature covers the RAW body, so we must not re-serialise the JSON.
 * Rejects silently (200) on mismatch so Razorpay retries stop.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured || !isRazorpayConfigured()) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  const raw = await req.text()
  const signature = req.headers.get('x-razorpay-signature')
  if (!verifyWebhookSignature(raw, signature)) {
    // Invalid signature — acknowledge so Razorpay does not retry endlessly.
    return NextResponse.json({ status: 'invalid_signature' }, { status: 200 })
  }

  let event: {
    event?: string
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; status?: string; error_description?: string } }
      refund?: { entity?: { payment_id?: string } }
    }
  }
  try {
    event = JSON.parse(raw) as typeof event
  } catch {
    return NextResponse.json({ status: 'bad_json' }, { status: 200 })
  }

  const admin = createAdminClient()
  const type = event.event
  const paymentEntity = event.payload?.payment?.entity
  const orderId = paymentEntity?.order_id

  if ((type === 'payment.captured' || type === 'payment.failed') && orderId) {
    const { data: payment } = await admin
      .from('payments')
      .select('id, user_id, package_id, status, metadata')
      .eq('razorpay_order_id', orderId)
      .maybeSingle()

    if (payment) {
      if (type === 'payment.captured') {
        if (paymentEntity?.id) {
          await admin
            .from('payments')
            .update({ razorpay_payment_id: paymentEntity.id })
            .eq('id', payment.id)
        }
        const isBoost =
          (payment.metadata as { kind?: string } | null)?.kind === 'boost' || payment.package_id == null
        if (payment.status !== 'captured' && isBoost) {
          await admin.rpc('activate_purchased_boost', {
            p_user_id: payment.user_id,
            p_payment_id: payment.id,
          })
        } else if (payment.status !== 'captured' && payment.package_id != null) {
          await admin.rpc('activate_membership', {
            p_user_id: payment.user_id,
            p_package_id: payment.package_id,
            p_payment_id: payment.id,
          })
        }
      } else {
        await admin
          .from('payments')
          .update({
            status: 'failed',
            razorpay_payment_id: paymentEntity?.id ?? null,
            failure_reason: paymentEntity?.error_description ?? 'payment failed',
          })
          .eq('id', payment.id)
          .neq('status', 'captured')
      }
    }
  }

  if (type === 'refund.processed') {
    const razorpayPaymentId = event.payload?.refund?.entity?.payment_id
    if (razorpayPaymentId) {
      const { data: payment } = await admin
        .from('payments')
        .select('id, metadata, package_id')
        .eq('razorpay_payment_id', razorpayPaymentId)
        .maybeSingle()
      if (payment) {
        const isBoost =
          (payment.metadata as { kind?: string } | null)?.kind === 'boost' || payment.package_id == null
        if (isBoost) {
          // A refunded boost ends immediately — no membership to revoke.
          await admin
            .from('profile_boosts')
            .update({ status: 'cancelled', expires_at: new Date().toISOString() })
            .eq('created_via', `purchase:${payment.id}`)
          await admin
            .from('payments')
            .update({ status: 'refunded' })
            .eq('id', payment.id)
        } else {
          await admin.rpc('refund_membership', { p_payment_id: payment.id })
        }
      }
    }
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
