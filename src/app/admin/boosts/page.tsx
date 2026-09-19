import { Rocket } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { updateBoostConfig } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Boosts' }
export const dynamic = 'force-dynamic'

/**
 * Boost configuration (PRD K) — the standalone purchasable boost add-on
 * (price + duration, active flag). Package-INCLUDED boosts are configured
 * per plan under Packages (benefits.boosts_included); this page only manages
 * the add-on that members can buy any time through Razorpay.
 */
export default async function AdminBoostsPage() {
  const { admin } = await requireAdminPage()

  const [cfgRes, activeRes, purchasedRes] = await Promise.all([
    admin.from('profile_boost_config').select('*').eq('id', 1).maybeSingle(),
    admin.from('profile_boosts').select('id', { count: 'exact', head: true }).eq('status', 'active').gt('expires_at', new Date().toISOString()),
    admin
      .from('payments')
      .select('amount_inr, created_at')
      .eq('kind', 'boost')
      .eq('status', 'captured')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  type CfgRow = { price_inr: number; duration_days: number; is_active: boolean }
  const cfg = (cfgRes.data as CfgRow | null) ?? { price_inr: 499, duration_days: 7, is_active: true }
  const activeCount = activeRes.count ?? 0
  const purchases = (purchasedRes.data ?? []) as { amount_inr: number; created_at: string }[]
  const boostRevenue = purchases.reduce((s, p) => s + p.amount_inr, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Profile Boosts</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Standalone boost add-on. Price and duration are read from this table by the payment API —
          the browser never supplies an amount. Included boosts (per plan) live in Packages.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-500">Live boosts right now</p>
          <p className="mt-1 font-display text-2xl font-bold text-stone-900">{activeCount}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-500">Boost purchases (captured)</p>
          <p className="mt-1 font-display text-2xl font-bold text-stone-900">{purchases.length}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-500">Boost add-on revenue</p>
          <p className="mt-1 font-display text-2xl font-bold text-stone-900">
            ₹{boostRevenue.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      <form action={updateBoostConfig} className="max-w-xl rounded-2xl border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-gold-600" />
          <h2 className="font-display text-lg font-bold text-stone-900">Add-on configuration</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-stone-500">Price (INR)</span>
            <input
              name="price_inr"
              type="number"
              min={0}
              step={1}
              defaultValue={cfg.price_inr}
              required
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-stone-500">Duration (days)</span>
            <input
              name="duration_days"
              type="number"
              min={1}
              max={30}
              defaultValue={cfg.duration_days}
              required
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
            />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={cfg.is_active}
            className="h-4 w-4 rounded border-stone-300 text-maroon focus:ring-maroon"
          />
          Purchases enabled (off = boost buy button hidden)
        </label>
        <button
          type="submit"
          className="mt-5 rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white hover:bg-maroon-dark"
        >
          Save boost configuration
        </button>
      </form>

      <div className="max-w-xl rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="font-display text-lg font-bold text-stone-900">Recent boost purchases</h2>
        {purchases.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No standalone boost purchases yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {purchases.map((p, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-stone-600">{new Date(p.created_at).toLocaleString('en-IN')}</span>
                <span className="font-semibold text-stone-900">₹{p.amount_inr.toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
