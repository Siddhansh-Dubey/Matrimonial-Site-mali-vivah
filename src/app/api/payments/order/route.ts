import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  razorpayKeyId,
} from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

type OrderBody = {
  packageId?: unknown
  packageSlug?: unknown
  item?: unknown
  idempotencyKey?: unknown
}

type ExistingPayment = {
  id: string
  kind: 'package' | 'boost'
  status: string
  amount_inr: number
  razorpay_order_id: string | null
  package_id: number | null
  package_slug: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requestKey(req: Request, body: OrderBody): string {
  const candidate = text(req.headers.get('x-idempotency-key')) ?? text(body.idempotencyKey)
  // A missing key is still safe: it scopes one server request. The UI sends a
  // stable key while it is retrying so a lost response cannot create another
  // Razorpay order.
  return (candidate ?? randomUUID()).slice(0, 128)
}

function orderResponse(input: {
  orderId: string
  amountInr: number
  item: 'package' | 'boost'
  packageName?: string
  packageSlug?: string
  itemName?: string
  profile: { full_name: string; email: string; mobile: string | null }
}) {
  return {
    keyId: razorpayKeyId(),
    orderId: input.orderId,
    amount: input.amountInr * 100,
    currency: 'INR',
    item: input.item,
    packageName: input.packageName,
    packageSlug: input.packageSlug,
    itemName: input.itemName,
    prefill: {
      name: input.profile.full_name,
      email: input.profile.email,
      contact: input.profile.mobile ?? '',
    },
  }
}

async function findExisting(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  key: string,
  kind: 'package' | 'boost'
): Promise<ExistingPayment | null> {
  const { data } = await admin
    .from('payments')
    .select('id, kind, status, amount_inr, razorpay_order_id, package_id, package_slug')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('idempotency_key', key)
    .maybeSingle()
  return (data as ExistingPayment | null) ?? null
}

function existingError(payment: ExistingPayment): NextResponse {
  if (payment.status === 'created' || payment.status === 'authorized') {
    return NextResponse.json(
      { error: 'The payment attempt is still in progress. Refresh and continue the existing checkout.' },
      { status: 409 }
    )
  }
  if (payment.status === 'captured') {
    return NextResponse.json({ error: 'This payment has already been completed.' }, { status: 409 })
  }
  return NextResponse.json({ error: 'This payment attempt is no longer available. Start a new checkout.' }, { status: 409 })
}

/**
 * Creates a Razorpay order from a database package/config snapshot. The
 * browser sends only an item selector and an opaque retry key; amount,
 * currency, duration and activation are all server/database controlled.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })
  }
  if (!isRazorpayConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not enabled yet. Please contact support.' },
      { status: 503 }
    )
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Please sign in to purchase.' }, { status: 401 })
  }

  let body: OrderBody
  try {
    body = (await req.json()) as OrderBody
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, mobile, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.is_active !== true) {
    return NextResponse.json({ error: 'This account cannot start a payment.' }, { status: 403 })
  }

  try {
    await admin.rpc('cancel_stale_payments')
  } catch {
    // Housekeeping is best effort; it never changes the authority of a new
    // order and a failed sweep must not make checkout unavailable.
  }

  const suppliedKey = text(req.headers.get('x-idempotency-key')) ?? text(body.idempotencyKey)
  if (suppliedKey && (suppliedKey.length < 8 || suppliedKey.length > 128)) {
    return NextResponse.json({ error: 'Invalid idempotency key.' }, { status: 400 })
  }
  if (body.item !== undefined && body.item !== 'package' && body.item !== 'boost') {
    return NextResponse.json({ error: 'Invalid payment item.' }, { status: 400 })
  }
  const key = requestKey(req, body)
  const isBoost = body.item === 'boost'

  if (isBoost) {
    const existing = await findExisting(admin, user.id, key, 'boost')
    if (existing) {
      if ((existing.status === 'created' || existing.status === 'authorized') && existing.razorpay_order_id) {
        return NextResponse.json(orderResponse({
          orderId: existing.razorpay_order_id,
          amountInr: existing.amount_inr,
          item: 'boost',
          itemName: 'Profile Boost',
          profile,
        }))
      }
      return existingError(existing)
    }

    const { data: boostCfg } = await admin
      .from('profile_boost_config')
      .select('price_inr, duration_days, is_active')
      .eq('id', 1)
      .maybeSingle()
    if (!boostCfg || boostCfg.is_active !== true) {
      return NextResponse.json({ error: 'Boost purchases are not available right now.' }, { status: 404 })
    }

    const { data: activeBoost } = await admin
      .from('profile_boosts')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
    if ((activeBoost?.length ?? 0) > 0) {
      return NextResponse.json(
        { error: 'A boost is already active on your profile. You can buy another once it ends.' },
        { status: 409 }
      )
    }

    const { data: payment, error: insertError } = await admin
      .from('payments')
      .insert({
        user_id: user.id,
        kind: 'boost',
        amount_inr: boostCfg.price_inr,
        duration_days: boostCfg.duration_days,
        status: 'created',
        idempotency_key: key,
        metadata: { item: 'boost' },
      })
      .select('id')
      .single()
    if (insertError || !payment) {
      const retry = await findExisting(admin, user.id, key, 'boost')
      return retry ? existingError(retry) : NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 500 })
    }

    try {
      const order = await createRazorpayOrder({
        amountInr: boostCfg.price_inr,
        receipt: payment.id,
        notes: { item: 'boost' },
      })
      const { error: saveError } = await admin
        .from('payments')
        .update({ razorpay_order_id: order.id })
        .eq('id', payment.id)
      if (saveError) throw new Error('Could not save the payment order')

      return NextResponse.json(orderResponse({
        orderId: order.id,
        amountInr: boostCfg.price_inr,
        item: 'boost',
        itemName: `Profile Boost · ${boostCfg.duration_days} days`,
        profile,
      }))
    } catch (err) {
      await admin
        .from('payments')
        .update({ status: 'failed', failure_reason: 'Razorpay order creation failed' })
        .eq('id', payment.id)
        .in('status', ['created', 'authorized'])
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Could not create the order.' },
        { status: 502 }
      )
    }
  }

  const rawPackageId = body.packageId
  const packageId = rawPackageId === undefined || rawPackageId === null || rawPackageId === ''
    ? null
    : Number(rawPackageId)
  const packageSlug = text(body.packageSlug)
  if (packageId !== null && (!Number.isSafeInteger(packageId) || packageId <= 0)) {
    return NextResponse.json({ error: 'Invalid package.' }, { status: 400 })
  }
  if (packageId === null && !packageSlug) {
    return NextResponse.json({ error: 'Choose a package to purchase.' }, { status: 400 })
  }

  let pkgQuery = admin.from('packages').select('*').eq('is_active', true)
  pkgQuery = packageId !== null ? pkgQuery.eq('id', packageId) : pkgQuery.eq('slug', packageSlug as string)
  const { data: pkg, error: pkgError } = await pkgQuery.maybeSingle()
  if (pkgError || !pkg) {
    return NextResponse.json({ error: 'That package is not available.' }, { status: 404 })
  }
  if (packageSlug && packageSlug !== pkg.slug) {
    return NextResponse.json({ error: 'Package selector mismatch.' }, { status: 400 })
  }

  const existing = await findExisting(admin, user.id, key, 'package')
  if (existing) {
    if (
      (existing.status === 'created' || existing.status === 'authorized') &&
      existing.razorpay_order_id &&
      existing.package_id === pkg.id
    ) {
      return NextResponse.json(orderResponse({
        orderId: existing.razorpay_order_id,
        amountInr: existing.amount_inr,
        item: 'package',
        packageName: pkg.name,
        packageSlug: pkg.slug,
        profile,
      }))
    }
    return existingError(existing)
  }

  const { data: payment, error: insertError } = await admin
    .from('payments')
    .insert({
      user_id: user.id,
      package_id: pkg.id,
      package_slug: pkg.slug,
      amount_inr: pkg.price_inr,
      duration_days: pkg.duration_days,
      status: 'created',
      idempotency_key: key,
      metadata: {},
    })
    .select('id')
    .single()
  if (insertError || !payment) {
    const retry = await findExisting(admin, user.id, key, 'package')
    return retry ? existingError(retry) : NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 500 })
  }

  try {
    const order = await createRazorpayOrder({
      amountInr: pkg.price_inr,
      receipt: payment.id,
      notes: { item: 'package', package_slug: pkg.slug },
    })
    const { error: saveError } = await admin
      .from('payments')
      .update({ razorpay_order_id: order.id })
      .eq('id', payment.id)
    if (saveError) throw new Error('Could not save the payment order')

    return NextResponse.json(orderResponse({
      orderId: order.id,
      amountInr: pkg.price_inr,
      item: 'package',
      packageName: pkg.name,
      packageSlug: pkg.slug,
      profile,
    }))
  } catch (err) {
    await admin
      .from('payments')
      .update({ status: 'failed', failure_reason: 'Razorpay order creation failed' })
      .eq('id', payment.id)
      .in('status', ['created', 'authorized'])
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not create the order.' },
      { status: 502 }
    )
  }
}
