import Link from 'next/link'
import Image from 'next/image'
import { MapPin, GraduationCap, Briefcase, ArrowRight } from 'lucide-react'
import { photoUrl } from '@/lib/profile/photos'
import type { MatchCard as MatchCardType } from '@/lib/supabase/database.types'

export function MatchCard({ match }: { match: MatchCardType }) {
  const photo = photoUrl(match.photo)
  const sub = [match.age ? `${match.age} yrs` : null, match.height_cm ? `${match.height_cm} cm` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[22px] bg-white shadow-card-float ring-1 ring-stone-100/80">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-brand-50">
        {photo ? (
          <Image src={photo} alt={`${match.name} profile photograph`} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover object-top" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-display text-5xl font-bold text-brand-200">{match.name.charAt(0)}</span>
          </div>
        )}
        <span className="absolute left-3.5 top-3.5 rounded-full bg-gold-300 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-maroon-deep shadow-sm">
          {match.sub_community ?? 'Mali'}
        </span>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-6 pt-5">
        <h3 className="font-display text-[21px] font-bold leading-snug text-maroon">{match.name}</h3>
        {sub && <p className="mt-1 text-[13.5px] text-stone-600">{sub}</p>}

        <ul className="mt-3 space-y-1.5 text-[13.5px] text-stone-600">
          {match.city && (
            <li className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-gold-600" /> {match.city}, {match.state}
            </li>
          )}
          {match.education && (
            <li className="flex items-center gap-2">
              <GraduationCap className="h-3.5 w-3.5 text-gold-600" /> {match.education}
            </li>
          )}
          {match.occupation && (
            <li className="flex items-center gap-2">
              <Briefcase className="h-3.5 w-3.5 text-gold-600" /> {match.occupation}
            </li>
          )}
        </ul>

        <Link
          href={`/profile/${match.user_id}`}
          className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border-[1.5px] border-brand-300/80 bg-brand-50 px-6 py-2.5 pt-2.5 text-sm font-bold text-brand-800 transition-all hover:border-brand-600 hover:bg-brand-600 hover:text-white"
        >
          View profile <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  )
}
