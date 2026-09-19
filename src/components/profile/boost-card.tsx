'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Rocket } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { BoostPurchaseButton } from '@/components/profile/boost-purchase-button'

/**
 * Profile boost.
 *
 * Two real paths — both server-authoritative:
 *  1. INCLUDED boosts: boost_my_profile() enforces the plan's
 *     boosts_included quota (7-day boost, no payment).
 *  2. PURCHASED add-on: when the included quota is exhausted (or the member
 *     wants an extra boost), buy a standalone boost for the admin-configured
 *     price (profile_boost_config) through the same Razorpay order/verify/
 *     webhook pipeline as packages (payments.kind = 'boost'). The order API
 *     refuses to sell a boost while one is already running, and activation
 *     only happens after Razorpay signature verification — never on
 *     frontend success.
 */
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false)
    if (window.Razorpay) return resolve(true)
    const existing = document.querySelector('script[data-razorpay-checkout]')
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.razorpayCheckout = '1'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export function BoostCard({
  hasActive,
  status,
  isPaid,
  boostAddon,
}: {
  hasActive: boolean
  /** matrimony profile status — free/expired members are 'hidden'. */
  status: string
  /** Member holds a live paid plan (server-computed). */
  isPaid: boolean
  /** Admin-configured standalone boost add-on (null when unavailable). */
  boostAddon: { priceInr: number; durationDays: number } | null
}) {
  const router = useRouter()
  const [active, setActive] = useState(hasActive)
  const [busy, setBusy] = useState(false)
  const [buying, setBuying] = useState(false)
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

  /** Standalone boost purchase — Razorpay Standard Checkout, server-priced. */
  async function buyBoost() {
    if (!isSupabaseConfigured || !boostAddon) return
    setBuying(true)
    setError(null)
    setMessage(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) {
        router.push('/login')
        return
      }
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'boost' }),
      })
      const order = (await res.json()) as {
        error?: string
        keyId?: string
        orderId?: string
        amount?: number
        currency?: string
        itemName?: string
        prefill?: { name?: string; email?: string; contact?: string }
      }
      if (!res.ok || !order.orderId || !order.keyId) {
        setError(order.error ?? 'Could not start the boost purchase. Please try again.')
        setBuying(false)
        return
      }
      const loaded = await loadCheckoutScript()
      if (!loaded || !window.Razorpay) {
        setError('Could not load the payment page. Check your connection and try again.')
        setBuying(false)
        return
      }
      const Checkout = window.Razorpay
      const checkout = new Checkout({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency ?? 'INR',
        name: 'Mali Vivah',
        description: order.itemName ?? 'Profile Boost',
        prefill: order.prefill,
        theme: { color: '#8a1122' },
        modal: { ondismiss: () => setBuying(false) },
        handler: async (payload: {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
        }) => {
          try {
            const v = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            const vBody = (await v.json().catch(() => ({}))) as { error?: string }
            if (!v.ok) {
              setError(vBody.error ?? 'Payment verified, but activation failed. Please contact support.')
              return
            }
            setBuying(false)
            setActive(true)
            setMessage('Boost activated — your profile appears first in search while it lasts.')
            router.refresh()
          } catch {
            setError('Could not confirm the payment. It will activate automatically if captured.')
          }
        },
      })
      checkout.open()
    } catch {
      setError('Could not start the boost purchase. Please try again.')
      setBuying(false)
    }
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
        {!active && isPaid && (
          <>
            <button
              type="button"
              onClick={boost}
              disabled={busy}
              className="btn-primary mt-4"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Boost my profile now
            </button>
            <p className="mt-1.5 text-[11px] text-stone-400">
              Uses a boost included in your plan — free for you.
            </p>

            {boostAddon && (
              <div className="mt-4 rounded-xl border border-gold-300/70 bg-gold-50/70 p-4">
                <p className="text-sm font-semibold text-stone-900">
                  Need an extra boost?
                </p>
                <p className="mt-1 text-xs leading-relaxed text-stone-600">
                  Purchase a standalone {boostAddon.durationDays}-day boost anytime — even after
                  your included boosts are used.
                </p>
                <button
                  type="button"
                  onClick={buyBoost}
                  disabled={buying}
                  className="btn-secondary mt-3 inline-flex items-center gap-2 !py-2 text-xs disabled:opacity-50"
                >
                  {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Buy boost · ₹{boostAddon.priceInr.toLocaleString('en-IN')} · {boostAddon.durationDays} days
                </button>
              </div>
            )}
          </>
        )}
        {!active && !isPaid && (
          <a href="/packages" className="btn-secondary mt-4 inline-flex items-center gap-2">
            <Rocket className="h-4 w-4" /> Boosts are a paid-plan benefit
          </a>
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
