import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Community → sub-community hierarchy, read from the database.
 *
 * `public.communities` / `public.sub_communities` are the ONLY source of
 * truth for community choices (migration 20260915010000 seeds Mali; a new
 * community is a row insert, not a code change). Nothing here falls back to
 * a hard-coded list: when the tables cannot be read the caller gets an empty
 * result + `error` and must show that state instead of stale choices.
 *
 * RLS exposes only `is_active = TRUE` rows to anon/authenticated, so these
 * lists are already limited to selectable rows; `sort_order` is preserved.
 */

export type CommunityOption = {
  id: string
  slug: string
  name: string
  sortOrder: number
}

export type SubCommunityOption = CommunityOption & { communityId: string }

export type CommunityHierarchy = {
  communities: CommunityOption[]
  subCommunities: SubCommunityOption[]
  /** Set when either lookup failed; lists are empty in that case. */
  error: string | null
}

type Client = SupabaseClient<Database>

export async function loadCommunityHierarchy(supabase: Client): Promise<CommunityHierarchy> {
  const [comRes, subRes] = await Promise.all([
    supabase
      .from('communities')
      .select('id, slug, name, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('sub_communities')
      .select('id, slug, name, sort_order, community_id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  const error = comRes.error?.message ?? subRes.error?.message ?? null
  if (error) return { communities: [], subCommunities: [], error }

  return {
    communities: (comRes.data ?? []).map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      sortOrder: c.sort_order,
    })),
    subCommunities: (subRes.data ?? []).map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      sortOrder: s.sort_order,
      communityId: s.community_id,
    })),
    error: null,
  }
}

/** Sub-communities of ONE community, in sort order (never another community's). */
export function subCommunitiesOf(
  hierarchy: Pick<CommunityHierarchy, 'subCommunities'>,
  communityId: string | null | undefined
): SubCommunityOption[] {
  if (!communityId) return []
  return hierarchy.subCommunities.filter((s) => s.communityId === communityId)
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

/**
 * Resolve what an existing profile row should pre-select in the wizard.
 *
 *  CASE A  community_id + sub_community_id → used as-is (when the
 *          sub-community really belongs to that community).
 *  CASE B  community_id only → legacy text resolved WITHIN that community.
 *  CASE C  legacy text only → resolved across communities, but only when
 *          the name is unambiguous (exists in exactly one community).
 *  CASE D  nothing resolvable → empty selection; the member picks again.
 *
 * Only ACTIVE rows are in `hierarchy` (RLS), so a profile linked to a row
 * that was deactivated later lands in CASE D for the *selector* while the
 * stored row is left untouched until the member actually changes it.
 */
export function resolveProfileCommunity(
  hierarchy: Pick<CommunityHierarchy, 'communities' | 'subCommunities'>,
  profile: {
    community_id?: string | null
    sub_community_id?: string | null
    sub_community?: string | null
  } | null
): { communityId: string; subCommunityId: string } {
  if (!profile) return { communityId: '', subCommunityId: '' }

  const byId = (id: string | null | undefined) =>
    id ? hierarchy.subCommunities.find((s) => s.id === id) ?? null : null
  const communityExists = (id: string | null | undefined) =>
    !!id && hierarchy.communities.some((c) => c.id === id)

  // CASE A
  const sub = byId(profile.sub_community_id)
  if (sub && (!profile.community_id || sub.communityId === profile.community_id)) {
    return { communityId: sub.communityId, subCommunityId: sub.id }
  }

  const text = norm(profile.sub_community)
  const textMatches = text
    ? hierarchy.subCommunities.filter((s) => norm(s.name) === text)
    : []

  // CASE B
  if (communityExists(profile.community_id)) {
    const inCommunity = textMatches.find((s) => s.communityId === profile.community_id)
    return { communityId: profile.community_id as string, subCommunityId: inCommunity?.id ?? '' }
  }

  // CASE C
  const distinctCommunities = new Set(textMatches.map((s) => s.communityId))
  if (distinctCommunities.size === 1) {
    const only = textMatches[0]
    return { communityId: only.communityId, subCommunityId: only.id }
  }

  // CASE D
  return { communityId: '', subCommunityId: '' }
}
