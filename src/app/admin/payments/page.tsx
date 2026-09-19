import { Banknote, RotateCcw } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { manualActivate, refundPayment } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Payments' }
export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage() {
  const { admin } = await requireAdminPage()

  const [{ data: payments }, { data: subs }, { data: packages }] = await Promise.all([
    admin
      .from('payments')
      .select('id, user_id, package_slug, kind, amount_inr, status, razorpay_order_id, created_at, profiles!payments_user_id_fkey(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('subscriptions')
      .select('user_id, package_slug, status, expires_at')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(200),
    admin.from('packages').select('id, slug, name').eq('is_active', true).order('sort_order'),
  ])
  const liveByUser = new Set((subs ?? []).map((s) => s.user_id))

  const statusClass: Record<string, string> = {
    captured: 'bg-emerald-100 text-emerald-800',
    created: 'bg-amber-100 text-amber-800',
    failed: 'bg-brand-100 text-brand-800',
    cancelled: 'bg-stone-100 text-stone-600',
    refunded: 'bg-purple-100 text-purple-800',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Banknote className="h-6 w-6 text-emerald-600" /> Payments
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Captured payments activate memberships automatically. Use manual activation only when a
          support case verified the charge offline.
        </p>
      </div>

      <form action={manualActivate} className="flex flex-wrap items-end gap-2 rounded-2xl border border-gold-300 bg-gold-50/50 p-4">
        <span className="w-full text-xs font-bold uppercase tracking-wide text-gold-700">
          Manual activation — paste the member&apos;s email, mobile or UUID
        </span>
        <input name="user_id" placeholder="Email · mobile · User UUID" required className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm" />
        <select name="package_id" required className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm" defaultValue="">
          <option value="" disabled>Package…</option>
          {(packages ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input name="note" placeholder="Reason / Razorpay ref" className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm" />
        <button type="submit" className="rounded-full bg-gold-500 px-5 py-2 text-sm font-bold text-maroon-deep hover:bg-gold-400">
          Activate
        </button>
      </form>

      <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
        {(payments ?? []).map((p) => {
          const person = p.profiles as { full_name?: string; email?: string } | null
          const live = liveByUser.has(p.user_id)
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-stone-900">
                  {person?.full_name ?? 'Member'} · ₹{p.amount_inr.toLocaleString('en-IN')} ·{' '}
                  {p.kind === 'boost' ? 'Profile Boost add-on' : (p.package_slug ?? '—')}
                </p>
                <p className="text-xs text-stone-500">
                  {person?.email ?? ''} · {new Date(p.created_at).toLocaleString('en-IN')}
                  {p.razorpay_order_id ? ` · ${p.razorpay_order_id}` : ''}
                  {live && <span className="ml-2 font-bold text-emerald-700">· membership live</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass[p.status] ?? 'bg-stone-100 text-stone-600'}`}>
                  {p.status}
                </span>
                {p.status === 'captured' && (
                  <form action={refundPayment}>
                    <input type="hidden" name="payment_id" value={p.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-purple-300 px-3.5 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-50"
                      title={p.kind === 'boost' ? 'Refund & revoke only the boost this payment bought' : 'Refund & revoke membership'}
                    >
                      <RotateCcw className="mr-1 inline h-3 w-3" /> Refund
                    </button>
                  </form>
                )}
              </div>
            </li>
          )
        })}
        {(payments ?? []).length === 0 && (
          <li className="p-10 text-center text-sm text-stone-500">No payments yet.</li>
        )}
      </ul>
    </div>
  )
}
