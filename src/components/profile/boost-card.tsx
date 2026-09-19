'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Rocket } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { BoostPurchaseButton } from '@/components/profile/boost-purchase-button'

/**
 * Profile boost: calls boost_my_profile() which enforces the plan's
 * boosts_included quota and returns the remaining usage. A boosted profile
 * sorts first in browse/search while the boost is live.
 *
 * When the plan quota is exhausted (or the plan has none), the member can
 * buy an à la carte boost instead — priced from site_config, activated by
 * activate_purchased_boost(), never quota-counted.
 */
export function BoostCard({
  hasActive,
  status,
  isPaid,
  boostPriceInr,
  boostDays,
}: {
  hasActive: boolean
  /** matrimony profile status — free/expired members are 'hidden'. */
  status: string
  /** Member holds a live paid plan (server-computed). */
  isPaid: boolean
  /** À la carte boost price + duration (server-read from site_config). */
  boostPriceInr: number
  boostDays: number
}) {
  const router = useRouter()
  const [active, setActive] = useState(hasActive)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [quotaExhausted, setQuotaExhausted] = useState(false)

  async function boost() {
    if (!isSupabaseConfigured) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('boost_my_profile')
      if (rpcError) {
        const msg = rpcError.message
        if (msg.includes('BOOSTS_NOT_INCLUDED')) {
          setError('Boosts are part of paid plans. Upgrade to rocket your profile to the top.')
        } else if (msg.includes('BOOST_LIMIT_REACHED')) {
          setQuotaExhausted(true)
          setError('You have used all the boosts included in your current plan.')
        } else {
          setError(msg)
        }
        return
      }
      const res = data as { status?: string; expires_at?: string } | null
      if (res?.status === 'active' || res?.status === 'already_active') {
        setActive(true)
        setMessage(
          res.status === 'already_active'
            ? 'Your boost is already running.'
            : `Boost activated — your profile appears first in search for the next ${boostDays} days.`
        )
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function onPurchased() {
    setActive(true)
    setQuotaExhausted(false)
    setError(null)
    setMessage(
      `Boost activated — your profile appears first in search for the next ${boostDays} days.`
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-stone-100 bg-gradient-to-r from-gold-100/70 to-cream px-6 py-4">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-gold-600" aria-hidden />
          <h2 className="font-display text-lg font-bold text-maroon">Profile boost</h2>
        </div>
        {active && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-maroon-deep">
            Boosted
          </span>
        )}
      </div>
      <div className="p-6">
        <p className="text-sm text-stone-600">
          {active
            ? 'Your boost is live — you appear first in Brides, Grooms and Search while it lasts.'
            : `Rocket your profile to the very top of Brides, Grooms and Search for ${boostDays} days.`}
        </p>
        {!active && isPaid && !quotaExhausted && (
          <button
            type="button"
            onClick={boost}
            disabled={busy}
            className="btn-primary mt-4"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Boost my profile now
          </button>
        )}
        {!active && !isPaid && (
          <a href="/packages" className="btn-secondary mt-4 inline-flex items-center gap-2">
            <Rocket className="h-4 w-4" /> Boosts are a paid-plan benefit
          </a>
        )}
        {!active && quotaExhausted && (
          <div className="mt-4">
            <BoostPurchaseButton priceInr={boostPriceInr} days={boostDays} onDone={onPurchased} />
          </div>
        )}
        {!active && isPaid && status !== 'active' && (
          <p className="mt-3 text-xs text-stone-500">
            Publish your profile first (finish the checklist above) — a boost is only useful once
            you are visible.
          </p>
        )}
        {message && <p className="mt-3 text-sm font-semibold text-emerald-800">{message}</p>}
        {error && (
          <p className="mt-3 text-sm font-semibold text-brand-700">
            {error}{' '}
            {!quotaExhausted && (
              <a href="/packages" className="underline underline-offset-2">
                View packages
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
