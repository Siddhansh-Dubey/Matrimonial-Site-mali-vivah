import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, SubscriptionRow } from '@/lib/supabase/database.types'

type AnyClient = SupabaseClient<Database>

/**
 * True when `userId` holds ANY active, unexpired subscription.
 * Never throws — a missing `subscriptions` table (migration not applied yet)
 * or any query error is treated as "free".
 */
export async function hasActiveSubscription(
  supabase: AnyClient,
  userId: string | null | undefined
): Promise<boolean> {
  if (!userId) return false
  // Prefer the security-definer RPC (works even if RLS changes), fall back to
  // a direct table read when the RPC is not installed yet.
  try {
    const { data, error } = await supabase.rpc('has_active_subscription', {
      p_user_id: userId,
    })
    if (!error) return data === true
  } catch {
    // ignore — fall through to the table read
  }
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
    if (error) return false
    return (data?.length ?? 0) > 0
  } catch {
    return false
  }
}

/** The viewer's newest live subscription, or null when free / table missing. */
export async function getActiveSubscription(
  supabase: AnyClient,
  userId: string | null | undefined
): Promise<SubscriptionRow | null> {
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return null
    return (data as SubscriptionRow | null) ?? null
  } catch {
    return null
  }
}

/**
 * Emergency fallback shown ONLY when the `packages` table is unreachable
 * (migration not applied, or Supabase is down).
 *
 * The authoritative prices live in the database — see
 * supabase/migrations/20260915020000_packages_pricing.sql:
 *   Smart ₹999/3mo · Premium ₹2,499/6mo · VIP ₹4,999/12mo
 * Keep these in sync with that migration, and never let a purchase use them:
 * `id` is negative so the payment API can reject a plan that did not come from
 * the database.
 */
export function fallbackPackages() {
  return [
    {
      id: -1,
      slug: 'smart-3-month',
      name: 'Smart · 3 Months',
      description: 'Go live in the Mali Vivah directory and start connecting.',
      price_inr: 999,
      duration_days: 90,
      features: [
        'Your profile becomes visible in Brides & Grooms',
        'Appear in search and recommendations',
        'Express interest and receive interests',
        'Daily 5 compatible matches',
      ],
      is_active: true,
      sort_order: 1,
    },
    {
      id: -2,
      slug: 'premium-6-month',
      name: 'Premium · 6 Months',
      description: 'Our most popular plan — more visibility, more connections.',
      price_inr: 2499,
      duration_days: 180,
      features: [
        'Everything in Smart',
        'Advanced search (height, income, native place, lifestyle…)',
        'See who viewed your profile',
        'Featured profile eligibility',
      ],
      is_active: true,
      sort_order: 2,
    },
    {
      id: -3,
      slug: 'vip-12-month',
      name: 'VIP · 12 Months',
      description: 'A full year of priority matchmaking and premium support.',
      price_inr: 4999,
      duration_days: 365,
      features: [
        'Everything in Premium',
        'Priority placement in search and featured sections',
        'Premium verified badge',
        'Dedicated priority support',
      ],
      is_active: true,
      sort_order: 3,
    },
  ]
}
