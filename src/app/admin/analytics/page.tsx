import { Activity, Banknote, HeartHandshake, MessagesSquare, TrendingUp, Users } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'

export const metadata = { title: 'Admin · Analytics' }
export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 14

/** IST calendar-day key (YYYY-MM-DD) for bucketing. */
function dayKey(d: Date): string {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60_000)
  return ist.toISOString().slice(0, 10)
}

function shortLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${d}/${m}`
}

/**
 * Growth + engagement analytics, computed live from the database. All series
 * use IST calendar days; queries are windowed so the page stays fast as the
 * member base grows.
 */
export default async function AdminAnalyticsPage() {
  const { admin } = await requireAdminPage()
  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString()
  const monthStart = new Date(now.getTime() - 30 * DAY).toISOString()
  const weekStart = new Date(now.getTime() - 7 * DAY).toISOString()

  const [
    memberTotal,
    signups,
    liveProfiles,
    liveSubs,
    payments,
    interests,
    messages,
    boosts,
    cities,
    recentActivity,
  ] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('created_at').gte('created_at', monthStart).order('created_at').limit(5000),
    admin.from('matrimony_profiles').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').gt('expires_at', now.toISOString()),
    admin.from('payments').select('amount_inr, created_at').eq('status', 'captured').gte('created_at', monthStart).limit(5000),
    admin.from('interests').select('status, created_at').gte('created_at', monthStart).limit(5000),
    admin.from('messages').select('created_at').gte('created_at', monthStart).limit(5000),
    admin.from('profile_boosts').select('id', { count: 'exact', head: true }).eq('status', 'active').gt('expires_at', now.toISOString()),
    admin.from('matrimony_profiles').select('city').eq('status', 'active').limit(5000),
    admin.from('activity_events').select('event, created_at').order('created_at', { ascending: false }).limit(20),
  ])

  // ---- series (last 14 days) ----
  const days: string[] = Array.from({ length: WINDOW_DAYS }, (_, i) =>
    dayKey(new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY))
  )
  const bucket = <T,>(rows: T[] | null, getDate: (r: T) => string): Map<string, number> => {
    const m = new Map<string, number>(days.map((d) => [d, 0]))
    for (const r of rows ?? []) {
      const k = dayKey(new Date(getDate(r)))
      if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }
  const signupSeries = bucket(signups.data, (r) => r.created_at)
  const messageSeries = bucket(messages.data, (r) => r.created_at)
  const interestSeries = bucket(interests.data, (r) => r.created_at)

  const revenueByDay = new Map<string, number>(days.map((d) => [d, 0]))
  for (const p of payments.data ?? []) {
    const k = dayKey(new Date(p.created_at))
    if (revenueByDay.has(k)) revenueByDay.set(k, (revenueByDay.get(k) ?? 0) + (p.amount_inr ?? 0))
  }

  // ---- KPIs ----
  const newWeek = (signups.data ?? []).filter((s) => s.created_at >= weekStart).length
  const revenueMonth = (payments.data ?? []).reduce((s, p) => s + (p.amount_inr ?? 0), 0)
  const interestsMonth = (interests.data ?? []).length
  const acceptedMonth = (interests.data ?? []).filter((i) => i.status === 'accepted').length
  const messagesMonth = (messages.data ?? []).length

  const cityCounts = new Map<string, number>()
  for (const c of cities.data ?? []) {
    const city = (c.city ?? '').trim()
    if (!city) continue
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1)
  }
  const topCities = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  const kpis = [
    { label: 'Total members', value: String(memberTotal.count ?? 0), icon: Users },
    { label: 'New in 7 days', value: String(newWeek), icon: TrendingUp },
    { label: 'Live profiles', value: String(liveProfiles.count ?? 0), icon: HeartHandshake },
    { label: 'Live subscriptions', value: String(liveSubs.count ?? 0), icon: Activity },
    { label: 'Revenue · 30 days', value: `₹${revenueMonth.toLocaleString('en-IN')}`, icon: Banknote },
    { label: 'Interests · 30 days', value: String(interestsMonth), icon: HeartHandshake },
    { label: 'Accepted · 30 days', value: String(acceptedMonth), icon: HeartHandshake },
    { label: 'Messages · 30 days', value: String(messagesMonth), icon: MessagesSquare },
    { label: 'Active boosts', value: String(boosts.count ?? 0), icon: TrendingUp },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Analytics</h1>
        <p className="mt-1 text-sm text-stone-500">
          Growth and engagement, computed live. Days are IST calendar days.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-stone-200 bg-white p-4">
            <k.icon className="h-5 w-5 text-maroon" aria-hidden />
            <p className="mt-2 font-display text-2xl font-bold text-stone-900">{k.value}</p>
            <p className="text-xs text-stone-500">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Signups per day" unit="members">
          <Bars days={days} values={days.map((d) => signupSeries.get(d) ?? 0)} />
        </ChartCard>
        <ChartCard title="Revenue per day" unit="₹ captured">
          <Bars days={days} values={days.map((d) => revenueByDay.get(d) ?? 0)} money />
        </ChartCard>
        <ChartCard title="Interests per day" unit="sent">
          <Bars days={days} values={days.map((d) => interestSeries.get(d) ?? 0)} />
        </ChartCard>
        <ChartCard title="Messages per day" unit="sent">
          <Bars days={days} values={days.map((d) => messageSeries.get(d) ?? 0)} />
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-stone-900">Top cities (live profiles)</h2>
          {topCities.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">No live profiles yet.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {topCities.map(([city, n]) => (
                <li key={city}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-stone-800">{city}</span>
                    <span className="text-stone-500">{n}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-gold-400 to-brand-500"
                      style={{ width: `${Math.max(4, Math.round((n / (topCities[0]?.[1] ?? 1)) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-stone-900">Latest activity</h2>
          {(recentActivity.data ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">No activity recorded yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {(recentActivity.data ?? []).map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold text-stone-800">{a.event}</span>
                  <span className="shrink-0 text-xs text-stone-400">
                    {new Date(a.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function ChartCard({
  title,
  unit,
  children,
}: {
  title: string
  unit: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-stone-900">{title}</h2>
        <span className="text-xs text-stone-400">{unit} · 14 days</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Bars({ days, values, money = false }: { days: string[]; values: number[]; money?: boolean }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-36 items-end gap-1">
      {days.map((d, i) => {
        const v = values[i] ?? 0
        const h = Math.max(3, Math.round((v / max) * 100))
        return (
          <div key={d} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d}: ${money ? `₹${v.toLocaleString('en-IN')}` : v}`}>
            <div
              className="w-full rounded-t-md bg-maroon/80 transition-colors group-hover:bg-maroon"
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
