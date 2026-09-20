import Link from 'next/link'
import { Crown, Gift, Sparkles, Timer } from 'lucide-react'
import type { PlatinumLaunchState } from '@/lib/supabase/database.types'

/**
 * Platinum Launch Offer card — the promotional (FREE) Platinum state on the
 * member dashboard. Deliberately distinct from the paid-membership banner:
 * it never shows a price, a transaction or wording that implies a purchase.
 * Everything rendered here comes from the server-authoritative
 * get_my_platinum_launch() / claim_platinum_launch_offer() RPCs — the browser
 * never computes slots, eligibility or dates.
 */

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

/** Remaining duration — days for the 30-day grant, hours/minutes for the demo. */
export function formatRemaining(secondsLeft: number | undefined, isDemo: boolean): string {
  const s = Math.max(0, Math.floor(secondsLeft ?? 0))
  if (s <= 0) return 'ending soon'
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (!isDemo && days >= 1) return `${days} day${days === 1 ? '' : 's'} left`
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} min left`
  return `${Math.max(minutes, 1)} min left`
}

export function PlatinumLaunchCard({
  state,
  celebrate = false,
  className = '',
}: {
  state: PlatinumLaunchState | null
  /** True right after the grant was issued (wizard redirect / fresh claim). */
  celebrate?: boolean
  className?: string
}) {
  if (!state?.has_grant) return null

  const isDemo = state.grant_type === 'demo_24h'
  const live = state.is_live === true

  if (!live) {
    // Expired promotional grant — the existing membership/visibility rules
    // already hid the profile; this is a gentle, truthful recap + CTA.
    return (
      <div
        className={`mx-auto max-w-3xl rounded-2xl border border-stone-200 bg-white/70 px-5 py-4 text-sm text-stone-600 ${className}`}
      >
        <div className="flex items-start gap-3">
          <Timer className="mt-0.5 h-5 w-5 shrink-0 text-stone-400" aria-hidden />
          <div>
            <p className="font-semibold text-stone-800">
              Your free {isDemo ? '24-hour Platinum demo' : '30-day Platinum launch offer'} has
              ended.
            </p>
            <p className="mt-1">
              It was a one-time promotional grant, so it cannot be renewed for free — but your
              profile is ready. Choose any package to go live again.
            </p>
            <Link
              href="/packages"
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-maroon px-5 py-2 text-xs font-bold text-white hover:bg-maroon-dark"
            >
              <Crown className="h-3.5 w-3.5" /> View packages
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const headline = isDemo
    ? '🎉 Your free 24-hour Platinum demo is now active.'
    : state.slot_number
      ? `🎉 You're one of the first 100 members! (Slot #${state.slot_number})`
      : '🎉 Platinum Launch Offer active'
  const body = isDemo
    ? 'Every Platinum capability is unlocked for 24 hours — no payment, no card. When the demo ends your profile hides again unless you pick a package.'
    : "You've received 30 days of Platinum access free. No payment, no card — your profile is live with full Platinum capabilities."

  return (
    <div
      className={`mx-auto max-w-3xl overflow-hidden rounded-2xl border border-gold-400/60 bg-gradient-to-br from-maroon-deep to-brand-800 px-5 py-5 text-sm text-white shadow-card-float ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-400/20 ring-1 ring-gold-300/60">
          {isDemo ? <Timer className="h-5 w-5 text-gold-300" aria-hidden /> : <Sparkles className="h-5 w-5 text-gold-300" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-display text-base font-bold text-gold-200">
            {headline}
            <span className="inline-flex items-center gap-1 rounded-full bg-gold-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-maroon-deep">
              <Crown className="h-3 w-3" /> Platinum · Free launch offer
            </span>
            {celebrate && (
              <span className="inline-flex items-center rounded-full bg-emerald-400/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-950">
                Just granted
              </span>
            )}
          </p>
          <p className="mt-1.5 text-white/80">{body}</p>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-white/85 sm:grid-cols-3">
            <div className="flex items-center gap-1.5">
              <dt className="text-white/60">Started</dt>
              <dd className="font-semibold">{formatDateTime(state.started_at)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-white/60">Expires</dt>
              <dd className="font-semibold">{formatDateTime(state.expires_at)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-white/60">Time left</dt>
              <dd className="font-semibold">{formatRemaining(state.seconds_left, isDemo)}</dd>
            </div>
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/60">
            <Gift className="h-3.5 w-3.5" aria-hidden />
            Promotional grant — you were not charged and no payment was created.
          </p>
        </div>
      </div>
    </div>
  )
}
