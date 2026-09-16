import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BadgeCheck, CalendarDays, Crown, Heart, Rocket, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import { MomentsRail } from '@/components/moments/moments-rail'
import type { MatchCard } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Daily matches' }
export const dynamic = 'force-dynamic'

/**
 * Daily 5 — the rule-based matching engine picks up to five candidates above
 * the compatibility threshold (configured in matching_config). No padding:
 * fewer than the threshold are honestly shown as fewer.
 */
export default async function MatchesPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase.rpc('get_daily_matches')
  const matches = (error ? [] : ((data as MatchCard[] | null) ?? []))

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            <CalendarDays className="h-4 w-4" /> {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            Your Daily 5
          </h1>
          <p className="mt-3 text-sm text-stone-600 sm:text-base">
            Handpicked for strong compatibility — age, location, education, occupation, values and
            what you both prefer. Only genuinely matching profiles appear here.
          </p>
        </div>

        {error ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-brand-200 bg-brand-50 px-6 py-8 text-center text-sm text-brand-800">
            {error.message.includes('not authenticated')
              ? 'Please sign in to see your daily matches.'
              : `Daily matches are being prepared — please check back shortly.`}
          </div>
        ) : matches.length === 0 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-stone-200 bg-white/70 px-6 py-10 text-center">
            <Star className="mx-auto h-8 w-8 text-gold-500" />
            <h2 className="mt-3 font-display text-xl font-bold text-maroon">No new matches today</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-stone-600">
              We never fill this page with weak matches. Broaden your partner preferences, and
              check back tomorrow.
            </p>
            <Link href="/profile/edit" className="btn-primary mt-5">
              Update preferences
            </Link>
          </div>
        ) : (
          <ul className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((m) => (
              <li key={m.user_id}>
                <DailyCard match={m} />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-14">
          <MomentsRail />
        </div>
      </div>
    </section>
  )
}

function DailyCard({ match: m }: { match: MatchCard }) {
  const paid = Boolean(m.viewer_is_paid)
  const name = paid && m.name_full ? m.name_full : m.name
  const href = `/profile/${m.user_id}`
  const photo = photoUrl(m.photo)
  const score = typeof m.score === 'number' ? Math.round(m.score) : null

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[22px] bg-white shadow-card-float ring-1 ring-stone-100/80">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-brand-50">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={`${name} photograph`} className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-display text-6xl font-bold text-brand-200">{name.charAt(0)}</span>
          </div>
        )}
        {score != null && (
          <span className="absolute left-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-emerald-600/95 px-3 py-1 text-[11px] font-bold text-white shadow-sm">
            <Heart className="h-3 w-3 fill-current" /> {score}% match
          </span>
        )}
        {m.is_boosted && (
          <span className="absolute right-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-maroon/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gold-300 shadow-sm">
            <Rocket className="h-3 w-3" /> Boosted
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
        <h2 className="font-display text-xl font-bold text-maroon">
          {name}
          {m.verified && (
            <BadgeCheck className="ml-1.5 inline h-4 w-4 align-text-bottom text-emerald-600" aria-label="Verified" />
          )}
        </h2>
        <p className="mt-0.5 text-sm text-stone-600">
          {paid && m.age != null ? `${m.age} yrs · ` : ''}
          {m.occupation ?? '—'}
          {paid && m.city ? ` · ${m.city}` : ''}
        </p>
        {paid && m.education && <p className="mt-0.5 text-xs text-stone-500">{m.education}</p>}

        {Array.isArray(m.reasons) && m.reasons.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {m.reasons.map((r) => (
              <li
                key={r}
                className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-800"
              >
                {r}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center gap-2 pt-4">
          <Link href={href} className="btn-primary flex-1 !py-2 text-center text-xs">
            View profile
          </Link>
          {!paid && (
            <Link
              href="/packages"
              className="inline-flex items-center gap-1 rounded-full bg-gold-300 px-3 py-2 text-[11px] font-bold text-maroon-deep hover:bg-gold-200"
            >
              <Crown className="h-3.5 w-3.5" /> Unlock details
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
