import Link from 'next/link'
import {
  Activity,
  BadgeCheck,
  Banknote,
  Calendar,
  Eye,
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
  await requireAdminPage()
  const days = clampDays(searchParams.days ?? null)

  // Fetch analytics via the service-role RPC (this runs server-side, as the
  // admin, via the service-role client created by requireAdminPage which uses
  // createAdminClient → bypasses RLS, calls the SECURITY DEFINER RPC).
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()
  const { data, error } = await admin
    .rpc('admin_analytics', { p_days: days })
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
        <KpiCard label="Total members" value={String(payload.kpis.total_members)} icon={Users} />
        <KpiCard label={`New · ${payload.window_days}d`} value={String(payload.kpis.new_members)} icon={TrendingUp} />
        <KpiCard label="Signups today" value={String(payload.kpis.signups_today)} icon={TrendingUp} />
        <KpiCard label="Live profiles" value={String(payload.kpis.live_profiles)} icon={HeartHandshake} />
        <KpiCard label="Published · window" value={String(payload.kpis.published_profiles)} icon={Heart} />
        <KpiCard label="Live subscriptions" value={String(payload.kpis.live_subscriptions)} icon={Activity} />
        <KpiCard label="Subs activated" value={String(payload.kpis.subscriptions_activated)} icon={Activity} />
        <KpiCard label="Subs renewed" value={String(payload.kpis.subscriptions_renewed)} icon={TrendingUp} />
        <KpiCard label="Subs expired" value={String(payload.kpis.subscriptions_expired)} icon={Activity} />
        <KpiCard label="Active boosts" value={String(payload.kpis.active_boosts)} icon={ShieldBan} />
        <KpiCard label="Boosts activated" value={String(payload.kpis.boosts_activated)} icon={ShieldBan} />
        <KpiCard label={`Revenue · ${payload.window_days}d`} value={inr(payload.kpis.revenue_window)} icon={Banknote} />
        <KpiCard label="Revenue (all time)" value={inr(payload.kpis.revenue_total)} icon={Banknote} />
        <KpiCard label="Payments captured" value={String(payload.kpis.payments_captured)} icon={Banknote} />
        <KpiCard label="Payments failed" value={String(payload.kpis.payments_failed)} icon={Banknote} />
        <KpiCard label="Payments refunded" value={String(payload.kpis.payments_refunded)} icon={Banknote} />
        <KpiCard label="Searches" value={String(payload.kpis.searches)} icon={Search} />
        <KpiCard label="Interests sent" value={String(payload.kpis.interests_sent)} icon={Heart} />
        <KpiCard label="Interests accepted" value={String(payload.kpis.interests_accepted)} icon={Heart} />
        <KpiCard label="Interests declined" value={String(payload.kpis.interests_declined)} icon={Heart} />
        <KpiCard label="Mutual connections" value={String(payload.kpis.mutual_connections)} icon={HeartHandshake} />
        <KpiCard label="Messages" value={String(payload.kpis.messages)} icon={MessagesSquare} />
        <KpiCard label="Profile views" value={String(payload.kpis.profile_views)} icon={Eye} />
        <KpiCard label="Contact reveals" value={String(payload.kpis.contact_reveals)} icon={Eye} />
        <KpiCard label="Moments posted" value={String(payload.kpis.moments_posted)} icon={Flame} />
        <KpiCard label="Live moments" value={String(payload.kpis.live_moments)} icon={Flame} />
        <KpiCard label="Moments reported" value={String(payload.kpis.moments_reported)} icon={FileWarning} />
        <KpiCard label="Pending verifications" value={String(payload.kpis.pending_verifications)} icon={BadgeCheck} />
        <KpiCard label="Verifications approved" value={String(payload.kpis.verifications_approved)} icon={BadgeCheck} />
        <KpiCard label="Verifications rejected" value={String(payload.kpis.verifications_rejected)} icon={BadgeCheck} />
        <KpiCard label="Open reports" value={String(payload.kpis.open_reports)} icon={FileWarning} />
      </div>

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
