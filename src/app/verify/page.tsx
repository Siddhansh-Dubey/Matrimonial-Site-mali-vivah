'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, MailWarning, ShieldCheck } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/env'

/**
 * Landing spot for the email-confirmation link.
 *
 * Sign-up passes `emailRedirectTo = <origin>/verify`, so the "Confirm email"
 * link Supabase emails lands here. The browser client picks the confirmation
 * token out of the URL, stores the session cookies, and this page bounces
 * the new member straight to My Profile (with ?joined=1 for a welcome
 * nudge) — instead of dumping them on the homepage.
 *
 * Note: Supabase only honours redirect targets listed under
 * Dashboard → Authentication → URL Configuration → Redirect URLs.
 * If `/verify` is not allow-listed there, the link falls back to the Site
 * URL — the registration tab's auto-continue still saves the flow then.
 */
export default function VerifyLandingPage() {
  const router = useRouter()
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStalled(true)
      return
    }
    let cancelled = false
    let landed = false

    void (async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      const land = () => {
        if (landed || cancelled) return
        landed = true
        router.replace('/profile?joined=1')
      }

      // A session may already exist (reused link, or arriving signed-in).
      const existing = await supabase.auth.getSession()
      if (existing.data.session) {
        land()
        return
      }

      // Usual path: supabase-js reads the confirmation tokens from the URL
      // fragment/query, stores them, and notifies listeners.
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) land()
      })

      // An expired/used link must not leave us spinning forever.
      window.setTimeout(() => {
        if (!landed) setStalled(true)
        if (!cancelled) listener.subscription.unsubscribe()
      }, 6000)
    })()

    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <section className="bg-cream">
      <div className="container-page flex min-h-[calc(100dvh-10rem)] items-center justify-center py-12">
        <div className="card w-full max-w-md px-6 py-10 text-center sm:px-10">
          {stalled ? (
            <>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-100">
                <MailWarning className="h-7 w-7 text-gold-700" aria-hidden />
              </span>
              <h1 className="mt-5 font-display text-2xl font-bold text-stone-900">
                We could not complete the sign-in
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">
                This confirmation link may have expired or already been used. Sign in with your
                password — if your email is still unconfirmed, open a fresh link from your inbox.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link href="/login" className="btn-primary">
                  Go to login
                </Link>
                <Link href="/register" className="btn-secondary">
                  Register again
                </Link>
              </div>
            </>
          ) : (
            <>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50">
                {isSupabaseConfigured ? (
                  <Loader2 className="h-7 w-7 animate-spin text-brand-600" aria-hidden />
                ) : (
                  <ShieldCheck className="h-7 w-7 text-brand-600" aria-hidden />
                )}
              </span>
              <h1 className="mt-5 font-display text-2xl font-bold text-stone-900">
                Confirming your email…
              </h1>
              <p className="mt-3 text-sm text-stone-600">
                One moment — we are taking you straight to your profile to finish setting it up.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
