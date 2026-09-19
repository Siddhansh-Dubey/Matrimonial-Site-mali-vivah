import Link from 'next/link'
import { Heart, Quote } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import type { SuccessStoryRow } from '@/lib/supabase/database.types'

export const dynamic = 'force-dynamic'

/**
 * Homepage Success Stories band.
 *
 * Reads ONLY published rows from the success_stories table (the public read
 * policy hides drafts). When no stories exist yet the section says so
 * honestly and points to the submit flow — it never fabricates couples or
 * photos.
 */
export async function SuccessStoriesSection() {
  let stories: SuccessStoryRow[] = []
  if (isSupabaseConfigured) {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('success_stories')
      .select('*')
      .eq('is_published', true)
      .order('sort_order')
      .order('created_at', { ascending: false })
      .limit(3)
    if (!error && data) stories = data as SuccessStoryRow[]
  }

  return (
    <section className="bg-maroon-deep text-white">
      <div className="container-page py-16 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-300">
            Real journeys
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold sm:text-4xl">Success Stories</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/70">
            Couples from the Mali Samaj who found each other on Mali Vivah — shared with their
            permission.
          </p>
        </div>

        {stories.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl rounded-[26px] border border-white/10 bg-white/5 px-8 py-10 text-center">
            <Heart className="mx-auto h-8 w-8 text-gold-300" />
            <h3 className="mt-3 font-display text-xl font-bold">The first story is still being written</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/70">
              We publish real stories only, with the couple&apos;s blessing. When the first Mali
              Vivah couple is ready to share, you will read it here.
            </p>
            <Link
              href="/success-stories/submit"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep hover:bg-gold-300"
            >
              Share your story
            </Link>
          </div>
        ) : (
          <ul className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => (
              <li key={s.id} className="flex flex-col rounded-[22px] bg-white p-6 text-stone-800 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-bold text-maroon">{s.couple_names}</h3>
                  {s.photo_path && photoUrl(s.photo_path) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoUrl(s.photo_path) ?? ''}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover ring-2 ring-gold-300"
                    />
                  )}
                </div>
                <p className="mt-1 text-sm font-semibold text-gold-700">{s.title}</p>
                <p className="mt-3 flex-1 whitespace-pre-line text-sm leading-relaxed text-stone-600 [display:-webkit-box] [-webkit-line-clamp:5] [-webkit-box-orient:vertical] overflow-hidden">
                  “{s.story}”
                </p>
                <Quote className="mt-3 h-4 w-4 text-brand-200" />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 text-center">
          <Link
            href="/success-stories"
            className="inline-flex items-center gap-2 rounded-full border border-gold-400/60 px-6 py-2.5 text-sm font-bold text-gold-300 hover:bg-white/5"
          >
            Read all stories <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
