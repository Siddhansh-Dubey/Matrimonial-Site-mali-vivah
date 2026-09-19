import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, UserX } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { PrivacySettingsCard } from '@/components/profile/privacy-settings-card'
import { unblockMember } from '@/app/profile/actions'
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
 *
 * Below the toggles, the member manages their own block list. Entries are
 * date-only on purpose: member-to-member names stay masked (the profiles
 * table is owner-readable), but every entry is actionable via Unblock.
 */
export default async function SettingsPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data }, { data: blocks }] = await Promise.all([
    supabase
      .from('matrimony_profiles')
      .select('privacy_settings, whatsapp_opt_in, user_id')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('blocks').select('id, created_at').eq('blocker_id', user.id).order('created_at', { ascending: false }),
  ])
  const mp = (data as MatrimonyProfile | null) ?? null

  // privacy_settings is JSONB — read defensively (missing keys default to
  // "visible", matching the DB resolver's coalesce(..., TRUE)).
  const privacy = (mp?.privacy_settings ?? {}) as Record<string, unknown>
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-maroon hover:text-maroon-dark"
          >
            <ArrowLeft className="h-4 w-4" /> Back to My Profile
          </Link>
          <p className="mt-6 text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
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

          <div className="card mt-6 p-6 sm:p-8">
            <div className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-brand-600" aria-hidden />
              <h2 className="font-display text-lg font-bold text-maroon">Blocked members</h2>
            </div>
            <p className="mt-1 text-sm text-stone-500">
              Blocked members cannot find you, view your profile or message you — and you will
              not see them either. Unblocking is instant.
            </p>
            {(blocks ?? []).length === 0 ? (
              <p className="mt-4 rounded-2xl bg-stone-50 px-4 py-3.5 text-sm text-stone-500">
                You haven&apos;t blocked anyone.
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {(blocks ?? []).map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-stone-900">Blocked member</p>
                      <p className="text-xs text-stone-400">
                        Blocked{' '}
                        {new Date(b.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <form action={unblockMember}>
                      <input type="hidden" name="block_id" value={b.id} />
                      <button
                        type="submit"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-300 px-4 py-1.5 text-xs font-bold text-stone-700 hover:border-brand-400 hover:text-brand-700"
                      >
                        Unblock
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
