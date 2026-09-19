'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

/**
 * Error boundary for the admin panel. Server actions that throw (the
 * historical pattern on several admin pages) land here instead of on the
 * bare framework error screen; the member-management actions themselves
 * redirect back with a readable notice, so this mostly covers unexpected
 * failures. Production builds redact server error messages — the digest is
 * shown so it can be matched against server logs.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6 text-brand-900">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-brand-700" aria-hidden />
        <h2 className="font-display text-lg font-bold">That action could not be completed</h2>
      </div>
      <p className="mt-2 break-words text-sm">{error.message || 'An unexpected error occurred.'}</p>
      {error.digest && <p className="mt-1 text-xs text-brand-700/70">Reference: {error.digest}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-maroon px-4 py-2 text-xs font-bold text-white hover:bg-maroon-dark"
        >
          Try again
        </button>
        <Link
          href="/admin/members"
          className="rounded-full border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:border-maroon"
        >
          Back to Members
        </Link>
      </div>
    </div>
  )
}
