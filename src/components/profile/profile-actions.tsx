'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Heart, Loader2, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'

type State = 'idle' | 'loading' | 'interested' | 'already' | 'shortlisted' | 'error'

export function ProfileActions({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [interest, setInterest] = useState<State>('idle')
  const [shortlisted, setShortlisted] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  // Load current relationship state on mount.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const supabase = createClient()
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) return
      const [intRes, shortRes] = await Promise.all([
        supabase.from('interests').select('status').eq('sender_id', uid).eq('receiver_id', profileId).maybeSingle(),
        supabase.from('shortlists').select('id').eq('user_id', uid).eq('target_id', profileId).maybeSingle(),
      ])
      if (intRes.data) setInterest(intRes.data.status === 'pending' ? 'interested' : 'already')
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
      const { error } = await supabase
        .from('interests')
        .upsert({ sender_id: uid, receiver_id: profileId, status: 'pending' }, { onConflict: 'sender_id,receiver_id' })
      if (error) {
        setError(error.message)
        setInterest('error')
      } else {
        setInterest('interested')
      }
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={expressInterest}
          disabled={interestLoading || interest === 'interested' || interest === 'already'}
          className={[
            'btn-primary',
            interest === 'interested' || interest === 'already' ? 'opacity-80' : '',
          ].join(' ')}
        >
          {interestLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : interest === 'interested' || interest === 'already' ? (
            <Check className="h-4 w-4" />
          ) : (
            <Heart className="h-4 w-4" />
          )}
          {interest === 'already'
            ? 'Interest already sent'
            : interest === 'interested'
              ? 'Interest sent'
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
        Contact details are shared only after both families agree — your interest is kept private.
      </p>
    </div>
  )
}
