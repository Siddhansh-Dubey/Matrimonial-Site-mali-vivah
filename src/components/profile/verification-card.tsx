'use client'

import { useEffect, useState } from 'react'
import { BadgeCheck, Camera, Clock, FileCheck, Loader2, ShieldCheck, Smartphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'

type DocType = 'photo' | 'id_document'

/**
 * Verification, three independent tracks:
 *  1. Mobile — instant, by SMS one-time passcode (sets profiles.mobile_verified).
 *  2. Photo selfie — reviewed by a person, grants the verified badge.
 *  3. ID document — reviewed by a person, also grants the verified badge.
 * Uploads land in the private `verification-docs` bucket (RLS: own folder).
 */
export function VerificationCard({
  verified,
  mobileVerified,
  mobile,
  reason,
}: {
  verified: boolean
  mobileVerified: boolean
  /** The member's saved mobile number (may be null for email-only accounts). */
  mobile: string | null
  /** visibility reason — used only to nudge order of operations. */
  reason: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<DocType | null>(null)
  const [submitted, setSubmitted] = useState<Record<DocType, boolean>>({ photo: false, id_document: false })
  const [error, setError] = useState<string | null>(null)

  // ---- mobile OTP state ----
  const [otpSent, setOtpSent] = useState(false)
  const [otpBusy, setOtpBusy] = useState<'send' | 'verify' | null>(null)
  const [code, setCode] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [mobileDone, setMobileDone] = useState(mobileVerified)

  // Load outstanding request statuses so "under review" survives reloads.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid || cancelled) return
      const { data } = await supabase
        .from('verification_requests')
        .select('type, status')
        .eq('user_id', uid)
        .eq('status', 'pending')
      if (cancelled || !data) return
      const next: Record<DocType, boolean> = { photo: false, id_document: false }
      for (const row of data as { type: string }[]) {
        if (row.type === 'photo' || row.type === 'id_document') next[row.type] = true
      }
      setSubmitted(next)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function submitFile(file: File, type: DocType) {
    if (!isSupabaseConfigured) return
    setBusy(type)
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
      const path = type === 'id_document' ? `${uid}/id/${Date.now()}-${safeName}` : `${uid}/${Date.now()}-${safeName}`
      const { error: upError } = await supabase.storage
        .from('verification-docs')
        .upload(path, file, { upsert: false })
      if (upError) {
        setError(upError.message)
        return
      }
      const { error: reqError } = await supabase.from('verification_requests').insert({
        user_id: uid,
        type,
        storage_path: path,
      })
      if (reqError) {
        await supabase.storage.from('verification-docs').remove([path])
        setError(
          reqError.message.includes('duplicate key') || reqError.message.includes('unique')
            ? 'A verification request of this type is already under review.'
            : reqError.message
        )
        return
      }
      setSubmitted((s) => ({ ...s, [type]: true }))
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function sendCode() {
    setOtpBusy('send')
    setOtpError(null)
    setDevCode(null)
    try {
      const res = await fetch('/api/verification/otp/send', { method: 'POST' })
      const body = (await res.json()) as {
        ok?: boolean
        alreadyVerified?: boolean
        error?: string
        retryAfter?: number
        devCode?: string
      }
      if (!res.ok || !body.ok) {
        setOtpError(body.error ?? 'Could not send the code. Please try again.')
        if (body.retryAfter) setCooldown(body.retryAfter)
        return
      }
      if (body.alreadyVerified) {
        setMobileDone(true)
        router.refresh()
        return
      }
      setOtpSent(true)
      setCooldown(60)
      if (body.devCode) setDevCode(body.devCode)
    } catch {
      setOtpError('Could not send the code. Please try again.')
    } finally {
      setOtpBusy(null)
    }
  }

  async function verifyCode() {
    if (!/^\d{6}$/.test(code.trim())) {
      setOtpError('Enter the 6-digit code from the SMS.')
      return
    }
    setOtpBusy('verify')
    setOtpError(null)
    try {
      const res = await fetch('/api/verification/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string; expired?: boolean }
      if (!res.ok || !body.ok) {
        setOtpError(body.error ?? 'Verification failed. Please try again.')
        if (body.expired) setOtpSent(false)
        return
      }
      setMobileDone(true)
      setOtpSent(false)
      setCode('')
      router.refresh()
    } catch {
      setOtpError('Verification failed. Please try again.')
    } finally {
      setOtpBusy(null)
    }
  }

  const showPublishNudge = reason === 'not_published' || reason === 'profile_incomplete'

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

      <div className="space-y-5 p-6 text-sm text-stone-600">
        {/* ---- 1 · mobile ---- */}
        <div>
          <p className="flex items-center gap-2 font-semibold text-stone-800">
            <span
              className={`h-2 w-2 rounded-full ${mobileDone ? 'bg-emerald-500' : 'bg-stone-300'}`}
              aria-hidden
            />
            <Smartphone className="h-4 w-4 text-stone-400" aria-hidden />
            Mobile number {mobileDone ? 'verified' : 'not verified'}
          </p>
          {!mobileDone && (
            <div className="mt-2.5">
              {!mobile ? (
                <p className="text-xs">
                  No mobile number on your account — contact support to add one, then verify it
                  here.
                </p>
              ) : !otpSent ? (
                <>
                  <p className="text-xs">
                    We&apos;ll text a 6-digit code to {mobile}. It expires in 10 minutes.
                  </p>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={otpBusy === 'send' || cooldown > 0}
                    className="btn-secondary mt-2.5 inline-flex items-center gap-2 !py-2 text-xs disabled:opacity-60"
                  >
                    {otpBusy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Send verification code'}
                  </button>
                </>
              ) : (
                <div className="rounded-2xl bg-stone-50 p-3.5">
                  <label className="label" htmlFor="otp-code">Enter the 6-digit code</label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="otp-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="••••••"
                      className="input max-w-[10rem] tracking-[0.3em] text-center font-bold"
                    />
                    <button
                      type="button"
                      onClick={verifyCode}
                      disabled={otpBusy === 'verify'}
                      className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-4 py-2 text-xs font-bold text-white hover:bg-maroon-dark disabled:opacity-60"
                    >
                      {otpBusy === 'verify' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Verify
                    </button>
                  </div>
                  {devCode && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                      Dev mode — no SMS provider configured. Your code is {devCode}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={otpBusy === 'send' || cooldown > 0}
                    className="mt-2 text-xs font-semibold text-maroon underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>
              )}
              {otpError && <p className="mt-2 text-xs font-semibold text-brand-700">{otpError}</p>}
            </div>
          )}
        </div>

        {/* ---- 2 · photo selfie ---- */}
        <div className="border-t border-stone-100 pt-4">
          <p className="flex items-center gap-2 font-semibold text-stone-800">
            <span className={`h-2 w-2 rounded-full ${verified ? 'bg-emerald-500' : 'bg-stone-300'}`} aria-hidden />
            <Camera className="h-4 w-4 text-stone-400" aria-hidden />
            Photo verification {verified ? 'approved' : submitted.photo ? 'under review' : 'not submitted'}
          </p>
          {!verified && !submitted.photo && (
            <>
              <p className="mt-1.5 text-xs">
                {showPublishNudge
                  ? 'Publish your profile first, then request verification for the green badge.'
                  : 'Submit a fresh selfie — our team compares it with your profile photos and approves the verified badge.'}
              </p>
              <label className="btn-secondary mt-2.5 inline-flex cursor-pointer items-center gap-2 !py-2 text-xs">
                {busy === 'photo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Submit a selfie for verification
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) submitFile(f, 'photo')
                    e.target.value = ''
                  }}
                />
              </label>
            </>
          )}
          {!verified && submitted.photo && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
              <Clock className="h-3.5 w-3.5" /> Under review — usually within a day.
            </p>
          )}
        </div>

        {/* ---- 3 · ID document ---- */}
        <div className="border-t border-stone-100 pt-4">
          <p className="flex items-center gap-2 font-semibold text-stone-800">
            <span className={`h-2 w-2 rounded-full ${verified ? 'bg-emerald-500' : 'bg-stone-300'}`} aria-hidden />
            <FileCheck className="h-4 w-4 text-stone-400" aria-hidden />
            ID document {verified ? 'approved' : submitted.id_document ? 'under review' : 'not submitted'}
          </p>
          {!verified && !submitted.id_document && (
            <>
              <p className="mt-1.5 text-xs">
                Aadhaar, PAN, driving licence or voter ID — a photo or scan. Reviewed privately by
                our team, never shown to other members.
              </p>
              <label className="btn-secondary mt-2.5 inline-flex cursor-pointer items-center gap-2 !py-2 text-xs">
                {busy === 'id_document' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
                Upload an ID document
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="sr-only"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) submitFile(f, 'id_document')
                    e.target.value = ''
                  }}
                />
              </label>
            </>
          )}
          {!verified && submitted.id_document && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
              <Clock className="h-3.5 w-3.5" /> Under review — usually within a day.
            </p>
          )}
        </div>

        {error && <p className="text-xs font-semibold text-brand-700">{error}</p>}
      </div>
    </div>
  )
}
