'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { deleteMyAccount } from '@/app/profile/actions'

/**
 * Self-serve account deletion — DIRECT, no request and no admin queue.
 * After the typed confirmation the server action erases the auth user, every
 * cascading database row and all uploaded photos in one pass. Irreversible;
 * that is exactly what the member asked for.
 */
export function DeletionCard() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function eraseAccount() {
    if (confirm !== 'DELETE' || pending) return
    setError(null)
    startTransition(async () => {
      const result = await deleteMyAccount()
      if (result.ok) {
        setDone(true)
        // The session is already dead — land on the login screen with a
        // confirmation note rather than a refreshed (now inaccessible) profile.
        router.replace('/login?deleted=1')
      } else {
        setError(result.error) // panel stays open so the message is visible
      }
    })
  }

  if (done) {
    return (
      <div className="card p-6">
        <h2 className="font-display text-lg font-bold text-maroon">Account deleted</h2>
        <p className="mt-2 text-sm text-stone-600">
          Everything tied to this account — profile, photos, matches and history — has been
          permanently erased. We&apos;re sorry to see you go.
        </p>
      </div>
    )
  }

  return (
    <div className="card border-brand-200 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-800">
        <Trash2 className="h-5 w-5" aria-hidden />
        Delete my account
      </h2>
      {!open ? (
        <>
          <p className="mt-2 text-xs text-stone-600">
            Permanently erases your profile, photos, matches and history from our database —
            immediately, with no cooling-off period and no undo.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-brand-300 px-4 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50"
          >
            <AlertTriangle className="h-4 w-4" /> Delete my account now
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-xs leading-relaxed text-stone-700">
            <p className="flex items-center gap-1.5 font-bold text-brand-700">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> This cannot be undone
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-stone-600">
              <li>Your login, profile, photos and partner preferences are removed.</li>
              <li>Interests, matches, messages, blocks and notifications are deleted.</li>
              <li>Paid time left on a package is forfeited — refunds go through support.</li>
              <li>Payment records are kept in anonymised form for accounts; they are no longer linked to you.</li>
            </ul>
          </div>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder='Type DELETE to confirm'
            className="input w-full text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={eraseAccount}
              disabled={pending || confirm !== 'DELETE'}
              className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {pending ? 'Erasing everything…' : 'Yes, permanently delete my account'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="btn-secondary !py-2 text-xs"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs font-semibold text-brand-700">{error}</p>}
        </div>
      )}
    </div>
  )
}
