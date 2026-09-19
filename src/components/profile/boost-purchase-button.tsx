'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Rocket } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'

/**
 * À la carte boost purchase (Razorpay Standard Checkout, kind: 'boost').
 * The server prices the boost from site_config and activates it through
 * activate_purchased_boost() — purchased boosts never consume plan quota.
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

export function BoostPurchaseButton({
  priceInr,
  days,
  onDone,
}: {
  priceInr: number
  days: number
  onDone: () => void
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'verifying'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function buy() {
    setError(null)
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured.')
      return
    }
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) {
      router.push('/login')
      return
    }

    setState('loading')
    try {
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'boost' }),
      })
      const order = (await res.json()) as {
        error?: string
        keyId?: string
        orderId?: string
        amount?: number
        currency?: string
        packageName?: string
        prefill?: { name?: string; email?: string; contact?: string }
      }
      if (!res.ok || !order.orderId || !order.keyId) {
        setError(order.error ?? 'Could not start the payment. Please try again.')
        setState('idle')
        return
      }

      const loaded = await loadCheckoutScript()
      if (!loaded || !window.Razorpay) {
        setError('Could not load the payment page. Check your connection and try again.')
        setState('idle')
        return
      }

      const Checkout = window.Razorpay
      const instance = new Checkout({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency ?? 'INR',
        name: 'Mali Vivah',
        description: order.packageName ?? 'Profile Boost',
        order_id: order.orderId,
        prefill: order.prefill ?? {},
        theme: { color: '#9e0b1e' },
        handler: async (response: {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
        }) => {
          setState('verifying')
          try {
            const verifyRes = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            })
            if (verifyRes.ok) {
              setState('idle')
              onDone()
              router.refresh()
            } else {
              const body = (await verifyRes.json()) as { error?: string }
              setError(body.error ?? 'Verification failed. Contact support if you were charged.')
              setState('idle')
            }
          } catch {
            setError('Could not verify the payment. Contact support if you were charged.')
            setState('idle')
          }
        },
        modal: { ondismiss: () => setState('idle') },
      })
      instance.open()
    } catch {
      setError('Something went wrong. Please try again.')
      setState('idle')
    }
  }

  const busy = state !== 'idle'

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={buy}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-maroon px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-maroon/25 hover:bg-maroon-dark disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        {state === 'verifying'
          ? 'Verifying payment…'
          : state === 'loading'
            ? 'Starting secure checkout…'
            : `Buy a ${days}-day boost · ₹${priceInr.toLocaleString('en-IN')}`}
      </button>
      {error && <p className="text-xs font-semibold text-brand-700">{error}</p>}
    </div>
  )
}
