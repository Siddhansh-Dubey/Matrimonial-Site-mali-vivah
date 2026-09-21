import 'server-only'
import type { AdminContext } from '@/lib/admin/server'
import type { AdminMemberState } from '@/lib/admin/members'
import type {
  MatrimonyProfile,
  PartnerPreferences,
  Profile,
} from '@/lib/supabase/database.types'

type AdminClient = AdminContext['admin']

export type MemberDetail = {
  person: Profile
  profile: MatrimonyProfile | null
  prefs: PartnerPreferences | null
  communityName: string | null
  subCommunityName: string | null
  photos: { id: number; storage_path: string; kind: 'profile_photo' | 'family_photo'; is_primary: boolean; sort_order: number }[]
  state: AdminMemberState | null
  subscriptions: { id: number; package_slug: string | null; status: string; started_at: string; expires_at: string; payment_id: string | null }[]
  payments: { id: string; kind: 'package' | 'boost'; amount_inr: number; status: string; package_slug: string | null; created_at: string }[]
  verifications: { id: string; type: string; status: string; created_at: string; reviewed_at: string | null }[]
  featured: { position: number; created_at: string } | null
  boost: { id: number; expires_at: string; created_via: string | null } | null
  boostEntitlements: number
  counts: {
    viewsReceived: number
    viewsMade: number
    interestsSent: number
    interestsReceived: number
    mutual: number
    messagesSent: number
    moments: number
    blocksBy: number
    blocksOf: number
    reportsAgainst: number
  }
  audit: { id: number; action: string; created_at: string; admin_id: string | null; details: Record<string, unknown> | null }[]
  activity: { id: number; event: string; created_at: string }[]
}

async function count(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count: n } = await q
  return n ?? 0
}

/**
 * Everything the member detail page shows, read with the service-role client
 * (the caller has already passed requireAdminPage). Verification DOCUMENTS
 * are deliberately not loaded — only request types / statuses; documents
 * stay in the verification queue behind short-lived signed URLs.
 */
export async function loadMemberDetail(admin: AdminClient, userId: string): Promise<MemberDetail | null> {
  const { data: person } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (!person) return null

  const [
    mpRes,
    ppRes,
    photosRes,
    stateRes,
    subsRes,
    payRes,
    verRes,
    featRes,
    boostRes,
    entRes,
    auditRes,
    actRes,
    viewsReceived,
    viewsMade,
    interestsSent,
    interestsReceived,
    mutual,
    messagesSent,
    moments,
    blocksBy,
    blocksOf,
    reportsAgainst,
  ] = await Promise.all([
    admin
      .from('matrimony_profiles')
      .select('*, community:communities(name), sub_community_row:sub_communities(name)')
      .eq('user_id', userId)
      .maybeSingle(),
    admin.from('partner_preferences').select('*').eq('profile_id', userId).maybeSingle(),
    admin
      .from('profile_photos')
      .select('id, storage_path, kind, is_primary, sort_order')
      .eq('profile_id', userId)
      .order('is_primary', { ascending: false })
      .order('sort_order'),
    admin.rpc('admin_member_state', { p_user_id: userId }),
    admin
      .from('subscriptions')
      // payment_id tells the revocation UI apart from a free Platinum launch
      // grant without a second query — a payment-backed row is a paid
      // membership, a NULL one is either a manual activation or a promotion.
      .select('id, package_slug, status, started_at, expires_at, payment_id')
      .eq('user_id', userId)
      .order('expires_at', { ascending: false })
      .limit(10),
    admin
      .from('payments')
      .select('id, kind, amount_inr, status, package_slug, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    admin
      .from('verification_requests')
      .select('id, type, status, created_at, reviewed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('featured_profiles').select('position, created_at').eq('profile_id', userId).maybeSingle(),
    admin
      .from('profile_boosts')
      .select('id, expires_at, created_via')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('profile_boost_entitlements').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin
      .from('admin_audit_log')
      .select('id, action, created_at, admin_id, details')
      .eq('target_id', userId)
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('activity_events')
      .select('id, event, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(12),
    count(admin.from('profile_views').select('id', { count: 'exact', head: true }).eq('viewed_id', userId)),
    count(admin.from('profile_views').select('id', { count: 'exact', head: true }).eq('viewer_id', userId)),
    count(admin.from('interests').select('id', { count: 'exact', head: true }).eq('sender_id', userId)),
    count(admin.from('interests').select('id', { count: 'exact', head: true }).eq('receiver_id', userId)),
    count(
      admin
        .from('interests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    ),
    count(admin.from('messages').select('id', { count: 'exact', head: true }).eq('sender_id', userId)),
    count(admin.from('moments').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
    count(admin.from('blocks').select('id', { count: 'exact', head: true }).eq('blocker_id', userId)),
    count(admin.from('blocks').select('id', { count: 'exact', head: true }).eq('blocked_id', userId)),
    count(admin.from('reports').select('id', { count: 'exact', head: true }).eq('reported_id', userId)),
  ])

  type MpJoined = MatrimonyProfile & {
    community: { name: string } | null
    sub_community_row: { name: string } | null
  }
  const mpJoined = (mpRes.data as unknown as MpJoined | null) ?? null
  let profile: MatrimonyProfile | null = null
  if (mpJoined) {
    const { community: _c, sub_community_row: _s, ...rest } = mpJoined
    void _c
    void _s
    profile = rest as MatrimonyProfile
  }

  return {
    person: person as Profile,
    profile,
    prefs: (ppRes.data as PartnerPreferences | null) ?? null,
    communityName: mpJoined?.community?.name ?? null,
    subCommunityName: mpJoined?.sub_community_row?.name ?? mpJoined?.sub_community ?? null,
    photos: (photosRes.data ?? []) as MemberDetail['photos'],
    state: (stateRes.data as unknown as AdminMemberState | null) ?? null,
    subscriptions: (subsRes.data ?? []) as MemberDetail['subscriptions'],
    payments: (payRes.data ?? []) as MemberDetail['payments'],
    verifications: (verRes.data ?? []) as MemberDetail['verifications'],
    featured: (featRes.data as MemberDetail['featured']) ?? null,
    boost: (boostRes.data as MemberDetail['boost']) ?? null,
    boostEntitlements: entRes.count ?? 0,
    counts: {
      viewsReceived,
      viewsMade,
      interestsSent,
      interestsReceived,
      mutual,
      messagesSent,
      moments,
      blocksBy,
      blocksOf,
      reportsAgainst,
    },
    audit: (auditRes.data ?? []) as MemberDetail['audit'],
    activity: (actRes.data ?? []) as MemberDetail['activity'],
  }
}
