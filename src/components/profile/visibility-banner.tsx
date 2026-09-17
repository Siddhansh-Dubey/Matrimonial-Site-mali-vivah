import Link from 'next/link'
import { AlertTriangle, Eye, EyeOff, Lock } from 'lucide-react'
import type { VisibilityReason } from '@/lib/supabase/database.types'

/**
 * The single source of truth banner on the dashboard: renders exactly what
 * profile_visibility_reason() says — never a rosy guess. Free and expired
 * members ALWAYS see the locked PRD copy + packages CTA here.
 */
export function VisibilityBanner({
  visibility,
  published = false,
  className = '',
}: {
  visibility: VisibilityReason
  /** When the member just finished the wizard (softens tone, not facts). */
  published?: boolean
  className?: string
}) {
  if (visibility.is_public) {
    return (
      <div
        className={`mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 ${className}`}
      >
        <Eye className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <span>
          <span className="font-bold">{visibility.headline}</span> {visibility.detail}
        </span>
      </div>
    )
  }

  const locked = visibility.reason === 'membership_required' || visibility.reason === 'membership_expired'
  const cta = visibility.cta

  if (locked) {
    return (
      <div
        className={`mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-gold-400/60 bg-gold-100/60 px-5 py-4 text-sm text-maroon-deep sm:flex-row sm:items-center ${className}`}
      >
        <div className="flex-1">
          <span className="inline-flex items-center gap-2 font-bold">
            <Lock className="h-4 w-4" /> {visibility.headline}
          </span>
          <p className="mt-1">
            {visibility.detail}
            {visibility.reason === 'membership_expired' && visibility.expired_at && (
              <span className="block text-xs opacity-75">
                Your membership ended on{' '}
                {new Date(visibility.expired_at).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                .
              </span>
            )}
          </p>
        </div>
        {cta && (
          <Link
            href={cta.href}
            className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-5 py-2 text-xs font-bold text-white hover:bg-maroon-dark"
          >
            {cta.label}
          </Link>
        )}
      </div>
    )
  }

  return (
    <div
      className={`mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 sm:flex-row sm:items-center ${className}`}
    >
      <div className="flex-1">
        <span className="inline-flex items-center gap-2 font-bold">
          {visibility.reason === 'not_published' ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {published ? 'Profile saved — one more step to go live' : visibility.headline}
        </span>
        <p className="mt-1">{visibility.detail}</p>
        {visibility.missing?.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs">
            {visibility.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-5 py-2 text-xs font-bold text-white hover:bg-maroon-dark"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
