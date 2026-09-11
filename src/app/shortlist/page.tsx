import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { buildMatchCards } from '@/lib/profile/browse'
import { MatchCard } from '@/components/profile/match-card'

export const metadata: Metadata = { title: 'Shortlist' }
export const dynamic = 'force-dynamic'

export default async function ShortlistPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: shortlists } = await supabase
    .from('shortlists')
    .select('target_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const targetIds = (shortlists ?? []).map((s) => s.target_id)
  const matches = await buildMatchCards(targetIds)

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">Saved profiles</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon">Shortlist</h1>
          <p className="mt-3 text-sm text-stone-600">Profiles you have saved for later.</p>
        </div>

        {matches.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md text-center">
            <Star className="mx-auto h-12 w-12 text-stone-300" />
            <h2 className="mt-4 font-display text-xl font-bold text-maroon">Nothing shortlisted yet</h2>
            <p className="mt-2 text-sm text-stone-600">
              Tap “Shortlist” on any profile while browsing to save it here.
            </p>
            <Link href="/search" className="btn-primary mt-6">
              Browse profiles
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {matches.map((m) => (
              <li key={m.user_id}>
                <MatchCard match={m} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
