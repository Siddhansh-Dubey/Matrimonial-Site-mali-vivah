import { Activity, BadgeCheck, Banknote, FileWarning, Flame, Heart, Rocket, ShieldBan, Users } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPage } from '@/lib/admin/server'

export const metadata = { title: 'Admin · Dashboard' }
export const dynamic = 'force-dynamic'

async function count(table: string, filter: (q: any) => any): Promise<number> {
  const admin = createAdminClient()
  let q: any = admin.from(table as never).select('id', { count: 'exact', head: true })
  q = filter(q)
  const { count: c } = await q
  return c ?? 0
}

export default async function AdminDashboard() {
  await requireAdminPage()
  const admin = createAdminClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today)
  monthStart.setDate(1)

  const [
    members,
    activeProfiles,
    liveSubscriptions,
    paymentsToday,
    revenueMonthRows,
    openReports,
    pendingVerifications,
    liveMoments,
    activeBoosts,
    auditRows,
  ] = await Promise.all([
    count('profiles', (q) => q),
    count('matrimony_profiles', (q) => q.eq('status', 'active')),
    count('subscriptions', (q) => q.eq('status', 'active').gt('expires_at', new Date().toISOString())),
    count('payments', (q) => q.eq('status', 'captured').gte('created_at', today.toISOString())),
    admin
      .from('payments')
      .select('amount_inr')
      .eq('status', 'captured')
      .gte('created_at', monthStart.toISOString()),
    count('reports', (q) => q.in('status', ['open', 'reviewing'])),
    count('verification_requests', (q) => q.eq('status', 'pending')),
    count('moments', (q) => q.eq('is_removed', false).gt('expires_at', new Date().toISOString())),
    count('profile_boosts', (q) => q.eq('status', 'active')),
    admin.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(20),
  ])

  const revenueMonth = ((revenueMonthRows.data ?? []) as { amount_inr: number }[]).reduce(
    (s, r) => s + r.amount_inr,
    0
  )

  const stats = [
    { label: 'Registered members', value: members, icon: Users, href: '/admin/members' },
    { label: 'Live public profiles', value: activeProfiles, icon: Heart, href: '/admin/members' },
    { label: 'Live subscriptions', value: liveSubscriptions, icon: Rocket, href: '/admin/payments' },
    { label: 'Payments captured today', value: paymentsToday, icon: Banknote, href: '/admin/payments' },
    { label: 'Revenue this month', value: `₹${revenueMonth.toLocaleString('en-IN')}`, icon: Banknote, href: '/admin/payments' },
    { label: 'Open reports', value: openReports, icon: FileWarning, href: '/admin/reports' },
    { label: 'Pending verifications', value: pendingVerifications, icon: BadgeCheck, href: '/admin/verification' },
    { label: 'Live moments', value: liveMoments, icon: Flame, href: '/admin/moments' },
    { label: 'Active boosts', value: activeBoosts, icon: ShieldBan, href: '/admin/featured' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Dashboard</h1>
        <p className="mt-1 text-sm text-stone-500">
          Everything here is computed live from the database.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => (
          <a
            key={s.label}
            href={s.href}
            className="rounded-2xl border border-stone-200 bg-white p-4 transition-shadow hover:shadow-card-float"
          >
            <s.icon className="h-5 w-5 text-maroon" aria-hidden />
            <p className="mt-2 font-display text-2xl font-bold text-stone-900">{s.value}</p>
            <p className="text-xs text-stone-500">{s.label}</p>
          </a>
        ))}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-stone-900">
          <Activity className="h-5 w-5 text-maroon" /> Recent admin actions
        </h2>
        {(auditRows.data as { action: string; target_type: string | null; target_id: string | null; created_at: string; details: Record<string, unknown> }[] | null) && (auditRows.data as unknown[]).length > 0 ? (
          <ul className="mt-4 divide-y divide-stone-100">
            {(auditRows.data as { action: string; target_type: string | null; target_id: string | null; created_at: string }[]).map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="font-semibold text-stone-800">{a.action}</span>
                <span className="text-xs text-stone-500">
                  {a.target_type ? `${a.target_type}${a.target_id ? ` · ${a.target_id.slice(0, 8)}` : ''}` : ''}
                </span>
                <span className="text-xs text-stone-400">
                  {new Date(a.created_at).toLocaleString('en-IN')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-stone-500">No admin actions logged yet.</p>
        )}
      </div>
    </div>
  )
}
