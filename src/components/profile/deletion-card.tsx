'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'

/**
 * Account deletion REQUEST (per the PRD): the member files a request, the
 * profile is hidden immediately, and the admin completes destruction after a
 * cooling-off period. There is no self-serve irreversible delete — mistakes
 * must be reversible.
 */
export function DeletionCard() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestDeletion() {
    if (!isSupabaseConfigured) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('request_account_deletion', {
        p_reason: reason.trim() || null,
      })
      if (rpcError) {
        if (rpcError.message.includes('PENDING_REQUEST_EXISTS')) {
          setError('A deletion request is already pending — our team is on it.')
        } else {
          setError(rpcError.message)
        }
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="card p-6">
        <h2 className="font-display text-lg font-bold text-maroon">Deletion requested</h2>
        <p className="mt-2 text-sm text-stone-600">
          Your profile is now hidden from everyone. Our team will permanently delete your data and
          confirm over email. Changed your mind? Contact support from the email on your account.
        </p>
      </div>
    )
  }

  return (
    <div className="card border-stone-200 p-6">
      <h2 className="font-display text-lg font-bold text-stone-800">Delete my account</h2>
      {!open ? (
        <>
          <p className="mt-2 text-xs text-stone-500">
            Request permanent deletion. Your profile hides immediately; data is removed by our team
            after verification.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-brand-300 px-4 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50"
          >
            <Trash2 className="h-4 w-4" /> Request account deletion
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional — why are you leaving?"
            rows={2}
            className="input w-full resize-none text-sm"
            maxLength={1000}
          />
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder='Type DELETE to confirm'
            className="input w-full text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestDeletion}
              disabled={busy || confirm !== 'DELETE'}
              className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Submit deletion request
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary !py-2 text-xs">
              Cancel
            </button>
          </div>
          {error && <p className="text-xs font-semibold text-brand-700">{error}</p>}
        </div>
      )}
    </div>
  )
}
