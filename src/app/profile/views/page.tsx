import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Crown, Eye, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { maskName } from '@/lib/profile/mask'

export const metadata: Metadata = { title: 'Who viewed me' }
export const dynamic = 'force-dynamic'

/**
 * "Who viewed your profile" — the Premium/VIP benefit gate. Owned viewer rows
 * only (RLS: viewed_id = auth.uid()). Viewer names stay masked until THEY too
 * match the paid+mutual rule on their own profile — this list only says who
 * looked, never their contact details.
 */
export default async function ProfileViewsPage() {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const benefitRes = await supabase.rpc('has_benefit', { p_key: 'who_viewed_me' })
  const allowed = benefitRes.data === true

  type ViewRow = {
    id: number
    viewer_id: string
    viewed_at: string
    profiles: { full_name: string } | null
    matrimony_profiles: { gender: string | null; city: string | null } | null
  }

  let views: ViewRow[] = []
  if (allowed) {
    const { data } = await supabase
      .from('profile_views')
      .select('id, viewer_id, viewed_at, profiles!profile_views_viewer_id_fkey(full_name)')
      .eq('viewed_id', user.id)
      .neq('viewer_id', user.id)
      .order('viewed_at', { ascending: false })
      .limit(100)
    views = (data as ViewRow[] | null) ?? []
  }

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            <Eye className="mr-1 inline h-4 w-4" /> Insights
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            Who viewed your profile
          </h1>
        </div>

        {!allowed ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-[26px] border border-gold-400/60 bg-white p-8 text-center shadow-card-float">
            <Lock className="mx-auto h-8 w-8 text-gold-600" />
            <h2 className="mt-3 font-display text-xl font-bold text-maroon">Premium · VIP benefit</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-stone-600">
              Knowing who looked at your profile is part of the Premium and VIP plans. Upgrade to
              see every visitor, timestamped.
            </p>
            <Link href="/packages" className="btn-primary mt-5">
              <Crown className="h-4 w-4" /> View packages
            </Link>
          </div>
        ) : views.length === 0 ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-stone-200 bg-white/70 px-6 py-10 text-center text-sm text-stone-600">
            Nobody has viewed your profile yet. Boost it to appear first in search — it usually
            triples your views.
          </div>
        ) : (
          <ul className="mx-auto mt-10 max-w-2xl divide-y divide-stone-100 rounded-[26px] bg-white shadow-card-float ring-1 ring-stone-100">
            {views.map((v) => (
            <li key={v.id} className="flex items-center gap-4 px-6 py-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                {(v.profiles?.full_name ?? 'M').charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-bold text-stone-900">
                  {maskName(v.profiles?.full_name ?? 'Member')}
                </span>
                <span className="text-xs text-stone-500">
                  Viewed your profile ·{' '}
                  {new Date(v.viewed_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </span>
              <Link
                href={`/profile/${v.viewer_id}`}
                className="rounded-full bg-maroon px-4 py-1.5 text-xs font-bold text-white hover:bg-maroon-dark"
              >
                View
              </Link>
            </li>
          ))}
          </ul>
        )}
      </div>
    </section>
  )
}


