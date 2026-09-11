import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  BadgeCheck,
  Crown,
  Eye,
  Heart,
  ImagePlus,
  Pencil,
  Search,
  Star,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import { ageFromDate } from '@/lib/profile/profile-schema'
import { getActiveSubscription } from '@/lib/profile/subscription'
import type { MatrimonyProfile, PartnerPreferences } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'My Profile' }

export const dynamic = 'force-dynamic'

export default async function ProfileDashboardPage({
  searchParams,
}: {
  searchParams?: { published?: string }
}) {
  if (!isSupabaseConfigured) redirect('/login')

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, mpRes, ppRes, photoRes, subscription] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('matrimony_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('partner_preferences').select('*').eq('profile_id', user.id).maybeSingle(),
    supabase.from('profile_photos').select('*').eq('profile_id', user.id).order('sort_order'),
    getActiveSubscription(supabase, user.id),
  ])

  const fullName = profileRes.data?.full_name ?? 'Member'
  const mp = mpRes.data as MatrimonyProfile | null
  const pp = ppRes.data as PartnerPreferences | null
  const photos = photoRes.data ?? []
  const primaryPhoto = photos.find((p) => p.is_primary)?.storage_path ?? photos[0]?.storage_path ?? null
  const age = ageFromDate(mp?.date_of_birth)
  const published = searchParams?.published === '1'

  const status = mp?.status ?? 'draft'
  const isLive = status === 'active'

  // simple completeness score
  const fields = [
    mp?.gender,
    mp?.date_of_birth,
    mp?.height_cm,
    mp?.sub_community,
    mp?.education,
    mp?.occupation,
    mp?.city,
    mp?.about_me,
    mp?.religion,
    primaryPhoto,
  ]
  const filled = fields.filter((f) => Boolean(f)).length
  const completeness = Math.round((filled / fields.length) * 100)

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        {published && (
          <div className="mx-auto mb-6 flex max-w-3xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <span>
              Your profile is now live and visible in Browse &amp; Search. Families can now find you
              and express interest.
            </span>
          </div>
        )}

        {subscription ? (
          <div className="mx-auto mb-8 flex max-w-3xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <Crown className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <span>
              Active package till{' '}
              <span className="font-semibold">
                {new Date(subscription.expires_at).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>{' '}
              — all profile details are unlocked for you.{' '}
              <Link href="/packages" className="font-semibold underline underline-offset-2">
                Manage
              </Link>
            </span>
          </div>
        ) : (
          <div className="mx-auto mb-8 flex max-w-3xl flex-col gap-3 rounded-2xl border border-gold-400/50 bg-gold-100/50 px-5 py-4 text-sm text-maroon-deep sm:flex-row sm:items-center">
            <span>
              You are on the <span className="font-semibold">free plan</span> — other profiles show
              only photos and occupations to you.
            </span>
            <Link
              href="/packages"
              className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-5 py-2 text-xs font-bold text-white hover:bg-maroon-dark sm:ml-auto"
            >
              <Crown className="h-3.5 w-3.5" /> View packages
            </Link>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* left: profile summary card */}
          <div className="card overflow-hidden">
            <div className="relative h-40 bg-gradient-to-br from-maroon-deep to-brand-700">
              <div
                aria-hidden
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 15% 20%, rgba(226,184,87,0.5) 0, transparent 35%), radial-gradient(circle at 85% 85%, rgba(255,255,255,0.18) 0, transparent 30%)',
                }}
              />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-gold-300" />
                  <span className="text-sm font-semibold">{isLive ? 'Live profile' : 'Draft profile'}</span>
                </div>
                <h1 className="mt-1 font-display text-3xl font-bold">{fullName}</h1>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full ring-2 ring-gold-400">
                  {primaryPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(primaryPhoto) ?? ''} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-brand-50 text-brand-400">
                      <ImagePlus className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  {age != null && (
                    <p className="text-sm text-stone-600">
                      {age} years · {mp?.height_cm ? `${mp.height_cm} cm · ` : ''}
                      {mp?.city ?? '—'}, {mp?.state ?? 'Maharashtra'}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-sm text-stone-600">
                    {[mp?.education, mp?.occupation].filter(Boolean).join(' · ') || 'Add your education & occupation'}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">{mp?.sub_community ?? 'Sub-community not set'}</p>
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-stone-700">Profile completeness</span>
                  <span className="font-bold text-maroon">{completeness}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-400 to-brand-500" style={{ width: `${completeness}%` }} />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/profile/edit" className="btn-primary">
                  <Pencil className="h-4 w-4" /> Edit profile
                </Link>
                <Link href="/search" className="btn-secondary">
                  <Search className="h-4 w-4" /> Browse matches
                </Link>
              </div>
            </div>
          </div>

          {/* right: quick stats + actions */}
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <StatCard href="/interests" icon={Heart} label="Interests" value={String((await countInterests(supabase, user.id)).received)} />
              <StatCard href="/shortlist" icon={Star} label="Shortlisted" value={String((await countShortlists(supabase, user.id)))} />
              <StatCard href="/profile" icon={Eye} label="Views" value={String((await countViews(supabase, user.id)))} />
            </div>

            <div className="card p-6">
              <h2 className="font-display text-lg font-bold text-maroon">Partner preferences</h2>
              {pp ? (
                <dl className="mt-4 space-y-2 text-sm">
                  <Row label="Looking for" value={pp.preferred_gender === 'male' ? 'Groom' : 'Bride'} />
                  <Row label="Age" value={`${pp.min_age} – ${pp.max_age}`} />
                  {pp.preferred_cities.length > 0 && <Row label="Cities" value={pp.preferred_cities.join(', ')} />}
                  {pp.preferred_sub_communities.length > 0 && (
                    <Row label="Sub-communities" value={pp.preferred_sub_communities.join(', ')} />
                  )}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-stone-500">No preferences yet — add them while editing your profile.</p>
              )}
            </div>

            <div className="card p-6">
              <h2 className="font-display text-lg font-bold text-maroon">Account</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="Email" value={user.email ?? '—'} />
                <Row label="Mobile" value={profileRes.data?.mobile ?? '—'} />
                <Row label="Registered for" value={profileRes.data?.for_whom ?? 'self'} />
              </dl>
            </div>
          </div>
        </div>

        {mp?.about_me && (
          <div className="card mx-auto mt-6 max-w-3xl p-6">
            <h2 className="font-display text-lg font-bold text-maroon">About me</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-stone-600">{mp.about_me}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium text-stone-800">{value}</dd>
    </div>
  )
}

function StatCard({
  href,
  icon: Icon,
  label,
  value,
}: {
  href: string
  icon: typeof Heart
  label: string
  value: string
}) {
  return (
    <Link href={href} className="card flex flex-col items-center gap-1.5 p-4 text-center transition-shadow hover:shadow-card-float">
      <Icon className="h-5 w-5 text-brand-600" />
      <span className="font-display text-2xl font-bold text-maroon">{value}</span>
      <span className="text-xs font-medium text-stone-500">{label}</span>
    </Link>
  )
}

/* lightweight server-side counts */
async function countInterests(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ received: number; sent: number }> {
  const [recv, sent] = await Promise.all([
    supabase.from('interests').select('id', { count: 'exact', head: true }).eq('receiver_id', userId).eq('status', 'pending'),
    supabase.from('interests').select('id', { count: 'exact', head: true }).eq('sender_id', userId),
  ])
  return { received: recv.count ?? 0, sent: sent.count ?? 0 }
}

async function countShortlists(supabase: ReturnType<typeof createClient>, userId: string): Promise<number> {
  const { count } = await supabase.from('shortlists').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  return count ?? 0
}

async function countViews(supabase: ReturnType<typeof createClient>, userId: string): Promise<number> {
  const { count } = await supabase.from('profile_views').select('id', { count: 'exact', head: true }).eq('viewed_id', userId)
  return count ?? 0
}
