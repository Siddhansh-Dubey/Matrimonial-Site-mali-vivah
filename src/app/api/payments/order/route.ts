import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { getSiteConfig } from '@/lib/site-config'
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  razorpayKeyId,
} from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

/**
 * Step 1 of checkout: the signed-in member picks a package SLUG (never an
 * amount). The server reads price_inr from public.packages, creates a
 * payments row ('created') and a matching Razorpay order, then returns
 * everything the browser needs to open Razorpay Standard Checkout.
 *
 * kind: 'boost' buys an à la carte profile boost instead — priced from
 * site_config.boost_price_inr, recorded with package_slug 'profile-boost'
 * and metadata { kind: 'boost' }, activated by activate_purchased_boost().
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
    return NextResponse.json({ error: 'Please sign in to purchase a package.' }, { status: 401 })
  }

  let body: { packageSlug?: string; packageId?: number; kind?: string }
  try {
    body = (await req.json()) as { packageSlug?: string; packageId?: number; kind?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Housekeeping: abandon stale 'created' orders older than 24h so they do
  // not clutter history. Best-effort.
  try {
    await admin.rpc('cancel_stale_payments')
  } catch {
    /* non-fatal */
  }

  // ---- à la carte boost purchase (no package row involved) ----
  if (body.kind === 'boost') {
    return await createBoostOrder(admin, user.id, user.email)
  }

  // Read the package SERVER-SIDE — the client never chooses the amount.
  let pkgQuery = admin
    .from('packages')
    .select('*')
    .eq('is_active', true)
  if (body.packageId && Number.isFinite(body.packageId) && body.packageId > 0) {
    pkgQuery = pkgQuery.eq('id', body.packageId)
  } else if (body.packageSlug) {
    pkgQuery = pkgQuery.eq('slug', body.packageSlug)
  } else {
    return NextResponse.json({ error: 'Choose a package to purchase.' }, { status: 400 })
  }
  const { data: pkg, error: pkgError } = await pkgQuery.maybeSingle()
  if (pkgError || !pkg) {
    return NextResponse.json({ error: 'That package is not available.' }, { status: 404 })
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, mobile')
    .eq('id', user.id)
    .maybeSingle()

  // Create the payments row first — its id becomes the Razorpay receipt.
  const { data: payment, error: insertError } = await admin
    .from('payments')
    .insert({
      user_id: user.id,
      package_id: pkg.id,
      package_slug: pkg.slug,
      amount_inr: pkg.price_inr,
      status: 'created',
    })
    .select('id')
    .single()
  if (insertError || !payment) {
    return NextResponse.json(
      { error: 'Could not start the payment. Please try again.' },
      { status: 500 }
    )
  }

  try {
    const order = await createRazorpayOrder({
      amountInr: pkg.price_inr,
      receipt: payment.id,
      notes: { package_slug: pkg.slug, user_id: user.id },
    })
    await admin
      .from('payments')
      .update({ razorpay_order_id: order.id })
      .eq('id', payment.id)

    return NextResponse.json({
      keyId: razorpayKeyId(),
      orderId: order.id,
      amount: order.amount, // paise, as Razorpay returns
      currency: order.currency,
      packageName: pkg.name,
      packageSlug: pkg.slug,
      prefill: {
        name: profile?.full_name ?? user.email ?? '',
        email: profile?.email ?? user.email ?? '',
        contact: profile?.mobile ?? '',
      },
    })
  } catch (err) {
    // Razorpay rejected the order — mark the row failed so it does not linger.
    await admin
      .from('payments')
      .update({
        status: 'failed',
        failure_reason: err instanceof Error ? err.message : 'order creation failed',
      })
      .eq('id', payment.id)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not create the order.' },
      { status: 502 }
    )
  }
}

/**
 * À la carte boost order. Price comes from site_config (never the client);
 * the payment row carries package_slug 'profile-boost' + metadata.kind so
 * the verify/webhook routes activate a boost instead of a membership.
 */
async function createBoostOrder(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  userEmail: string | undefined
) {
  const config = await getSiteConfig()

  // A running boost makes a second purchase pointless — stop early.
  const { data: alreadyBoosted } = await admin.rpc('has_active_boost', { p_user_id: userId })
  if (alreadyBoosted === true) {
    return NextResponse.json(
      { error: 'Your boost is already running — it cannot be stacked.' },
      { status: 400 }
    )
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, mobile')
    .eq('id', userId)
    .maybeSingle()

  const { data: payment, error: insertError } = await admin
    .from('payments')
    .insert({
      user_id: userId,
      package_id: null,
      package_slug: 'profile-boost',
      amount_inr: config.boostPriceInr,
      status: 'created',
      metadata: { kind: 'boost' },
    })
    .select('id')
    .single()
  if (insertError || !payment) {
    return NextResponse.json(
      { error: 'Could not start the payment. Please try again.' },
      { status: 500 }
    )
  }

  try {
    const order = await createRazorpayOrder({
      amountInr: config.boostPriceInr,
      receipt: payment.id,
      notes: { kind: 'boost', user_id: userId },
    })
    await admin
      .from('payments')
      .update({ razorpay_order_id: order.id })
      .eq('id', payment.id)

    return NextResponse.json({
      keyId: razorpayKeyId(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      kind: 'boost',
      packageName: `Profile Boost · ${config.boostDurationDays} days`,
      packageSlug: 'profile-boost',
      prefill: {
        name: profile?.full_name ?? userEmail ?? '',
        email: profile?.email ?? userEmail ?? '',
        contact: profile?.mobile ?? '',
      },
    })
  } catch (err) {
    await admin
      .from('payments')
      .update({
        status: 'failed',
        failure_reason: err instanceof Error ? err.message : 'order creation failed',
      })
      .eq('id', payment.id)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not create the order.' },
      { status: 502 }
    )
  }
}
