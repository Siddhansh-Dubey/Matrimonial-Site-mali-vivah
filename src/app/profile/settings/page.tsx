import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { PrivacySettingsCard } from '@/components/profile/privacy-settings-card'
import type { MatrimonyProfile } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Settings & Privacy' }
export const dynamic = 'force-dynamic'

/**
 * Settings & Privacy (PRD H).
 *
 * The member controls what OTHER (paid) members can see from their profile:
 *  • About me section        → privacy_settings.show_about
 *  • Family details text     → privacy_settings.show_family_details
 *  • Family photo            → privacy_settings.show_family_photo
 *  • Annual income           → privacy_settings.show_income
 *
 * These toggles only affect the paid viewer experience — the database RPCs
 * (get_public_profile / search_matches) honour them. The mutual-interest
 * gate is NEVER bypassed: contact details still require payment + mutual
 * interest, exactly as before.
 */
export default async function SettingsPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('matrimony_profiles')
    .select('privacy_settings, whatsapp_opt_in, user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const mp = (data as MatrimonyProfile | null) ?? null

  // privacy_settings is JSONB — read defensively (missing keys default to
  // "visible", matching the DB resolver's coalesce(..., TRUE)).
  const privacy = (mp?.privacy_settings ?? {}) as Record<string, unknown>
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-2xl">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            Your controls
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold text-maroon sm:text-4xl">
            Settings &amp; privacy
          </h1>
          <p className="mt-3 text-sm text-stone-600">
            Choose what other members can see on your profile. Changing a setting takes effect
            immediately for new profile views.
          </p>

          <PrivacySettingsCard
            initial={{
              showAbout: bool(privacy.show_about, true),
              showFamilyDetails: bool(privacy.show_family_details, true),
              showFamilyPhoto: bool(privacy.show_family_photo, true),
              showIncome: bool(privacy.show_income, true),
              whatsappOptIn: bool(mp?.whatsapp_opt_in, false),
            }}
          />
        </div>
      </div>
    </section>
  )
}
