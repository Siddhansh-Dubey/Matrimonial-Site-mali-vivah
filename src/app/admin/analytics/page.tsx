import Link from 'next/link'
import {
  Activity,
  BadgeCheck,
  Banknote,
  Calendar,
  Eye,
  EyeOff,
  FileWarning,
  Flame,
  Heart,
  HeartHandshake,
  MessagesSquare,
  Search,
  ShieldBan,
  TrendingUp,
  Users,
} from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'

export const metadata = { title: 'Admin · Analytics' }
export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000
const DEFAULT_DAYS = 14

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const

type AnalyticsPayload = {
  window_days: number
  kpis: Record<string, number>
  daily: {
    days: string[]
    signups: number[]
    revenue: number[]
    interests: number[]
    messages: number[]
    searches: number[]
    profile_views: number[]
  }
  top_cities: { city: string; n: number }[]
  latest_activity: {
    id: number
    event: string
    created_at: string
    user_id: string | null
    actor_name: string | null
  }[]
  packages: { package_slug: string; active: number; revenue_total: number }[]
}

const EVENT_LABELS: Record<string, string> = {
  registered: 'New member registered',
  logged_in: 'Member logged in',
  account_deletion_requested: 'Account deletion requested',
  account_deleted: 'Account deleted',
  profile_created: 'Profile created',
  profile_completed: 'Profile completed',
  profile_published: 'Profile published',
  profile_updated: 'Profile updated',
  profile_viewed: 'Profile viewed',
  profile_verified: 'Profile verified',
  search_performed: 'Search performed',
  interest_sent: 'Interest sent',
  interest_accepted: 'Interest accepted',
  interest_declined: 'Interest declined',
  interest_mutual: 'Mutual connection',
  message_sent: 'Message sent',
  contact_revealed: 'Contact details revealed',
  payment_initiated: 'Payment started',
  payment_captured: 'Payment captured',
  payment_failed: 'Payment failed',
  payment_refunded: 'Payment refunded',
  membership_activated: 'Membership activated',
  membership_expired: 'Membership expired',
  membership_renewed: 'Membership renewed',
  membership_refunded: 'Membership refunded',
  profile_boosted: 'Boost redeemed',
  boost_purchased: 'Boost purchased',
  boost_activated: 'Boost activated',
  boost_expired: 'Boost expired',
  boost_refunded: 'Boost refunded',
  boost_granted: 'Boost granted (admin)',
  moment_posted: 'Mali Moment posted',
  moment_reported: 'Moment reported',
  moment_removed: 'Moment removed by admin',
  verification_submitted: 'Verification submitted',
  verification_approved: 'Verification approved',
  verification_rejected: 'Verification rejected',
  story_submitted: 'Success story submitted',
  block_created: 'Member blocked',
  block_removed: 'Member unblocked',
  mobile_otp_verified: 'Mobile OTP verified',
  admin_member_approved: 'Admin approved profile',
  admin_member_rejected: 'Admin sent profile back',
  admin_member_edited: 'Admin edited member profile',
  admin_member_suspended: 'Admin suspended member',
  admin_member_unsuspended: 'Admin lifted suspension',
  admin_member_hidden: 'Admin placed member on hold',
  admin_member_reactivated: 'Admin reactivated member',
  admin_member_deleted: 'Admin deleted member',
  admin_member_verified: 'Admin granted verified badge',
  admin_member_unverified: 'Admin removed verified badge',
  admin_member_featured: 'Admin featured member',
  admin_member_unfeatured: 'Admin un-featured member',
  admin_member_photo_removed: 'Admin removed a photo',
  admin_manual_membership_activation: 'Admin activated a membership manually',
  admin_membership_revoked: 'Admin revoked a membership (payment preserved)',
  platinum_first_100_granted: 'Platinum launch offer granted (first 100)',
  platinum_demo_24h_granted: 'Platinum 24-hour demo granted',
  platinum_promotion_expired: 'Platinum promotion expired',
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${d}/${m}`
}

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function clampDays(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_DAYS
  if (!Number.isFinite(n)) return DEFAULT_DAYS
  return Math.max(1, Math.min(Math.round(n), 365))
}

function Bars({
  days,
  values,
  money = false,
  color = 'bg-maroon/80',
}: {
  days: string[]
  values: number[]
  money?: boolean
  color?: string
}) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-36 items-end gap-1">
      {days.map((d, i) => {
        const v = values[i] ?? 0
        const h = Math.max(3, Math.round((v / max) * 100))
        return (
          <div
            key={d}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${d}: ${money ? inr(v) : v}`}
          >
            <div
              className={`w-full rounded-t-md ${color} transition-colors group-hover:bg-maroon`}
              style={{ height: `${h}%` }}
            />
            {(i % 2 === 0 || i === days.length - 1) && (
              <span className="mt-1 text-center text-[9px] text-stone-400">{shortLabel(d)}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <Icon className="h-5 w-5 text-maroon" aria-hidden />
      <p className="mt-2 font-display text-2xl font-bold text-stone-900">{value}</p>
      <p className="text-xs text-stone-500">{label}</p>
    </div>
  )
}

function SectionCard({
  title,
  children,
  right,
}: {
  title: string
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-stone-900">{title}</h2>
        {right ? <span className="text-xs text-stone-400">{right}</span> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

type SearchParams = { days?: string }

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { admin, userId: adminId } = await requireAdminPage()
  const days = clampDays(searchParams.days ?? null)

  // ONE authoritative admin check. `requireAdminPage()` above resolved the
  // caller as a signed-in `profiles.is_admin` member and returned BOTH that
  // member's id and the service-role client. The RPC is invoked with the
  // service role (so the SECURITY DEFINER body can read every business table
  // regardless of RLS) and authorised by `admin_assert_actor(p_admin_id)`
  // inside `admin_analytics()` — exactly like every other admin RPC.
  //
  // The previous version called `admin.rpc('admin_analytics', { p_days })`
  // without p_admin_id: a service-role request carries no user JWT, so
  // `auth.uid()` was NULL, `is_admin()` was FALSE and the RPC rejected the
  // very admin the page had already authorised ("admin_analytics: admin
  // only"). The identity is now passed explicitly — never taken from the
  // browser, never hard-coded.
  const { data, error } = await admin
    .rpc('admin_analytics', { p_days: days, p_admin_id: adminId })
    .maybeSingle()

  const payload: AnalyticsPayload | null = (data as unknown as AnalyticsPayload) ?? null
  if (error || !payload) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold text-stone-900">Analytics</h1>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load analytics: {error?.message ?? 'no data'}.
        </div>
      </div>
    )
  }

  /** Every KPI renders, including 0 — an empty metric is data, not a reason to hide the page. */
  const kpi = (key: string): number => Number(payload.kpis?.[key] ?? 0)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-900">Analytics</h1>
          <p className="mt-1 text-sm text-stone-500">
            Growth, matchmaking, revenue and safety — computed live from real data. Days are IST calendar days.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white p-1">
          <Calendar className="ml-2 h-4 w-4 text-stone-400" />
          {RANGES.map((r) => {
            const active = r.days === days
            return (
              <Link
                key={r.days}
                href={`/admin/analytics?days=${r.days}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-maroon text-white'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                {r.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* ---- KPI cards ---- */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Total members" value={String(kpi('total_members'))} icon={Users} />
        <KpiCard label={`New · ${payload.window_days}d`} value={String(kpi('new_members'))} icon={TrendingUp} />
        <KpiCard label="Signups today" value={String(kpi('signups_today'))} icon={TrendingUp} />
        <KpiCard label="Paid members" value={String(kpi('paid_members'))} icon={Banknote} />
        <KpiCard label="Free members" value={String(kpi('free_members'))} icon={Users} />
        <KpiCard label="Live profiles" value={String(kpi('live_profiles'))} icon={HeartHandshake} />
        <KpiCard label="Hidden (free) profiles" value={String(kpi('hidden_profiles'))} icon={EyeOff} />
        <KpiCard label="Verified profiles" value={String(kpi('verified_profiles'))} icon={BadgeCheck} />
        <KpiCard label="Published · window" value={String(kpi('published_profiles'))} icon={Heart} />
        <KpiCard label="Live subscriptions" value={String(kpi('live_subscriptions'))} icon={Activity} />
        <KpiCard label="Expiring ≤ 7 days" value={String(kpi('expiring_subscriptions'))} icon={Calendar} />
        <KpiCard label="Live promo (Platinum)" value={String(kpi('live_promotional_subscriptions'))} icon={Flame} />
        <KpiCard label="Subs activated" value={String(kpi('subscriptions_activated'))} icon={Activity} />
        <KpiCard label="Subs renewed" value={String(kpi('subscriptions_renewed'))} icon={TrendingUp} />
        <KpiCard label="Subs expired" value={String(kpi('subscriptions_expired'))} icon={Activity} />
        <KpiCard label="Active boosts" value={String(kpi('active_boosts'))} icon={ShieldBan} />
        <KpiCard label="Boosts activated" value={String(kpi('boosts_activated'))} icon={ShieldBan} />
        <KpiCard label={`Revenue · ${payload.window_days}d`} value={inr(kpi('revenue_window'))} icon={Banknote} />
        <KpiCard label="Revenue (all time)" value={inr(kpi('revenue_total'))} icon={Banknote} />
        <KpiCard label="Payments captured" value={String(kpi('payments_captured'))} icon={Banknote} />
        <KpiCard label="Payments failed" value={String(kpi('payments_failed'))} icon={Banknote} />
        <KpiCard label="Payments refunded" value={String(kpi('payments_refunded'))} icon={Banknote} />
        <KpiCard label="Searches" value={String(kpi('searches'))} icon={Search} />
        <KpiCard label="Interests sent" value={String(kpi('interests_sent'))} icon={Heart} />
        <KpiCard label="Interests accepted" value={String(kpi('interests_accepted'))} icon={Heart} />
        <KpiCard label="Interests declined" value={String(kpi('interests_declined'))} icon={Heart} />
        <KpiCard label="Mutual connections" value={String(kpi('mutual_connections'))} icon={HeartHandshake} />
        <KpiCard label="Messages" value={String(kpi('messages'))} icon={MessagesSquare} />
        <KpiCard label="Profile views" value={String(kpi('profile_views'))} icon={Eye} />
        <KpiCard label="Contact reveals" value={String(kpi('contact_reveals'))} icon={Eye} />
        <KpiCard label="Moments posted" value={String(kpi('moments_posted'))} icon={Flame} />
        <KpiCard label="Live moments" value={String(kpi('live_moments'))} icon={Flame} />
        <KpiCard label="Moments reported" value={String(kpi('moments_reported'))} icon={FileWarning} />
        <KpiCard label="Pending verifications" value={String(kpi('pending_verifications'))} icon={BadgeCheck} />
        <KpiCard label="Verifications approved" value={String(kpi('verifications_approved'))} icon={BadgeCheck} />
        <KpiCard label="Verifications rejected" value={String(kpi('verifications_rejected'))} icon={BadgeCheck} />
        <KpiCard label="Open reports" value={String(kpi('open_reports'))} icon={FileWarning} />
        <KpiCard label={`Reports · ${payload.window_days}d`} value={String(kpi('reports_window'))} icon={FileWarning} />
        <KpiCard label="Reports resolved" value={String(kpi('reports_resolved'))} icon={FileWarning} />
      </div>

      {/* ---- Live package mix ---- */}
      <SectionCard title="Active packages" right="live subscriptions · all-time captured revenue">
        {payload.packages.length === 0 ? (
          <p className="text-sm text-stone-500">No live subscriptions — every plan count is 0.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {payload.packages.map((pk) => (
              <li key={pk.package_slug} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="truncate text-sm font-semibold text-stone-800">{pk.package_slug}</p>
                <p className="mt-0.5 text-xs text-stone-500">
                  {pk.active} active · {inr(pk.revenue_total)} captured
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ---- Charts ---- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Signups per day" right={`${payload.window_days} days`}>
          <Bars days={payload.daily.days} values={payload.daily.signups} />
        </SectionCard>
        <SectionCard title="Revenue per day" right={`${payload.window_days} days · ₹ captured`}>
          <Bars days={payload.daily.days} values={payload.daily.revenue} money color="bg-gradient-to-t from-gold-500 to-gold-400" />
        </SectionCard>
        <SectionCard title="Interests per day" right={`${payload.window_days} days · sent`}>
          <Bars days={payload.daily.days} values={payload.daily.interests} color="bg-rose-500" />
        </SectionCard>
        <SectionCard title="Messages per day" right={`${payload.window_days} days · sent`}>
          <Bars days={payload.daily.days} values={payload.daily.messages} color="bg-emerald-500" />
        </SectionCard>
        <SectionCard title="Searches per day" right={`${payload.window_days} days`}>
          <Bars days={payload.daily.days} values={payload.daily.searches} color="bg-indigo-500" />
        </SectionCard>
        <SectionCard title="Profile views per day" right={`${payload.window_days} days`}>
          <Bars days={payload.daily.days} values={payload.daily.profile_views} color="bg-sky-500" />
        </SectionCard>
      </div>

      {/* ---- Top cities + latest activity ---- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Top cities (live profiles)">
          {payload.top_cities.length === 0 ? (
            <p className="text-sm text-stone-500">No live profiles yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {payload.top_cities.map((c) => (
                <li key={c.city}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-stone-800">{c.city}</span>
                    <span className="text-stone-500">{c.n}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-gold-400 to-brand-500"
                      style={{
                        width: `${Math.max(4, Math.round((c.n / payload.top_cities[0].n) * 100))}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Latest activity">
          {payload.latest_activity.length === 0 ? (
            <p className="text-sm text-stone-500">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {payload.latest_activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-stone-800">
                      {EVENT_LABELS[a.event] ?? a.event}
                    </p>
                    {a.actor_name && (
                      <p className="truncate text-xs text-stone-500">{a.actor_name}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-stone-400">{formatTs(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
