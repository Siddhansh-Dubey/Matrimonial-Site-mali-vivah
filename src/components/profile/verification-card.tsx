'use client'

import { useState } from 'react'
import { BadgeCheck, Camera, Clock, Loader2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'

/**
 * Verification requests: the member submits a fresh selfie ('photo') — the
 * admin compares it with the profile photo and approves → verified badge.
 * Requests land in the private `verification-docs` bucket (RLS: own folder).
 */
export function VerificationCard({
  verified,
  mobileVerified,
  reason,
}: {
  verified: boolean
  mobileVerified: boolean
  /** visibility reason — used only to nudge order of operations. */
  reason: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitSelfie(file: File) {
    if (!isSupabaseConfigured) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) {
        router.push('/login')
        return
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const path = `${uid}/${Date.now()}-${safeName}`
      const { error: upError } = await supabase.storage
        .from('verification-docs')
        .upload(path, file, { upsert: false })
      if (upError) {
        setError(upError.message)
        return
      }
      const { error: reqError } = await supabase.from('verification_requests').insert({
        user_id: uid,
        type: 'photo',
        storage_path: path,
      })
      if (reqError) {
        await supabase.storage.from('verification-docs').remove([path])
        setError(
          reqError.message.includes('duplicate key') || reqError.message.includes('unique')
            ? 'A verification request is already under review.'
            : reqError.message
        )
        return
      }
      setRequested(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-stone-100 bg-gradient-to-r from-emerald-50 to-cream px-6 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
          <h2 className="font-display text-lg font-bold text-maroon">Verification</h2>
        </div>
        {verified && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
            <BadgeCheck className="h-3 w-3" /> Verified
          </span>
        )}
      </div>
      <div className="space-y-3 p-6 text-sm text-stone-600">
        <p className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${mobileVerified ? 'bg-emerald-500' : 'bg-stone-300'}`}
            aria-hidden
          />
          Mobile number {mobileVerified ? 'verified' : 'not verified'}
        </p>
        <p className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${verified ? 'bg-emerald-500' : 'bg-stone-300'}`} aria-hidden />
          Photo verification {verified ? 'approved' : requested ? 'under review' : 'not submitted'}
        </p>
        {!verified && !requested && (
          <>
            <p className="text-xs">
              {reason === 'not_published' || reason === 'profile_incomplete'
                ? 'Publish your profile first, then request verification for the green badge.'
                : 'Submit a fresh selfie — our team compares it with your profile photos and approves the verified badge.'}
            </p>
            <label className="btn-secondary inline-flex cursor-pointer items-center gap-2 !py-2 text-xs">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Submit a selfie for verification
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) submitSelfie(f)
                  e.target.value = ''
                }}
              />
            </label>
          </>
        )}
        {!verified && requested && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
            <Clock className="h-3.5 w-3.5" /> Under review — usually within a day.
          </p>
        )}
        {error && <p className="text-xs font-semibold text-brand-700">{error}</p>}
      </div>
    </div>
  )
}
