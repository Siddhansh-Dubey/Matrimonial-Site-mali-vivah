import Link from 'next/link'
import Image from 'next/image'
import { MapPin, GraduationCap, Briefcase, ArrowRight, BadgeCheck, Lock, Rocket } from 'lucide-react'
import { photoUrl } from '@/lib/profile/photos'
import { MASK_BLUR_CLASS } from '@/lib/profile/mask'
import type { MatchCard as MatchCardType } from '@/lib/supabase/database.types'

/**
 * Masking rules (see src/lib/profile/visibility.ts):
 *  • Free viewer → ONLY occupation + photo are visible; everything else is masked.
 *  • Paid viewer → every detail on the card is visible.
 */
export function MatchCard({
  match,
  isPaid = false,
}: {
  match: MatchCardType
  /** True when the viewer holds any active package. Defaults to free. */
  isPaid?: boolean
}) {
  const photo = photoUrl(match.photo)
  // Paid viewers see the full name when the RPC provided it (v2 key).
  const displayName = isPaid && match.name_full ? match.name_full : match.name

  const sub =
    isPaid && match.age
      ? [match.age ? `${match.age} yrs` : null, match.height_cm ? `${match.height_cm} cm` : null]
          .filter(Boolean)
          .join(' · ')
      : null

  // Community name comes from the DB hierarchy (search_matches v4). Paid
  // viewers see the sub-community; everyone else the community itself.
  const community = match.community ?? 'Mali'
  const badge = isPaid ? (match.sub_community ?? community) : community

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[22px] bg-white shadow-card-float ring-1 ring-stone-100/80">
      {/* Photo — ALWAYS visible, for free and paid viewers alike. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-brand-50">
        {photo ? (
          <Image
            src={photo}
            alt={`${displayName} profile photograph`}
            fill
            sizes="(max-width: 640px) 100vw, 33vw"
            className="object-cover object-top"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-display text-5xl font-bold text-brand-200">
              {displayName.charAt(0)}
            </span>
          </div>
        )}
        <div className="absolute left-3.5 top-3.5 flex flex-col items-start gap-1.5">
          <span className="rounded-full bg-gold-300 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-maroon-deep shadow-sm">
            {badge}
          </span>
          {match.is_boosted && (
            <span className="inline-flex items-center gap-1 rounded-full bg-maroon/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gold-300 shadow-sm">
              <Rocket className="h-3 w-3" /> Boosted
            </span>
          )}
        </div>
        {!isPaid && (
          <span className="absolute right-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-maroon-deep/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
            <Lock className="h-3 w-3" /> Free preview
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-6 pt-5">
        <h3 className="font-display text-[21px] font-bold leading-snug text-maroon">
          {displayName}
          {match.verified && (
            <BadgeCheck className="ml-1.5 inline h-4.5 w-4.5 align-text-bottom text-emerald-600" aria-label="Verified profile" />
          )}
        </h3>

        {isPaid ? (
          <>
            {sub && <p className="mt-1 text-[13.5px] text-stone-600">{sub}</p>}
            <ul className="mt-3 space-y-1.5 text-[13.5px] text-stone-600">
              {match.city && (
                <li className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gold-600" /> {match.city},{' '}
                  {match.state}
                </li>
              )}
              {match.education && (
                <li className="flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5 shrink-0 text-gold-600" />{' '}
                  {match.education}
                </li>
              )}
              {match.occupation && (
                <li className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5 shrink-0 text-gold-600" />{' '}
                  {match.occupation}
                </li>
              )}
            </ul>
          </>
        ) : (
          <>
            {/* Masked age / height line keeps the card height stable. */}
            <p className={`mt-1 text-[13.5px] text-stone-600 ${MASK_BLUR_CLASS}`} aria-hidden>
              27 yrs · 165 cm
            </p>
            <ul className="mt-3 space-y-1.5 text-[13.5px] text-stone-600">
              {/* Occupation — the ONE detail a free viewer may see. */}
              {match.occupation && (
                <li className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5 shrink-0 text-gold-600" />{' '}
                  {match.occupation}
                </li>
              )}
              <li className="flex items-center gap-2" aria-label="Location locked">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-gold-600" />
                <span className={MASK_BLUR_CLASS} aria-hidden>
                  Pune, Maharashtra
                </span>
                <Lock className="h-3 w-3 text-stone-400" />
              </li>
              <li className="flex items-center gap-2" aria-label="Education locked">
                <GraduationCap className="h-3.5 w-3.5 shrink-0 text-gold-600" />
                <span className={MASK_BLUR_CLASS} aria-hidden>
                  B.E. Computer
                </span>
                <Lock className="h-3 w-3 text-stone-400" />
              </li>
            </ul>
            <p className="mt-3 rounded-xl bg-gold-100/60 px-3 py-2 text-center text-[11.5px] font-semibold text-maroon">
              <Link href="/packages" className="underline underline-offset-2 hover:no-underline">
                View packages
              </Link>{' '}
              to unlock full details
            </p>
          </>
        )}

        <Link
          href={`/profile/${match.user_id}`}
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-full border-[1.5px] border-brand-300/80 bg-brand-50 px-6 py-2.5 text-sm font-bold text-brand-800 transition-all hover:border-brand-600 hover:bg-brand-600 hover:text-white"
        >
          View profile <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  )
}
