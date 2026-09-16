'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Flag, Heart, Loader2, ShieldBan } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { mutualFromStatuses } from '@/lib/profile/visibility'
import { LOCKED_ACTION_COPY } from '@/lib/supabase/database.types'
import type { InterestStatus, ReportReason } from '@/lib/supabase/database.types'

type InterestUi = 'idle' | 'loading' | 'sent' | 'mutual' | 'declined' | 'error'

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'fake_profile', label: 'Fake profile' },
  { value: 'incorrect_information', label: 'Incorrect information' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
]

/** Turn an RPC error into member-facing copy, keeping the locked PRD text. */
function friendlyError(message: string): { text: string; upgrade: boolean } {
  if (message.includes('PAID_MEMBERSHIP_REQUIRED')) {
    return { text: LOCKED_ACTION_COPY, upgrade: true }
  }
  if (message.includes('TARGET_UNAVAILABLE')) {
    return { text: 'This profile is not available right now.', upgrade: false }
  }
  if (message.includes('INTEREST_LIMIT_REACHED')) {
    return {
      text: 'You have reached the interest limit of your current plan for this month. Upgrade for more.',
      upgrade: true,
    }
  }
  if (message.includes('PROFILE_INCOMPLETE')) {
    return {
      text: 'Complete your profile (including a family photo) before expressing interest.',
      upgrade: false,
    }
  }
  return { text: message, upgrade: false }
}

/**
 * Express Interest + Report + Block.
 * Expressing goes through the express_interest() RPC: paid members only,
 * server-enforced limits, blocked/mutual handling, and the reverse-accept
 * convergence are all decided in the database — the UI just renders the result.
 */
export function ProfileActions({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [interest, setInterest] = useState<InterestUi>('idle')
  const [blocked, setBlocked] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason>('fake_profile')
  const [reportDetails, setReportDetails] = useState('')
  const [reportDone, setReportDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null)

  // Load current relationship state on mount (both directions).
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const supabase = createClient()
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return
      const [fwdRes, revRes, blockRes] = await Promise.all([
        supabase
          .from('interests')
          .select('status')
          .eq('sender_id', uid)
          .eq('receiver_id', profileId)
          .maybeSingle(),
        supabase
          .from('interests')
          .select('status')
          .eq('sender_id', profileId)
          .eq('receiver_id', uid)
          .maybeSingle(),
        supabase
          .from('blocks')
          .select('id')
          .eq('blocker_id', uid)
          .eq('blocked_id', profileId)
          .maybeSingle(),
      ])
      const fwd = (fwdRes.data?.status as InterestStatus | undefined) ?? null
      const rev = (revRes.data?.status as InterestStatus | undefined) ?? null
      if (fwd === 'declined' || rev === 'declined') setInterest('declined')
      else if (mutualFromStatuses(fwd, rev)) setInterest('mutual')
      else if (fwd) setInterest('sent')
      if (blockRes.data) setBlocked(true)
    }
    load()
  }, [profileId])

  async function expressInterest() {
    if (!isSupabaseConfigured) return
    setInterest('loading')
    setError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) {
        router.push('/login')
        return
      }
      const { data, error: rpcError } = await supabase.rpc('express_interest', {
        p_target_id: profileId,
      })
      if (rpcError) {
        setError(friendlyError(rpcError.message))
        setInterest('idle')
        return
      }
      const status = typeof data === 'string' ? data : (data as { status?: string } | null)?.status
      setInterest(status === 'mutual' ? 'mutual' : 'sent')
      router.refresh()
    } catch {
      setError({ text: 'Something went wrong. Please try again.', upgrade: false })
      setInterest('idle')
    }
  }

  async function submitReport() {
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
      const { error: insertError } = await supabase.from('reports').insert({
        reporter_id: uid,
        reported_id: profileId,
        reason: reportReason,
        details: reportDetails.trim() || null,
      })
      if (insertError) {
        setError({ text: insertError.message, upgrade: false })
      } else {
        setReportDone(true)
        setReportOpen(false)
      }
    } catch {
      setError({ text: 'Something went wrong. Please try again.', upgrade: false })
    }
    setBusy(false)
  }

  async function toggleBlock() {
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
      if (blocked) {
        await supabase.from('blocks').delete().eq('blocker_id', uid).eq('blocked_id', profileId)
        setBlocked(false)
      } else {
        const { error: insertError } = await supabase.from('blocks').insert({
          blocker_id: uid,
          blocked_id: profileId,
        })
        if (insertError && insertError.code !== '23505') {
          setError({ text: insertError.message, upgrade: false })
        } else {
          setBlocked(true)
        }
      }
    } catch {
      setError({ text: 'Something went wrong. Please try again.', upgrade: false })
    }
    setBusy(false)
  }

  const interestLoading = interest === 'loading'
  const done = interest === 'sent' || interest === 'mutual'

  if (blocked) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          You have blocked this member — they cannot see your profile or contact you.
        </p>
        <button
          type="button"
          onClick={toggleBlock}
          disabled={busy}
          className="btn-secondary"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
          Unblock member
        </button>
        {error && <p className="text-sm text-brand-700">{error.text}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {interest === 'mutual' && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-900">
          It&apos;s a mutual match — you both expressed interest in each other.
        </p>
      )}
      {interest === 'declined' && (
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-600">
          This interest was declined. You may report or block the profile if needed.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={expressInterest}
          disabled={interestLoading || done || interest === 'declined'}
          className={['btn-primary', done ? 'opacity-90' : ''].join(' ')}
        >
          {interestLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : done ? (
            <Check className="h-4 w-4" />
          ) : (
            <Heart className="h-4 w-4" />
          )}
          {interest === 'mutual'
            ? 'Mutual interest'
            : interest === 'sent'
              ? 'Interest sent'
              : interest === 'declined'
                ? 'Interest declined'
                : 'Express Interest'}
        </button>

        <button
          type="button"
          onClick={() => setReportOpen((v) => !v)}
          disabled={reportDone}
          className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
        >
          <Flag className="h-4 w-4" />
          {reportDone ? 'Reported' : 'Report'}
        </button>

        <button
          type="button"
          onClick={toggleBlock}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
          Block
        </button>
      </div>

      {reportOpen && (
        <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <p className="text-sm font-semibold text-stone-800">Report this profile</p>
          <select
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value as ReportReason)}
            className="input w-full"
          >
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            placeholder="Optional — tell us what happened"
            rows={3}
            className="input w-full resize-none"
            maxLength={2000}
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitReport} disabled={busy} className="btn-primary !py-2 text-xs">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit report
            </button>
            <button type="button" onClick={() => setReportOpen(false)} className="btn-secondary !py-2 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}
      {reportDone && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          Thank you — our team will review this report.
        </p>
      )}

      {error && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-700">{error.text}</p>
          {error.upgrade && (
            <a href="/packages" className="btn-primary inline-flex !py-2 text-xs">
              View packages
            </a>
          )}
        </div>
      )}
      <p className="text-xs text-stone-500">
        The phone number is revealed only after both sides express interest — and only for
        members with an active package.
      </p>
    </div>
  )
}
