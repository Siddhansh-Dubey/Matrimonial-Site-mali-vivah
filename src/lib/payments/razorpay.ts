import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Razorpay helpers — server-side only. We call the REST API directly (Basic
 * auth, no SDK) exactly as documented:
 *   POST https://api.razorpay.com/v1/orders   (Basic key_id:key_secret)
 *   signature = HMAC_SHA256(secret, "<order_id>|<payment_id>")
 *   webhook signature = HMAC_SHA256(webhook_secret, raw_body) in
 *   the `X-Razorpay-Signature` header.
 *
 * The browser NEVER supplies an amount — the order route reads price_inr
 * from public.packages. The client NEVER activates a subscription itself;
 * only the webhook/verify routes do, after signature verification.
 *
 * Env:
 *   RAZORPAY_KEY_ID          — public key id (returned to the client to open checkout)
 *   RAZORPAY_KEY_SECRET      — API secret (never leaves the server)
 *   RAZORPAY_WEBHOOK_SECRET  — webhook signing secret (optional but recommended)
 */

export function razorpayKeyId(): string {
  const key = process.env.RAZORPAY_KEY_ID
  if (!key) throw new Error('RAZORPAY_KEY_ID is not set')
  return key
}

function razorpayKeySecret(): string {
  const key = process.env.RAZORPAY_KEY_SECRET
  if (!key) throw new Error('RAZORPAY_KEY_SECRET is not set')
  return key
}

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

export type RazorpayOrder = {
  id: string
  amount: number
  currency: string
  status: string
  receipt?: string | null
}

/** Create a Razorpay order for `amountInr` whole rupees. */
export async function createRazorpayOrder(input: {
  amountInr: number
  receipt: string
  notes?: Record<string, string>
}): Promise<RazorpayOrder> {
  const auth = Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(input.amountInr * 100), // paise
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  })
  const body = (await res.json().catch(() => null)) as
    | (RazorpayOrder & { error?: { description?: string; code?: string } })
    | null
  if (!res.ok || !body?.id) {
    const msg = body?.error?.description ?? `Razorpay order creation failed (HTTP ${res.status})`
    throw new Error(msg)
  }
  return body
}

/** Constant-time hex compare. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** Verify the checkout signature returned by Razorpay Standard Checkout. */
export function verifyCheckoutSignature(input: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  const expected = createHmac('sha256', razorpayKeySecret())
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex')
  return safeEqualHex(expected, input.signature.toLowerCase())
}

/** Verify the webhook signature over the RAW request body. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return safeEqualHex(expected, signature.toLowerCase())
}
