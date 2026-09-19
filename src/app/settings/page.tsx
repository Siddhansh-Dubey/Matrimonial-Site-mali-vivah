import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { PrivacyForm, type BlockedEntry } from '@/components/settings/privacy-form'

export const metadata: Metadata = { title: 'Settings & privacy' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [mpRes, blocksRes] = await Promise.all([
    supabase
      .from('matrimony_profiles')
      .select('privacy_settings, whatsapp_opt_in')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('blocks').select('id, blocked_id, created_at').eq('blocker_id', user.id),
  ])

  const privacy = (mpRes.data?.privacy_settings as Record<string, boolean> | null) ?? {}
  const whatsappOptIn = mpRes.data?.whatsapp_opt_in ?? false

  // Date-only entries on purpose: member-to-member names stay masked, and the
  // profiles table is owner-readable — the list is still actionable via Unblock.
  const blocked: BlockedEntry[] = (blocksRes.data ?? []).map((b) => ({
    id: b.id,
    created_at: b.created_at,
  }))

  return (
    <section className="bg-cream">
      <div className="container-page max-w-3xl py-10 sm:py-14">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-maroon hover:text-maroon-dark"
        >
          <ArrowLeft className="h-4 w-4" /> Back to My Profile
        </Link>
        <p className="mt-6 text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
          Your control room
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold text-maroon">Settings &amp; privacy</h1>
        <p className="mt-3 text-sm text-stone-600 sm:text-base">
          Decide what paid members see on your profile, and manage the people you have blocked.
        </p>

        <div className="mt-8">
          <PrivacyForm initial={privacy} whatsappOptIn={whatsappOptIn} blocked={blocked} />
        </div>
      </div>
    </section>
  )
}
