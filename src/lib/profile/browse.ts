import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { ageFromDate } from '@/lib/profile/profile-schema'
import { maskName } from '@/lib/profile/mask'
import type { MatchCard } from '@/lib/supabase/database.types'

/**
 * Build masked, contact-free match cards for a list of user ids.
 * Server-only: uses the service-role client to read profile names/photos that
 * are not reachable through the user's own RLS-scoped session.
 */
export async function buildMatchCards(userIds: string[]): Promise<MatchCard[]> {
  if (userIds.length === 0) return []
  const admin = createAdminClient()

  const [mpRes, pfRes, phRes] = await Promise.all([
    admin.from('matrimony_profiles').select('*').in('user_id', userIds),
    admin.from('profiles').select('id, full_name').in('id', userIds),
    admin
      .from('profile_photos')
      .select('profile_id, storage_path, is_primary, sort_order')
      .in('profile_id', userIds)
      .order('is_primary', { ascending: false })
      .order('sort_order'),
  ])

  const mps = mpRes.data ?? []
  const pfs = pfRes.data ?? []
  const photos = phRes.data ?? []

  const nameById = new Map(pfs.map((p) => [p.id, p.full_name]))
  const photoByProfile = new Map<string, string>()
  for (const ph of photos) {
    if (!photoByProfile.has(ph.profile_id)) photoByProfile.set(ph.profile_id, ph.storage_path)
  }

  return userIds.map((id) => {
    const mp = mps.find((m) => m.user_id === id)
    const full = nameById.get(id) ?? 'Member'
    return {
      user_id: id,
      name: maskName(full),
      age: ageFromDate(mp?.date_of_birth) ?? 0,
      height_cm: mp?.height_cm ?? null,
      sub_community: mp?.sub_community ?? null,
      marital_status: mp?.marital_status ?? 'never_married',
      education: mp?.education ?? null,
      occupation: mp?.occupation ?? null,
      city: mp?.city ?? null,
      state: mp?.state ?? 'Maharashtra',
      diet: mp?.diet ?? 'vegetarian',
      photo: photoByProfile.get(id) ?? null,
      has_photo: photoByProfile.has(id),
    }
  })
}
