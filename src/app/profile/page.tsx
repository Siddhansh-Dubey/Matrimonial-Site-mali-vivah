import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  BadgeCheck,
  Check,
  Crown,
  Eye,
  Heart,
  ImagePlus,
  Lock,
  Pencil,
  Search,
  Settings,
  Star,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import { ageFromDate } from '@/lib/profile/profile-schema'
import { getActiveSubscription } from '@/lib/profile/subscription'
import { MomentsRail } from '@/components/moments/moments-rail'
import { VisibilityBanner } from '@/components/profile/visibility-banner'
import { BoostCard } from '@/components/profile/boost-card'
import { VerificationCard } from '@/components/profile/verification-card'
import { DeletionCard } from '@/components/profile/deletion-card'
import type {
  MatrimonyProfile,
  PartnerPreferences,
  ProfileViewStats,
  VisibilityReason,
} from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'My Profile' }

export const dynamic = 'force-dynamic'

export default async function ProfileDashboardPage({
  searchParams,
}: {
  searchParams?: { published?: string; joined?: string }
}) {
  if (!isSupabaseConfigured) redirect('/login')

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Lazy sweep first so an expired plan is reflected truthfully this render.
  await supabase.rpc('sweep_my_membership').then(() => undefined, () => undefined)

  const [
    profileRes,
    mpRes,
    ppRes,
    photoRes,
    subscription,
    visibilityRes,
    boostRes,
    pendingRes,
    viewStatsRes,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('matrimony_profiles')
      .select('*, community:communities(name), sub_community_row:sub_communities(name)')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('partner_preferences').select('*').eq('profile_id', user.id).maybeSingle(),
    supabase.from('profile_photos').select('*').eq('profile_id', user.id).order('sort_order'),
    getActiveSubscription(supabase, user.id),
    supabase.rpc('profile_visibility_reason', { p_user_id: user.id }),
    supabase.rpc('has_active_boost', { p_user_id: user.id }).then((r) => r.data === true, () => false),
    // Open verification requests per type (RLS: own rows only).
    supabase
      .from('verification_requests')
      .select('type')
      .eq('user_id', user.id)
      .eq('status', 'pending'),
    // Profile-view COUNT — server-authoritative. The RPC re-checks
    // has_benefit('profile_views') and returns allowed=false / total=null to
    // a free member, so the dashboard never holds a number it may not show.
    supabase.rpc('my_profile_view_stats'),
  ])

  // Boost configuration (admin-configured; service-role read).
  //  • duration_days is the ONE boost length — it applies to the included
  //    (package) boost as much as to the purchasable add-on, so it is read
  //    regardless of is_active.
  //  • is_active only decides whether the standalone add-on may be SOLD.
  let boostDurationDays: number | null = null
  let boostAddon: { priceInr: number; durationDays: number } | null = null
  try {
    const admin = createAdminClient()
    const { data: cfg } = await admin
      .from('profile_boost_config')
      .select('price_inr, duration_days, is_active')
      .eq('id', 1)
      .maybeSingle()
    if (cfg) {
      boostDurationDays = cfg.duration_days
      if (cfg.is_active) {
        boostAddon = { priceInr: cfg.price_inr, durationDays: cfg.duration_days }
      }
    }
  } catch {
    boostDurationDays = null
    boostAddon = null
  }

  const fullName = profileRes.data?.full_name ?? 'Member'
  const mp = mpRes.data as
    | (MatrimonyProfile & {
        community: { name: string } | null
        sub_community_row: { name: string } | null
      })
    | null
  const pp = ppRes.data as PartnerPreferences | null
  const photos = photoRes.data ?? []
  const profilePhotos = photos.filter((p) => (p.kind ?? 'profile_photo') === 'profile_photo')
  const hasFamilyPhoto = photos.some((p) => p.kind === 'family_photo')
  const primaryPhoto =
    profilePhotos.find((p) => p.is_primary)?.storage_path ?? profilePhotos[0]?.storage_path ?? null
  const age = ageFromDate(mp?.date_of_birth)
  const published = searchParams?.published === '1'
  const joined = searchParams?.joined === '1'
  const visibility = visibilityRes.data as VisibilityReason | null
  const viewStats = (viewStatsRes.data as ProfileViewStats | null) ?? {
    allowed: false,
    total: null,
    last_30_days: null,
    last_viewed_at: null,
    who_viewed_me: false,
  }
  const hasBoost = boostRes

  const status = mp?.status ?? 'draft'

  // Publish-readiness checklist — must match the server-side gate
  // (enforce_publishable_profile in migration 08).
  const checklist: { label: string; done: boolean }[] = [
    { label: 'Gender, birth date & city', done: Boolean(mp?.gender && mp?.date_of_birth && mp?.city) },
    { label: 'Education & occupation', done: Boolean(mp?.education && mp?.occupation) },
    { label: 'Profile photo', done: profilePhotos.length > 0 },
    { label: 'Family photo', done: hasFamilyPhoto },
    { label: 'Partner preferences', done: Boolean(pp) },
  ]
  const done = checklist.filter((c) => c.done).length
  const completeness = Math.round((done / checklist.length) * 100)
  const readyToPublish = checklist.every((c) => c.done)

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        {/* Mali Moments — top of the logged-in dashboard (24h stories,
            photo + video, reportable, auto-expiring). */}
        <div className="mb-10">
          <MomentsRail />
        </div>

        {/* Fresh from sign-up/verification — point straight at profile setup. */}
        {joined && (
          <div className="mx-auto mb-6 flex max-w-3xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <span className="font-bold">Welcome, {fullName} — your email is verified.</span>{' '}
              Finish the checklist below and press Publish to go live: the sooner the profile is
              complete, the sooner families can find you.
            </span>
          </div>
        )}

        {published && visibility?.is_public && (
          <div className="mx-auto mb-6 flex max-w-3xl items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <span>
              Your profile is now live and visible in Browse &amp; Search. Families can now find you
              and express interest.
            </span>
          </div>
        )}

        {/* ONE banner, always truthful about whether the profile is discoverable. */}
        {visibility && (
          <VisibilityBanner
            visibility={visibility}
            published={published}
            className="mb-8"
          />
        )}

        {subscription && (
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
                  <span className="text-sm font-semibold">
                    {visibility?.is_public ? 'Live profile' : 'Not publicly visible'}
                  </span>
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
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
                    {[mp?.community?.name, mp?.sub_community_row?.name ?? mp?.sub_community]
                      .filter(Boolean)
                      .join(' · ') || 'Community not set'}
                    {mp?.verified_at && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                        <BadgeCheck className="h-3 w-3" /> Verified
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-stone-700">Publish readiness</span>
                  <span className="font-bold text-maroon">{completeness}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-gold-400 to-brand-500"
                    style={{ width: `${completeness}%` }}
                  />
                </div>
                <ul className="mt-3 grid gap-1.5 text-[13px] sm:grid-cols-2">
                  {checklist.map((c) => (
                    <li key={c.label} className="flex items-center gap-1.5">
                      {c.done ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-stone-300" aria-hidden />
                      )}
                      <span className={c.done ? 'text-stone-600' : 'font-semibold text-stone-800'}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/profile/edit" className="btn-primary">
                  <Pencil className="h-4 w-4" /> {readyToPublish ? 'Edit profile' : 'Complete your profile'}
                </Link>
                <Link href="/search" className="btn-secondary">
                  <Search className="h-4 w-4" /> Browse matches
                </Link>
                <Link href="/matches" className="btn-secondary">
                  <Star className="h-4 w-4" /> Daily 5
                </Link>
                <Link href="/profile/settings" className="btn-secondary">
                  <Settings className="h-4 w-4" /> Settings & privacy
                </Link>
              </div>
            </div>
          </div>

          {/* right: quick stats + actions */}
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                href="/interests"
                icon={Heart}
                label="New interests"
                value={String((await countPendingInterests(supabase, user.id)))}
              />
              {viewStats.allowed ? (
                <StatCard
                  href="/profile/views"
                  icon={Eye}
                  label="Profile views"
                  value={String(viewStats.total ?? 0)}
                />
              ) : (
                <LockedStatCard
                  href="/packages"
                  icon={Eye}
                  label="Profile views"
                  hint="Upgrade to see how many people viewed your profile."
                />
              )}
            </div>

            <BoostCard
              hasActive={hasBoost}
              status={status}
              isPaid={Boolean(subscription)}
              durationDays={boostDurationDays}
              boostAddon={boostAddon}
            />

            <VerificationCard
              verified={Boolean(mp?.verified_at)}
              mobileVerified={Boolean(profileRes.data?.mobile_verified)}
              reason={visibility?.reason ?? 'not_published'}
              pending={(() => {
                const types = (pendingRes.data ?? []).map((r) => (r as { type: string }).type)
                return {
                  photo: types.includes('photo'),
                  id_document: types.includes('id_document'),
                  mobile: types.includes('mobile'),
                }
              })()}
              mobileNumber={profileRes.data?.mobile ?? null}
            />

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
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-maroon">Account</h2>
                <Link
                  href="/profile/settings"
                  className="text-xs font-bold text-maroon underline underline-offset-2 hover:text-maroon-dark"
                >
                  Settings &amp; privacy
                </Link>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="Email" value={user.email ?? '—'} />
                <Row label="Mobile" value={profileRes.data?.mobile ?? '—'} />
                <Row label="Registered for" value={profileRes.data?.for_whom ?? 'self'} />
              </dl>
            </div>

            <DeletionCard />
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

/**
 * Profile views for a member whose plan does not include the count. The number
 * itself is never rendered (and never fetched — my_profile_view_stats() refuses
 * to return it), only the upgrade path.
 */
function LockedStatCard({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string
  icon: typeof Heart
  label: string
  hint: string
}) {
  return (
    <Link
      href={href}
      className="card flex flex-col items-center gap-1.5 p-4 text-center transition-shadow hover:shadow-card-float"
    >
      <span className="relative">
        <Icon className="h-5 w-5 text-stone-400" />
        <Lock className="absolute -right-1.5 -top-1 h-3 w-3 text-gold-600" />
      </span>
      <span className="font-display text-2xl font-bold text-stone-300">—</span>
      <span className="text-xs font-medium text-stone-500">{label}</span>
      <span className="text-[11px] leading-snug text-stone-500">{hint}</span>
    </Link>
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
async function countPendingInterests(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<number> {
  const { count } = await supabase
    .from('interests')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', userId)
    .eq('status', 'pending')
  return count ?? 0
}
