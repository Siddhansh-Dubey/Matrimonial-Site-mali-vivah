import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, Check, Crown, Gift, Heart, Lock, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import {
  fallbackPackages,
  getActiveSubscription,
  isPromotionalPlatinumSubscription,
  promotionalPlatinumLabel,
} from '@/lib/profile/subscription'
import { PurchaseButton } from '@/components/profile/purchase-button'
import { getSafeRedirect } from '@/lib/navigation'
import type { PackageRow } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Packages' }
export const dynamic = 'force-dynamic'

export default async function PackagesPage({
  searchParams,
}: {
  searchParams?: { payment?: string; next?: string; reason?: string }
}) {
  const supabase = isSupabaseConfigured ? createClient() : null
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } }

  const safeNext = searchParams?.next ? getSafeRedirect(searchParams.next, '') : ''

  // Live packages from the DB, with a static fallback when the table is missing.
  let packages: PackageRow[] = []
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (!error && data && data.length > 0) packages = data as PackageRow[]
    } catch {
      packages = []
    }
  }
  if (packages.length === 0) {
    packages = fallbackPackages() as unknown as PackageRow[]
  }

  const subscription = supabase ? await getActiveSubscription(supabase, user?.id ?? null) : null

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            Membership
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            Simple, honest packages
          </h1>
          <p className="mt-3 text-sm text-stone-600 sm:text-base">
            Free members see photos and occupations. Any package unlocks every profile detail —
            and the phone number is revealed once interest is mutual.
          </p>
        </div>

        {searchParams?.payment === 'success' && (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-sm">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <span>
                <span className="font-bold">Payment received.</span> {subscription ? (
                  <>Your membership is now active and your profile is being published in Brides &amp; Grooms. If your profile is not live within a minute, open <Link href="/profile/edit" className="font-semibold underline underline-offset-2">your profile</Link> and complete any missing details.</>
                ) : (
                  <>Your payment confirmation is being processed. Refresh this page in a moment to view your active membership.</>
                )}
              </span>
            </div>
            {safeNext ? (
              <div className="mt-4 border-t border-emerald-200/60 pt-3">
                <Link
                  href={safeNext}
                  className="btn-primary inline-flex items-center gap-2 text-xs py-2 px-4"
                >
                  Continue &rarr;
                </Link>
              </div>
            ) : null}
          </div>
        )}
        {searchParams?.payment === 'pending' && (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center text-sm text-amber-900">
            Razorpay has authorized the payment, but capture is still pending. Your membership is
            not shown as active until the server receives confirmation. Refresh this page shortly.
          </div>
        )}
        {searchParams?.payment === 'cancelled' && (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-stone-200 bg-white/70 px-5 py-4 text-center text-sm text-stone-600">
            Checkout was closed before the server confirmed a capture. Your payment may still be
            processing; refresh this page or contact support if you were charged.
          </div>
        )}

        {(searchParams?.reason === 'stories' || safeNext.includes('success-stories')) && !subscription && (
          <div className="mx-auto mt-8 flex max-w-2xl items-start gap-3 rounded-2xl border border-gold-400/50 bg-amber-50/80 px-5 py-4 text-sm text-maroon shadow-sm">
            <Heart className="mt-0.5 h-5 w-5 shrink-0 text-maroon fill-gold-300" />
            <div>
              <p className="font-bold">Submitting a Success Story is available to active paid members.</p>
              <p className="mt-1 text-stone-700">
                Choose any package below to activate your membership and share your journey with the Mali Samaj community.
              </p>
            </div>
          </div>
        )}

        {user && subscription && isPromotionalPlatinumSubscription(subscription) ? (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-gold-400/60 bg-gradient-to-br from-maroon-deep to-brand-800 px-5 py-4 text-sm text-white shadow-card-float">
            <div className="flex items-start gap-3">
              <Crown className="mt-0.5 h-5 w-5 shrink-0 text-gold-300" aria-hidden />
              <span>
                <span className="font-display text-base font-bold text-gold-200">
                  Platinum Launch Offer — free, active membership
                </span>
                <span className="mt-1 block text-white/85">
                  You hold{' '}
                  <span className="font-semibold">
                    {promotionalPlatinumLabel(subscription.package_slug)}
                  </span>{' '}
                  until <span className="font-semibold">{formatDate(subscription.expires_at)}</span>.
                  All profile details are unlocked for you. This is a promotional grant — you were
                  not charged and no payment was created. When it ends your profile hides again
                  unless you pick a paid package below.
                </span>
              </span>
            </div>
            {safeNext ? (
              <div className="mt-4 border-t border-white/15 pt-3">
                <Link
                  href={safeNext}
                  className="inline-flex items-center gap-2 rounded-full bg-gold-400 px-4 py-2 text-xs font-bold text-maroon-deep hover:bg-gold-300"
                >
                  Continue &rarr;
                </Link>
              </div>
            ) : null}
          </div>
        ) : user && subscription ? (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-sm">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <span>
                You hold an active package
                {subscription.package_slug ? (
                  <>
                    {' '}
                    (<span className="font-semibold">{prettySlug(subscription.package_slug)}</span>)
                  </>
                ) : null}
                , valid till{' '}
                <span className="font-semibold">{formatDate(subscription.expires_at)}</span>. All
                profile details are unlocked for you.
              </span>
            </div>
            {safeNext ? (
              <div className="mt-4 border-t border-emerald-200/60 pt-3">
                <Link
                  href={safeNext}
                  className="btn-primary inline-flex items-center gap-2 text-xs py-2 px-4"
                >
                  Continue &rarr;
                </Link>
              </div>
            ) : null}
          </div>
        ) : user ? (
          <div className="mx-auto mt-8 flex max-w-2xl items-start gap-3 rounded-2xl border border-gold-400/50 bg-gold-100/50 px-5 py-4 text-sm text-maroon-deep">
            <Lock className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              You are on the <span className="font-semibold">free plan</span> — photos and
              occupations only. Choose any package below to unlock full profiles.
            </span>
          </div>
        ) : (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-stone-200 bg-white/70 px-5 py-4 text-center text-sm text-stone-600">
            <Link
              href={safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : '/login'}
              className="font-semibold text-maroon underline underline-offset-2"
            >
              Log in
            </Link>{' '}
            to purchase a package, or{' '}
            <Link
              href={safeNext ? `/register?next=${encodeURIComponent(safeNext)}` : '/register'}
              className="font-semibold text-maroon underline underline-offset-2"
            >
              register free
            </Link>{' '}
            first.
          </div>
        )}

        {/* Platinum Launch Offer — temporary launch promotion. FREE grants,
            never a purchasable package and never worded as a payment. The
            three paid packages below (and their prices) are unchanged. */}
        <div className="mx-auto mt-10 max-w-5xl rounded-[26px] border border-gold-400/50 bg-gold-100/40 px-7 py-6 ring-1 ring-gold-300/40">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-maroon-deep text-gold-300">
              <Crown className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-gold-700">
                Limited-time launch promotion
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold text-maroon">
                Platinum Launch Offer — free, no payment needed
              </h2>
              <ul className="mt-3 grid gap-2.5 text-sm text-stone-700 sm:grid-cols-2">
                <li className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" aria-hidden />
                  <span>
                    <span className="font-bold text-maroon">First 100 members:</span> complete your
                    profile and receive a <span className="font-semibold">free 30-day Platinum</span>{' '}
                    membership — one per member, first come first served.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Gift className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" aria-hidden />
                  <span>
                    <span className="font-bold text-maroon">After the first 100:</span> complete your
                    profile for a <span className="font-semibold">free 24-hour Platinum demo</span>{' '}
                    — granted automatically, exactly once.
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                Platinum is a promotional tier with full paid-member capabilities: public profile,
                search &amp; recommendations, Express Interest, advanced filters, biodata download
                on mutual match and more. It is granted free by the server when your required
                profile details are complete — it is never sold and no payment is ever created for
                it. Paid Smart / Premium / VIP memberships are unaffected: a promotional grant can
                never shorten a paid plan.
              </p>
            </div>
          </div>
        </div>

        <ul className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {packages.map((pkg, i) => {
            const featured = i === 1
            return (
              <li
                key={pkg.slug}
                className={[
                  'relative flex flex-col rounded-[26px] p-7 ring-1',
                  featured
                    ? 'bg-maroon-deep text-white shadow-2xl shadow-maroon/30 ring-maroon-deep'
                    : 'bg-white text-stone-800 shadow-card-float ring-stone-100',
                ].join(' ')}
              >
                {featured && (
                  <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-gold-400 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wide text-maroon-deep shadow">
                    <Crown className="h-3.5 w-3.5" /> Most popular
                  </span>
                )}
                <h2 className={`font-display text-xl font-bold ${featured ? 'text-white' : 'text-maroon'}`}>
                  {pkg.name}
                </h2>
                <p className={`mt-1 text-[13px] ${featured ? 'text-white/70' : 'text-stone-500'}`}>
                  {pkg.description}
                </p>
                <p className="mt-4 flex items-baseline gap-1.5">
                  <span className={`font-display text-4xl font-bold ${featured ? 'text-gold-300' : 'text-maroon'}`}>
                    ₹{pkg.price_inr.toLocaleString('en-IN')}
                  </span>
                  <span className={`text-xs ${featured ? 'text-white/60' : 'text-stone-500'}`}>
                    / {pkg.duration_days} days
                  </span>
                </p>
                <ul className={`mt-5 flex-1 space-y-2.5 text-[13.5px] ${featured ? 'text-white/85' : 'text-stone-600'}`}>
                  {pkg.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? 'text-gold-300' : 'text-emerald-600'}`} />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {user ? (
                    <PurchaseButton
                      packageId={pkg.id}
                      packageSlug={pkg.slug}
                      priceInr={pkg.price_inr}
                      featured={featured}
                      hasActive={Boolean(subscription)}
                      next={safeNext || undefined}
                    />
                  ) : (
                    <Link
                      href={safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : '/login'}
                      className={
                        featured
                          ? 'inline-flex w-full items-center justify-center rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep hover:bg-gold-300'
                          : 'btn-secondary w-full'
                      }
                    >
                      Log in to buy
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mx-auto mt-10 max-w-3xl rounded-2xl bg-white/70 px-6 py-5 text-center text-[13px] leading-relaxed text-stone-600 ring-1 ring-stone-200/60">
          <span className="font-semibold text-maroon">How phone reveal works:</span> purchase any
          package to see every profile detail. The phone number appears only after{' '}
          <span className="font-semibold">both sides express interest</span> in each other — a
          mutual match. Free members always see photos and occupations.
        </div>
      </div>
    </section>
  )
}

function prettySlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
