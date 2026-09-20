import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, Check, Crown, Heart, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { fallbackPackages, getActiveSubscription } from '@/lib/profile/subscription'
import { PurchaseButton } from '@/components/profile/purchase-button'
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
                <span className="font-bold">Payment successful.</span> Your membership is now active
                and your profile is being published in Brides &amp; Grooms. If your profile is not
                live within a minute, open <Link href="/profile/edit" className="font-semibold underline underline-offset-2">your profile</Link>{' '}
                and complete any missing details.
              </span>
            </div>
            {searchParams?.next && (
              <div className="mt-4 border-t border-emerald-200/60 pt-3">
                <Link
                  href={searchParams.next}
                  className="btn-primary inline-flex items-center gap-2 text-xs py-2 px-4"
                >
                  Continue to Success Story Submission &rarr;
                </Link>
              </div>
            )}
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

        {(searchParams?.reason === 'stories' || searchParams?.next?.includes('success-stories')) && !subscription && (
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

        {user && subscription ? (
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
            {searchParams?.next && (
              <div className="mt-4 border-t border-emerald-200/60 pt-3">
                <Link
                  href={searchParams.next}
                  className="btn-primary inline-flex items-center gap-2 text-xs py-2 px-4"
                >
                  Continue to Success Story Submission &rarr;
                </Link>
              </div>
            )}
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
              href={searchParams?.next ? `/login?next=${encodeURIComponent(searchParams.next)}` : '/login'}
              className="font-semibold text-maroon underline underline-offset-2"
            >
              Log in
            </Link>{' '}
            to purchase a package, or{' '}
            <Link
              href={searchParams?.next ? `/register?next=${encodeURIComponent(searchParams.next)}` : '/register'}
              className="font-semibold text-maroon underline underline-offset-2"
            >
              register free
            </Link>{' '}
            first.
          </div>
        )}

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
                      next={searchParams?.next}
                    />
                  ) : (
                    <Link
                      href={searchParams?.next ? `/login?next=${encodeURIComponent(searchParams.next)}` : '/login'}
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
