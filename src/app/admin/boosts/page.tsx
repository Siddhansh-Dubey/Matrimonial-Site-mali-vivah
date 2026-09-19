import { Rocket } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { adminGrantBoost, updateBoostConfig } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Boosts' }
export const dynamic = 'force-dynamic'

/**
 * Boost configuration (PRD K).
 *  • duration_days is THE Profile Boost length — package-included, admin-
 *    granted and purchased boosts all read it (boost_duration_days()).
 *  • price_inr + is_active concern only the standalone add-on members can buy
 *    through Razorpay; switching purchases off never blocks included boosts.
 *  • How many boosts a plan includes stays per plan under Packages
 *    (benefits.boosts_included).
 * Also hosts the support tool that grants an admin-origin boost (no payment,
 * never counted against the member's package quota).
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
  // No invented defaults: when the row is missing every boost path refuses to
  // activate (BOOST_CONFIG_MISSING), and the form below says so.
  const cfg = (cfgRes.data as CfgRow | null) ?? null
  const activeCount = activeRes.count ?? 0
  const purchases = (purchasedRes.data ?? []) as { amount_inr: number; created_at: string }[]
  const boostRevenue = purchases.reduce((s, p) => s + p.amount_inr, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Profile Boosts</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          The duration below is the single Profile Boost length — it applies to package-included,
          admin-granted and purchased boosts alike. Price and the purchases switch concern only the
          standalone add-on; the payment API reads both server-side, the browser never supplies an
          amount. How many boosts each plan includes lives in Packages.
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
          <h2 className="font-display text-lg font-bold text-stone-900">Boost configuration</h2>
        </div>
        {!cfg && (
          <p className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
            The configuration row is missing — no boost (included, admin or purchased) can be
            activated until it is saved. Apply migration 20260919010000_boost_purchases.sql or save
            the form below.
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-stone-500">Add-on price (INR)</span>
            <input
              name="price_inr"
              type="number"
              min={0}
              step={1}
              defaultValue={cfg?.price_inr}
              required
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-stone-500">Boost duration (days) — all boosts</span>
            <input
              name="duration_days"
              type="number"
              min={1}
              max={30}
              defaultValue={cfg?.duration_days}
              required
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
            />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={cfg?.is_active ?? false}
            className="h-4 w-4 rounded border-stone-300 text-maroon focus:ring-maroon"
          />
          Purchases enabled (off = buy button hidden; included boosts keep working)
        </label>
        <button
          type="submit"
          className="mt-5 rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white hover:bg-maroon-dark"
        >
          Save boost configuration
        </button>
      </form>

      <form action={adminGrantBoost} className="flex max-w-xl flex-wrap items-end gap-2 rounded-2xl border border-gold-300 bg-gold-50/50 p-4">
        <span className="w-full text-xs font-bold uppercase tracking-wide text-gold-700">
          Grant a support boost — paste the member&apos;s email, mobile or UUID
        </span>
        <input
          name="user_id"
          placeholder="Email · mobile · User UUID"
          required
          className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-full bg-gold-500 px-5 py-2 text-sm font-bold text-maroon-deep hover:bg-gold-400"
        >
          Grant {cfg ? `${cfg.duration_days}-day` : ''} boost
        </button>
        <p className="w-full text-[11px] text-stone-500">
          Uses the configured duration, attaches no payment and does not consume the member&apos;s
          package-included boosts. Refused while the member already has a live boost.
        </p>
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
