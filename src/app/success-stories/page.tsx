import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, Heart, Quote } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import type { SuccessStoryRow } from '@/lib/supabase/database.types'

export const metadata: Metadata = {
  title: 'Success Stories',
  description: 'Real couples from the Mali Samaj who met on Mali Vivah.',
}
export const dynamic = 'force-dynamic'

/**
 * Success stories come from the success_stories table (admin-published
 * only — the public read policy hides drafts). When none exist yet the page
 * says so honestly; we never invent couples.
 */
export default async function SuccessStoriesPage() {
  let stories: SuccessStoryRow[] = []
  if (isSupabaseConfigured) {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('success_stories')
      .select('*')
      .order('sort_order')
      .order('created_at', { ascending: false })
      .limit(48)
    if (!error && data) stories = data as SuccessStoryRow[]
  }

  return (
    <section className="bg-cream">
      <div className="container-page py-12 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            Real journeys
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            Success Stories
          </h1>
          <p className="mt-4 text-sm text-stone-600 sm:text-base">
            Couples from the Mali Samaj who found each other through Mali Vivah — shared with
            their permission.
          </p>
        </div>

        {stories.length === 0 ? (
          <div className="mx-auto mt-12 max-w-2xl rounded-[26px] border border-stone-200 bg-white/80 px-8 py-12 text-center shadow-card-float">
            <Heart className="mx-auto h-9 w-9 text-gold-500" />
            <h2 className="mt-4 font-display text-2xl font-bold text-maroon">
              The first story is still being written
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-600">
              We publish real stories only, with the couple&apos;s blessing — never marketing
              fluff. When the first Mali Vivah couple is ready to share, you will read it here.
              Maybe it will be yours.
            </p>
            <Link href="/register" className="btn-primary mt-6">
              Begin your story
            </Link>
          </div>
        ) : (
          <ul className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => (
              <li key={s.id} className="flex flex-col overflow-hidden rounded-[26px] bg-white shadow-card-float ring-1 ring-stone-100">
                {s.photo_path && photoUrl(s.photo_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrl(s.photo_path) ?? ''}
                    alt={`${s.couple_names} photograph`}
                    className="aspect-[4/3] w-full object-cover object-top"
                  />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-brand-50">
                    <Heart className="h-10 w-10 fill-brand-200 text-brand-200" />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <h2 className="font-display text-xl font-bold text-maroon">{s.couple_names}</h2>
                  <p className="text-sm font-semibold text-gold-700">{s.title}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
                    <Quote className="h-3.5 w-3.5 text-brand-300" />
                    {s.wedding_date && (
                      <>
                        Married{' '}
                        {new Date(s.wedding_date).toLocaleDateString('en-IN', {
                          month: 'long',
                          year: 'numeric',
                        })}{' '}
                        ·{' '}
                      </>
                    )}
                    <CalendarDays className="h-3 w-3" />
                    shared {new Date(s.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </p>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-stone-600 [display:-webkit-box] [-webkit-line-clamp:6] [-webkit-box-orient:vertical] overflow-hidden">
                    {s.story}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
