import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import { FeaturedCarousel, type FeaturedCard } from '@/components/home/featured-carousel'
import type { MatchCard } from '@/lib/supabase/database.types'

/**
 * Admin-curated featured profiles. Data comes from the featured_profiles
 * curation table through get_featured_profiles() (anon-safe, contact-free,
 * masked names). If the admin has not curated anyone yet, the whole section
 * stays hidden — we never pad it with fake/demo profiles.
 */
export function FeaturedProfilesSection() {
  return <FeaturedProfilesSectionInner />
}

async function FeaturedProfilesSectionInner() {
  if (!isSupabaseConfigured) return null
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase.rpc('get_featured_profiles', { p_limit: 8 })
  if (error || !data) return null
  const cards: FeaturedCard[] = (data as MatchCard[]).map((c) => ({
    user_id: c.user_id,
    name: c.name_full ?? c.name,
    gender: c.gender === 'male' ? 'groom' : c.gender === 'female' ? 'bride' : null,
    age: c.age ?? null,
    city: c.city ?? null,
    education: c.education ?? null,
    occupation: c.occupation ?? null,
    photo: photoUrl(c.photo),
    verified: Boolean(c.verified),
    is_boosted: Boolean(c.is_boosted),
    viewerIsPaid: Boolean(c.viewer_is_paid),
    viewerIsSignedIn: Boolean(user),
  }))
  if (cards.length === 0) return null
  return <FeaturedCarousel cards={cards} />
}
