'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Heart, Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { InterestStatus } from '@/lib/supabase/database.types'

/**
 * Accept / Decline for a RECEIVED interest.
 * Accepting converges the pair to a mutual match: if you had already expressed
 * interest back, that reverse row is marked accepted too.
 */
export function InterestActions({
  interestId,
  current,
  isMutual = false,
}: {
  interestId: number
  current: InterestStatus
  /** True when the pair already expressed interest both ways. */
  isMutual?: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<InterestStatus>(current)
  const [mutual, setMutual] = useState(isMutual || current === 'accepted')
  const [loading, setLoading] = useState(false)

  /**
   * Accept or decline a RECEIVED interest. The receiver row-update policy
   * allows exactly these transitions; the database trigger notifies the
   * sender. A single `accepted` row already counts as mutual interest, so
   * there is nothing more to converge client-side — reverse convergence is
   * server-side in express_interest() (the only write path for senders).
   */
  async function respond(next: InterestStatus) {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from('interests').update({ status: next }).eq('id', interestId)
    if (!error) {
      setStatus(next)
      if (next === 'accepted') setMutual(true)
      router.refresh()
    }
    setLoading(false)
  }

  if (status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
        {mutual ? <Heart className="h-3.5 w-3.5 fill-current" /> : <Check className="h-3.5 w-3.5" />}
        {mutual ? 'Mutual match' : 'Accepted'}
      </span>
    )
  }
  if (status === 'declined') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
        Declined
      </span>
    )
  }
  if (status === 'withdrawn') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
        Withdrawn
      </span>
    )
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => respond('accepted')}
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Accept
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => respond('declined')}
        className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-600 hover:border-stone-400"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        Decline
      </button>
    </div>
  )
}
