'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * Mock purchase — creates an `active` subscription row directly.
 * Swap the body of `buy()` for a real payment-gateway flow (Razorpay /
 * Stripe) when payments are wired up; the gating logic (has_active_subscription
 * + mutual interest) stays exactly the same.
 */
export function PurchaseButton({
  packageId,
  packageSlug,
  durationDays,
  featured = false,
  hasActive = false,
}: {
  packageId: number
  packageSlug: string
  durationDays: number
  featured?: boolean
  hasActive?: boolean
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function buy() {
    setState('loading')
    setError(null)
    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) {
        router.push('/login')
        return
      }
      const startedAt = new Date()
      const expiresAt = new Date(startedAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
      const { error: insertError } = await supabase.from('subscriptions').insert({
        user_id: uid,
        package_id: packageId > 0 ? packageId : null,
        package_slug: packageSlug,
        status: 'active',
        started_at: startedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      if (insertError) {
        // Table missing (migration not applied) → explain instead of failing silently.
        if (insertError.message.includes('subscriptions') || (insertError as { code?: string }).code === '42P01') {
          setError('Packages are not enabled on the database yet — ask support to run the latest migration.')
        } else {
          setError(insertError.message)
        }
        setState('error')
        return
      }
      setState('done')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <p className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white">
        <Check className="h-4 w-4" /> Activated — enjoy!
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={buy}
        disabled={state === 'loading'}
        className={
          featured
            ? 'inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep shadow-lg hover:bg-gold-300 disabled:opacity-60'
            : 'btn-primary w-full disabled:opacity-60'
        }
      >
        {state === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
        {hasActive ? 'Extend / switch to this plan' : 'Choose this plan'}
      </button>
      {error && <p className="text-xs text-brand-700">{error}</p>}
      <p className={`text-center text-[11px] ${featured ? 'text-white/60' : 'text-stone-500'}`}>
        Demo checkout — activates instantly, no payment needed yet.
      </p>
    </div>
  )
}
