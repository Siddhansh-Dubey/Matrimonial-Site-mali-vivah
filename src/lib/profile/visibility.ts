import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, InterestStatus } from '@/lib/supabase/database.types'
import { hasActiveSubscription } from '@/lib/profile/subscription'

type AnyClient = SupabaseClient<Database>

/**
 * Visibility rules (single source of truth for masking):
 *  • Free viewer  → only `occupation` + `photo` are visible; everything else masked.
 *  • Paid viewer  → every detail visible EXCEPT the phone number.
 *  • Phone number → visible iff viewer is paid AND interest is mutual.
 *
 * Mutual interest (both bride and groom showed interest) means EITHER:
 *  (a) any row between the pair is `accepted` (A→B accepted, or B→A accepted); OR
 *  (b) BOTH directions hold a live row (pending/accepted each way).
 * Declined / withdrawn rows never count.
 */

export type ProfileVisibility = {
  /** Viewer holds any active package. */
  isPaid: boolean
  /** Both sides showed interest (see above). */
  mutual: boolean
  /** Full profile details (name, age, city, education…) may be shown. = isPaid */
  canSeeDetails: boolean
  /** Phone number may be shown. = isPaid && mutual */
  canSeePhone: boolean
  /** Phone digits when revealable, else null. */
  phone: string | null
}

const LIVE: InterestStatus[] = ['pending', 'accepted']

function rowsMutual(
  forward: { status: InterestStatus } | null,
  reverse: { status: InterestStatus } | null
): boolean {
  if (forward?.status === 'accepted' || reverse?.status === 'accepted') return true
  if (forward && reverse && LIVE.includes(forward.status) && LIVE.includes(reverse.status)) return true
  return false
}

/** Check mutual interest between two users. Never throws (false on error). */
export async function checkMutualInterest(
  supabase: AnyClient,
  viewerId: string,
  targetId: string
): Promise<boolean> {
  if (!viewerId || !targetId || viewerId === targetId) return false
  // Prefer the security-definer RPC, fall back to direct reads.
  try {
    const { data, error } = await supabase.rpc('mutual_interest_exists', {
      p_a: viewerId,
      p_b: targetId,
    })
    if (!error) return data === true
  } catch {
    // ignore — fall through
  }
  try {
    const [fwd, rev] = await Promise.all([
      supabase
        .from('interests')
        .select('status')
        .eq('sender_id', viewerId)
        .eq('receiver_id', targetId)
        .maybeSingle(),
      supabase
        .from('interests')
        .select('status')
        .eq('sender_id', targetId)
        .eq('receiver_id', viewerId)
        .maybeSingle(),
    ])
    if (fwd.error || rev.error) return false
    return rowsMutual(
      fwd.data as { status: InterestStatus } | null,
      rev.data as { status: InterestStatus } | null
    )
  } catch {
    return false
  }
}

/**
 * Full visibility verdict for `viewerId` looking at `targetId`.
 * `rpcContact` / `rpcMutual` / `rpcPaid` let callers reuse the v2 flags that
 * get_public_profile() already returns, avoiding extra queries.
 */
export async function getProfileVisibility(
  supabase: AnyClient,
  viewerId: string,
  targetId: string,
  opts?: { rpcPaid?: boolean | null; rpcMutual?: boolean | null; rpcContact?: string | null }
): Promise<ProfileVisibility> {
  const isPaid = opts?.rpcPaid ?? (await hasActiveSubscription(supabase, viewerId))
  const mutual = opts?.rpcMutual ?? (await checkMutualInterest(supabase, viewerId, targetId))
  const canSeeDetails = isPaid
  const canSeePhone = isPaid && mutual

  let phone: string | null = null
  if (canSeePhone) {
    if (opts?.rpcContact !== undefined) {
      phone = opts.rpcContact ?? null
    } else {
      // Ask the gated RPC first; fall back to a direct read (service-role callers).
      try {
        const { data, error } = await supabase.rpc('get_profile_contact', {
          p_user_id: targetId,
        })
        if (!error) phone = (data as string | null) ?? null
      } catch {
        phone = null
      }
    }
  }

  return { isPaid, mutual, canSeeDetails, canSeePhone, phone }
}

/** Client-side mutual check from two already-fetched statuses (no query). */
export function mutualFromStatuses(
  forward: InterestStatus | null | undefined,
  reverse: InterestStatus | null | undefined
): boolean {
  return rowsMutual(
    forward ? { status: forward } : null,
    reverse ? { status: reverse } : null
  )
}
