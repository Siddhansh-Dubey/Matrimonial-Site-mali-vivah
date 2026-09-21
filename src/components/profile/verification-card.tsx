'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Camera, Clock, IdCard, Loader2, ShieldCheck, Smartphone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'

/**
 * Verification centre (PRD D + E).
 *
 *  • MOBILE — real OTP flow: request + verify through the server
 *    (/api/mobile-otp/* → Supabase phone auth, service-role). The app never
 *    fakes an OTP; without a configured SMS provider the request endpoint
 *    says so plainly. Success flips profiles.mobile_verified.
 *  • PHOTO  — a fresh selfie, compared by an admin against the profile
 *    photos. Stored in the PRIVATE verification-docs bucket (own folder).
 *  • ID     — an optional identity document (Aadhaar/PAN/passport), same
 *    private bucket, same admin queue. Approval sets the verified badge.
 *
 * One open request per (user, type) is enforced by a unique index in the
 * database; the UI reflects that with the "under review" state.
 */

type PendingTypes = { photo?: boolean; id_document?: boolean; mobile?: boolean }

export function VerificationCard({
  verified,
  mobileVerified,
  reason,
  pending,
  mobileNumber,
}: {
  verified: boolean
  mobileVerified: boolean
  /** visibility reason — used only to nudge order of operations. */
  reason: string
  /** types with an open (pending) request. */
  pending: PendingTypes
  /** stored mobile, displayed masked for privacy. */
  mobileNumber: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // mobile OTP state — every value comes from the server response, never from
  // an optimistic local guess (see requestOtp below).
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [cooldown, setCooldown] = useState(0)
  /** 'real' only when the SMS provider accepted a genuine send. */
  const [delivery, setDelivery] = useState<'real' | 'simulated' | null>(null)
  /** Non-fatal caution (e.g. a local test SMS provider): shown in amber. */
  const [warn, setWarn] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  async function submitDoc(file: File, type: 'photo' | 'id_document') {
    if (!isSupabaseConfigured) return
    setBusy(type)
    setError(null)
    setInfo(null)
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
        setError(type === 'photo' ? `Selfie upload failed: ${upError.message}` : `Document upload failed: ${upError.message}`)
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
            ? 'A verification request is already under review.'
            : type === 'photo'
              ? 'Could not submit the selfie. Please try again.'
              : 'Could not submit the document. Please try again.'
        )
        return
      }
      setInfo(type === 'photo' ? 'Selfie submitted — usually reviewed within a day.' : 'Document submitted — usually reviewed within a day.')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  /** Server response contract of /api/mobile-otp/request. */
  type OtpRequestResponse = {
    ok?: boolean
    error?: string
    code?: string
    delivery?: 'real' | 'simulated'
    cooldown_seconds?: number
    retry_after_seconds?: number
    verify_window_minutes?: number
    max_per_hour?: number
    mobile_masked?: string
  }

  async function requestOtp() {
    if (!isSupabaseConfigured) return
    setBusy('otp-request')
    setError(null)
    setInfo(null)
    setWarn(null)
    try {
      const res = await fetch('/api/mobile-otp/request', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as OtpRequestResponse

      if (!res.ok || body.ok !== true) {
        // The provider refused (misconfiguration, rate limit, invalid number,
        // outage). Nothing was delivered, so nothing claims otherwise, and the
        // resend countdown follows the SERVER's number rather than a local 60.
        setOtpSent(false)
        setDelivery(null)
        setCooldown(Math.max(0, Number(body.retry_after_seconds ?? body.cooldown_seconds ?? 0)))
        setError(body.error ?? 'Could not send the code. Please try again.')
        return
      }

      // Truthful success only. `delivery: 'simulated'` means GoTrue's local
      // test provider accepted the send and NO SMS is coming — the member is
      // told exactly that instead of being asked to wait for a code.
      const simulated = body.delivery === 'simulated'
      setOtpSent(true)
      setOtp('')
      setDelivery(simulated ? 'simulated' : 'real')
      setCooldown(Math.max(0, Number(body.cooldown_seconds ?? 60)))
      if (simulated) {
        setWarn(
          'This deployment is using Supabase\u2019s local test SMS provider, so no real code was delivered. Mobile verification cannot be completed here \u2014 contact support.'
        )
      } else {
        setInfo(
          `Code sent by SMS to ${body.mobile_masked ?? maskMobile(mobileNumber)}. It expires in about ${verifyWindowMinutesLabel(body.verify_window_minutes)} \u2014 enter it below.`
        )
      }
    } catch {
      setOtpSent(false)
      setDelivery(null)
      setError('Could not send the code. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  function verifyWindowMinutesLabel(value?: number): string {
    const n = Number(value ?? 10)
    return `${Number.isFinite(n) && n > 0 ? n : 10} minutes`
  }

  async function verifyOtp() {
    if (!isSupabaseConfigured || !/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code from the SMS.')
      return
    }
    setBusy('otp-verify')
    setError(null)
    try {
      const res = await fetch('/api/mobile-otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok || body.code === 'OTP_EXPIRED' || body.code === 'OTP_INVALID') {
        // Invalid / expired / already-used code: clear the digits, keep the
        // form open, and show the server's own wording.
        setOtp('')
        setError(body.error ?? 'That code could not be verified. Please try again.')
        return
      }
      setOtpSent(false)
      setOtp('')
      setDelivery(null)
      setWarn(null)
      setInfo('Verification successful — your mobile number is now verified.')
      router.refresh()
    } catch {
      setError('Could not verify the code. Please try again.')
    } finally {
      setBusy(null)
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

      <div className="space-y-4 p-6 text-sm text-stone-600">
        {/* Mobile OTP */}
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Smartphone className="h-4 w-4 text-emerald-600" />
            Mobile number
            {mobileVerified ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                Verified
              </span>
            ) : (
              <span className="text-xs font-normal text-stone-400">
                {mobileNumber ? maskMobile(mobileNumber) : 'not on file'}
              </span>
            )}
          </p>

          {!mobileVerified && !mobileNumber && (
            <p className="mt-2 text-xs">
              Add your mobile number to your profile first (edit your profile), then verify it
              here with a one-time code.
            </p>
          )}

          {!mobileVerified && mobileNumber && (
            <div className="mt-3 space-y-2">
              <p className="text-xs">
                We send a one-time code by SMS. Verify to use your number for sign-in and
                contact.
              </p>
              {!otpSent ? (
                <button
                  type="button"
                  onClick={requestOtp}
                  disabled={busy !== null || cooldown > 0}
                  aria-live="polite"
                  className="btn-secondary inline-flex items-center gap-2 !py-2 text-xs disabled:opacity-50"
                >
                  {busy === 'otp-request' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                  {busy === 'otp-request'
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Resend SMS code in ${cooldown}s`
                      : 'Send SMS code'}
                </button>
              ) : (
                <div className="space-y-2">
                  {delivery === 'simulated' && (
                    <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                      Test SMS provider — no real message was delivered.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      placeholder="6-digit code"
                      aria-label="OTP code"
                      className="input w-32 !py-2 text-sm tracking-[0.3em]"
                    />
                    <button
                      type="button"
                      onClick={verifyOtp}
                      disabled={busy !== null || otp.length !== 6}
                      className="btn-primary !py-2 text-xs disabled:opacity-50"
                    >
                      {busy === 'otp-verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      {busy === 'otp-verify' ? 'Verifying…' : 'Verify'}
                    </button>
                    <button
                      type="button"
                      onClick={requestOtp}
                      disabled={busy !== null || cooldown > 0}
                      className="btn-secondary !py-2 text-xs disabled:opacity-50"
                    >
                      {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend SMS code'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Photo verification */}
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Camera className="h-4 w-4 text-emerald-600" />
            Photo verification
            <span className={`h-2 w-2 rounded-full ${verified ? 'bg-emerald-500' : pending.photo ? 'bg-amber-400' : 'bg-stone-300'}`} aria-hidden />
            <span className="text-xs font-normal text-stone-400">
              {verified ? 'approved' : pending.photo ? 'under review' : 'not submitted'}
            </span>
          </p>
          {!verified && !pending.photo && (
            <>
              <p className="mt-2 text-xs">
                {reason === 'not_published' || reason === 'profile_incomplete'
                  ? 'Publish your profile first, then request verification for the green badge.'
                  : 'Submit a fresh selfie — our team compares it with your profile photos and approves the verified badge.'}
              </p>
              <label className="btn-secondary mt-3 inline-flex cursor-pointer items-center gap-2 !py-2 text-xs">
                {busy === 'photo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Submit a selfie
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) submitDoc(f, 'photo')
                    e.target.value = ''
                  }}
                />
              </label>
            </>
          )}
          {!verified && pending.photo && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
              <Clock className="h-3.5 w-3.5" /> Under review — usually within a day.
            </p>
          )}
        </div>

        {/* ID document verification (optional) */}
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <IdCard className="h-4 w-4 text-emerald-600" />
            ID verification <span className="text-xs font-normal text-stone-400">(optional)</span>
            <span className={`ml-auto h-2 w-2 rounded-full ${verified ? 'bg-emerald-500' : pending.id_document ? 'bg-amber-400' : 'bg-stone-300'}`} aria-hidden />
            <span className="text-xs font-normal text-stone-400">
              {verified ? 'approved' : pending.id_document ? 'under review' : 'not submitted'}
            </span>
          </p>
          {!verified && !pending.id_document && (
            <>
              <p className="mt-2 text-xs">
                You can also submit a government ID (Aadhaar, PAN or passport) for additional
                verification. The document stays private — only our review team can see it.
              </p>
              <label className="btn-secondary mt-3 inline-flex cursor-pointer items-center gap-2 !py-2 text-xs">
                {busy === 'id_document' ? <Loader2 className="h-4 w-4 animate-spin" /> : <IdCard className="h-4 w-4" />}
                Upload ID document
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) submitDoc(f, 'id_document')
                    e.target.value = ''
                  }}
                />
              </label>
            </>
          )}
          {!verified && pending.id_document && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
              <Clock className="h-3.5 w-3.5" /> Under review — usually within a day.
            </p>
          )}
        </div>

        {info && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{info}</p>}
        {warn && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{warn}</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

/** "98765 43210" → "98•••••43210" — never show the full number. */
function maskMobile(mobile: string | null): string {
  const d = (mobile ?? '').replace(/\D/g, '')
  if (d.length < 4) return 'not on file'
  return `${d.slice(0, 2)}•••••${d.slice(-4)}`
}
