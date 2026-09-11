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

/** Static fallback plans shown when the `packages` table is unreachable. */
export function fallbackPackages() {
  return [
    {
      id: -1,
      slug: 'silver-3-month',
      name: 'Silver · 3 Months',
      description: 'View full profiles and express unlimited interests.',
      price_inr: 999,
      duration_days: 90,
      features: [
        'View all profile details (except phone)',
        'Unlimited Express Interest',
        'Shortlist profiles',
        'See who viewed you',
      ],
      is_active: true,
      sort_order: 1,
    },
    {
      id: -2,
      slug: 'gold-6-month',
      name: 'Gold · 6 Months',
      description: 'Our most popular plan for serious families.',
      price_inr: 1799,
      duration_days: 180,
      features: [
        'Everything in Silver',
        'Priority listing of your profile',
        'Mutual-match phone reveal',
        'Featured badge for 30 days',
      ],
      is_active: true,
      sort_order: 2,
    },
    {
      id: -3,
      slug: 'platinum-12-month',
      name: 'Platinum · 12 Months',
      description: 'A full year of stress-free searching.',
      price_inr: 2999,
      duration_days: 365,
      features: [
        'Everything in Gold',
        'Dedicated relationship manager',
        'Profile review assistance',
      ],
      is_active: true,
      sort_order: 3,
    },
  ]
}
