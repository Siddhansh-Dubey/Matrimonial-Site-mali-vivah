'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Heart, Loader2, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { mutualFromStatuses } from '@/lib/profile/visibility'
import type { InterestStatus } from '@/lib/supabase/database.types'

type InterestUi = 'idle' | 'loading' | 'sent' | 'mutual' | 'declined' | 'error'
type ShortUi = 'idle' | 'loading' | 'shortlisted' | 'error'

/**
 * Express Interest + Shortlist.
 * Mutual rule: the phone number is revealed (for paid members) only when BOTH
 * sides showed interest — an `accepted` row either way, or live rows in both
 * directions. When you express interest back to someone who already expressed
 * interest in you, both rows converge to `accepted` so the match is explicit.
 */
export function ProfileActions({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [interest, setInterest] = useState<InterestUi>('idle')
  const [shortlisted, setShortlisted] = useState<ShortUi>('idle')
  const [error, setError] = useState<string | null>(null)

  // Load current relationship state on mount (both directions).
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const supabase = createClient()
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return
      const [fwdRes, revRes, shortRes] = await Promise.all([
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
          .from('shortlists')
          .select('id')
          .eq('user_id', uid)
          .eq('target_id', profileId)
          .maybeSingle(),
      ])
      const fwd = (fwdRes.data?.status as InterestStatus | undefined) ?? null
      const rev = (revRes.data?.status as InterestStatus | undefined) ?? null
      if (fwd === 'declined' || rev === 'declined') setInterest('declined')
      else if (mutualFromStatuses(fwd, rev)) setInterest('mutual')
      else if (fwd) setInterest('sent')
      if (shortRes.data) setShortlisted('shortlisted')
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
      // 1. Record our interest in them.
      const { error: upsertError } = await supabase.from('interests').upsert(
        { sender_id: uid, receiver_id: profileId, status: 'pending' },
        { onConflict: 'sender_id,receiver_id' }
      )
      if (upsertError) {
        setError(upsertError.message)
        setInterest('error')
        return
      }
      // 2. Did they already express interest in us? If so, converge BOTH rows
      // to `accepted` — this is now an explicit mutual match.
      const { data: reverse } = await supabase
        .from('interests')
        .select('id, status')
        .eq('sender_id', profileId)
        .eq('receiver_id', uid)
        .maybeSingle()
      if (reverse && (reverse.status === 'pending' || reverse.status === 'accepted')) {
        await Promise.all([
          supabase.from('interests').update({ status: 'accepted' }).eq('id', reverse.id),
          supabase
            .from('interests')
            .update({ status: 'accepted' })
            .eq('sender_id', uid)
            .eq('receiver_id', profileId),
        ])
        setInterest('mutual')
      } else {
        setInterest('sent')
      }
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
      setInterest('error')
    }
  }

  async function toggleShortlist() {
    if (!isSupabaseConfigured) return
    setShortlisted('loading')
    setError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) {
        router.push('/login')
        return
      }
      if (shortlisted === 'shortlisted') {
        await supabase.from('shortlists').delete().eq('user_id', uid).eq('target_id', profileId)
        setShortlisted('idle')
      } else {
        const { error } = await supabase.from('shortlists').insert({ user_id: uid, target_id: profileId })
        if (error) {
          // Already shortlisted → treat as success.
          if (error.code === '23505') setShortlisted('shortlisted')
          else {
            setError(error.message)
            setShortlisted('error')
          }
        } else {
          setShortlisted('shortlisted')
        }
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setShortlisted('error')
    }
  }

  const interestLoading = interest === 'loading'
  const shortLoading = shortlisted === 'loading'
  const done = interest === 'sent' || interest === 'mutual'

  return (
    <div className="space-y-3">
      {interest === 'mutual' && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-900">
          It&apos;s a mutual match — you both expressed interest in each other.
        </p>
      )}
      {interest === 'declined' && (
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-600">
          This interest was declined. You can still shortlist the profile.
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
          onClick={toggleShortlist}
          disabled={shortLoading}
          className={shortlisted === 'shortlisted' ? 'btn-primary' : 'btn-secondary'}
        >
          {shortLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Star className={`h-4 w-4 ${shortlisted === 'shortlisted' ? 'fill-current' : ''}`} />
          )}
          {shortlisted === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
        </button>
      </div>

      {error && <p className="text-sm text-brand-700">{error}</p>}
      <p className="text-xs text-stone-500">
        The phone number is revealed only after both sides express interest — and only for
        members with an active package.
      </p>
    </div>
  )
}
