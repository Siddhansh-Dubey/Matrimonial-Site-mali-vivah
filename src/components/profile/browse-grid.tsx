import Link from 'next/link'
import { SearchX, Lock } from 'lucide-react'
import { MatchCard } from '@/components/profile/match-card'
import type { MatchCard as MatchCardType } from '@/lib/supabase/database.types'

/**
 * Shared results grid for /search, /brides and /grooms.
 * Free viewers see masked cards (occupation + photo only); paid viewers see all.
 */
export function BrowseGrid({
  matches,
  isPaid,
  clearHref = '/search',
}: {
  matches: MatchCardType[]
  isPaid: boolean
  clearHref?: string
}) {
  return (
    <>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          {matches.length} {matches.length === 1 ? 'profile' : 'profiles'} found
        </p>
        {!isPaid && matches.length > 0 && (
          <Link
            href="/packages"
            className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-4 py-1.5 text-xs font-bold text-white hover:bg-maroon-dark"
          >
            <Lock className="h-3.5 w-3.5" /> Unlock full details
          </Link>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="mx-auto mt-10 max-w-md text-center">
          <SearchX className="mx-auto h-12 w-12 text-stone-300" />
          <h2 className="mt-4 font-display text-xl font-bold text-maroon">No matches yet</h2>
          <p className="mt-2 text-sm text-stone-600">
            Try widening your filters, or come back soon — new verified profiles are added
            regularly.
          </p>
          <Link href={clearHref} className="btn-secondary mt-6">
            Clear filters
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {matches.map((m) => (
            <li key={m.user_id}>
              <MatchCard match={m} isPaid={isPaid} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
