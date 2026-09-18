import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Heart, Clock, CheckCircle2, Star, Sparkles, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { hasActiveSubscription } from '@/lib/profile/subscription'
import { photoUrl } from '@/lib/profile/photos'
import { SuccessStoryForm } from '@/components/success-stories/success-story-form'
import type { SuccessStoryRow } from '@/lib/supabase/database.types'

export const metadata: Metadata = {
  title: 'Share Your Story · Mali Vivah',
  description: 'Share your journey of finding a life partner on Mali Vivah.',
}

export const dynamic = 'force-dynamic'

export default async function SubmitSuccessStoryPage() {
  if (!isSupabaseConfigured) {
    redirect('/login?next=/success-stories/submit')
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 1. Unauthenticated → redirect to login with destination preserved
  if (!user) {
    redirect('/login?next=/success-stories/submit')
  }

  // 2. Free or Expired → redirect to packages with reason and destination preserved
  const isPaid = await hasActiveSubscription(supabase, user.id)
  if (!isPaid) {
    redirect('/packages?next=/success-stories/submit&reason=stories')
  }

  // 3. Inspect existing submissions by this member (pending or published)
  const { data: existingData } = await supabase
    .from('success_stories')
    .select('*')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const existing = existingData as SuccessStoryRow | null

  return (
    <section className="bg-cream min-h-[calc(100dvh-8rem)]">
      <div className="container-page py-10 sm:py-14">
        {/* Breadcrumb / Back link */}
        <div className="mx-auto max-w-3xl">
          <Link
            href="/success-stories"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 hover:text-maroon transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Success Stories</span>
          </Link>
        </div>

        {/* Existing Submission State: Published */}
        {existing && existing.is_published && (
          <div className="mx-auto mt-8 max-w-2xl rounded-[28px] border border-emerald-200 bg-white p-8 text-center shadow-card-float sm:p-12">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
              Live on Mali Vivah
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">
              You already have a published Success Story
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-600">
              Your story of finding each other is published and inspiring couples and families across the community.
            </p>

            <div className="mt-8 rounded-2xl border border-stone-200 bg-stone-50/60 p-5 text-left">
              {existing.photo_path && photoUrl(existing.photo_path) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(existing.photo_path) ?? ''}
                  alt={existing.couple_names}
                  className="mb-4 aspect-[16/9] w-full rounded-xl object-cover object-top"
                />
              )}
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-maroon">{existing.couple_names}</h3>
                {existing.rating && (
                  <div className="flex items-center gap-0.5 text-amber-500">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3 w-3 ${i < existing.rating! ? 'fill-amber-400 text-amber-500' : 'text-stone-300'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <p className="text-sm font-semibold text-gold-700">{existing.title}</p>
              <p className="mt-2 text-xs text-stone-600 line-clamp-3">{existing.story}</p>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/success-stories" className="btn-primary">
                View Public Success Stories
              </Link>
              <Link href="/profile" className="btn-secondary">
                Go to My Profile
              </Link>
            </div>
          </div>
        )}

        {/* Existing Submission State: Under Review */}
        {existing && !existing.is_published && (
          <div className="mx-auto mt-8 max-w-2xl rounded-[28px] border border-amber-200 bg-white p-8 text-center shadow-card-float sm:p-12">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100">
              <Clock className="h-8 w-8" />
            </div>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800">
              Under Review
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">
              Your story is currently under review
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-600">
              Thank you for sharing your story with Mali Vivah. Our editorial team is currently reviewing your submission before it appears on the website.
            </p>

            <div className="mt-8 rounded-2xl border border-stone-200 bg-stone-50/60 p-5 text-left">
              {existing.photo_path && photoUrl(existing.photo_path) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(existing.photo_path) ?? ''}
                  alt={existing.couple_names}
                  className="mb-4 aspect-[16/9] w-full rounded-xl object-cover object-top"
                />
              )}
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-maroon">{existing.couple_names}</h3>
                {existing.rating && (
                  <div className="flex items-center gap-0.5 text-amber-500">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3 w-3 ${i < existing.rating! ? 'fill-amber-400 text-amber-500' : 'text-stone-300'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <p className="text-sm font-semibold text-gold-700">{existing.title}</p>
              <p className="mt-2 text-xs text-stone-600 line-clamp-3">{existing.story}</p>
              {existing.submitted_at && (
                <p className="mt-3 text-[11px] text-stone-400">
                  Submitted on {new Date(existing.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/success-stories" className="btn-primary">
                Back to Success Stories
              </Link>
              <Link href="/profile" className="btn-secondary">
                Go to My Profile
              </Link>
            </div>
          </div>
        )}

        {/* New Submission: Display Form */}
        {!existing && (
          <div className="mx-auto mt-4 max-w-3xl">
            <header className="text-center">
              <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.3em] text-gold-700">
                <Sparkles className="h-4 w-4" />
                Mali Vivah Journeys
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-maroon sm:text-5xl">
                Share Your Mali Vivah Story
              </h1>
              <p className="mt-3 text-sm text-stone-600 sm:text-base">
                Your journey may inspire another family to take the first step.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-1.5 text-xs text-stone-600 shadow-sm ring-1 ring-stone-200">
                <Heart className="h-3.5 w-3.5 fill-gold-400 text-gold-500" />
                <span>Stories are reviewed by the Mali Vivah team before they are published.</span>
              </div>
            </header>

            <div className="mt-10">
              <SuccessStoryForm />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
