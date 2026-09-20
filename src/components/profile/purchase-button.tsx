'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, Loader2, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { getSafeRedirect } from '@/lib/navigation'

/**
 * Real Razorpay Standard Checkout.
 *
 * Flow: POST /api/payments/order (package slug only — NEVER an amount) →
 * open Razorpay checkout with the server-created order id → on success, POST
 * /api/payments/verify → server re-signs order_id|payment_id with the secret
 * and activates the membership. The webhook remains the authoritative path;
 * this handles the normal closed-loop case instantly.
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

export function PurchaseButton({
  packageId,
  packageSlug,
  priceInr,
  featured = false,
  hasActive = false,
  next,
}: {
  packageId: number
  packageSlug: string
  priceInr: number
  featured?: boolean
  hasActive?: boolean
  next?: string
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'verifying'>('idle')
  const [error, setError] = useState<string | null>(null)
  const attemptKey = useRef<string | null>(null)

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
    if (packageId <= 0) {
      setError('Packages are not loaded from the database yet — please retry shortly.')
      return
    }

    setState('loading')
    attemptKey.current ??= crypto.randomUUID()
    try {
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': attemptKey.current,
        },
        body: JSON.stringify({ packageId, packageSlug, idempotencyKey: attemptKey.current }),
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
        attemptKey.current = null
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
      const opts: Record<string, unknown> = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency ?? 'INR',
        name: 'Mali Vivah',
        description: order.packageName ? `${order.packageName} membership` : 'Membership',
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
            const body = (await verifyRes.json().catch(() => ({}))) as {
              error?: string
              status?: string
            }
            const isPending = verifyRes.status === 202 || body.status === 'pending'
            if (verifyRes.ok && !isPending) {
              attemptKey.current = null
              const dest = next ? getSafeRedirect(next, '/packages?payment=success') : '/packages?payment=success'
              router.push(dest)
              router.refresh()
            } else if (isPending) {
              setError('Payment is authorized and awaiting capture. Your membership will activate after Razorpay confirms it. Please refresh this page shortly.')
              setState('idle')
              router.push('/packages?payment=pending')
              router.refresh()
            } else {
              setError(body.error ?? 'Verification failed. Contact support if you were charged.')
              setState('idle')
            }
          } catch {
            setError('Could not verify the payment. Contact support if you were charged.')
            setState('idle')
          }
        },
        modal: {
          ondismiss: () => {
            setState('idle')
            router.push(next ? `/packages?payment=cancelled&next=${encodeURIComponent(next)}` : '/packages?payment=cancelled')
          },
        },
      }
      const instance = new Checkout(opts)
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
        className={
          featured
            ? 'inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep shadow-lg hover:bg-gold-300 disabled:opacity-60'
            : 'btn-primary w-full disabled:opacity-60'
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
        {state === 'verifying'
          ? 'Verifying payment…'
          : state === 'loading'
            ? 'Starting secure checkout…'
            : hasActive
              ? 'Extend / switch to this plan'
              : `Pay ₹${priceInr.toLocaleString('en-IN')}`}
      </button>
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-brand-700">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      <p className={`text-center text-[11px] ${featured ? 'text-white/60' : 'text-stone-500'}`}>
        Secure payment by Razorpay — your details never leave the payment page.
      </p>
    </div>
  )
}
