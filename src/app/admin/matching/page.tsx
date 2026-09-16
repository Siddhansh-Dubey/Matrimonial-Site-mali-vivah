import { Settings2 } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { updateMatchingConfig } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Matching' }
export const dynamic = 'force-dynamic'

const PRD_WEIGHTS = {
  age: 15,
  location: 15,
  education: 10,
  occupation: 10,
  income: 10,
  community: 10,
  partner_prefs: 15,
  lifestyle: 10,
  behaviour: 5,
}

export default async function AdminMatchingPage() {
  const { admin } = await requireAdminPage()
  const { data: cfg } = await admin.from('matching_config').select('*').eq('id', 1).maybeSingle()

  const weights = (cfg?.weights as Record<string, number> | null) ?? PRD_WEIGHTS

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Settings2 className="h-6 w-6 text-maroon" /> Matching engine
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          The Daily 5 engine reads this config live. Total weights should stay 100 — the PRD
          defaults are shown for reference.
        </p>
      </div>

      <form action={updateMatchingConfig} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">
              Compatibility threshold (0–100)
            </span>
            <input
              name="threshold"
              type="number"
              min={0}
              max={100}
              step={0.5}
              defaultValue={cfg?.threshold ?? 90}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">
              Daily 5 — how many per day
            </span>
            <input
              name="daily_count"
              type="number"
              min={1}
              max={25}
              defaultValue={cfg?.daily_count ?? 5}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">
            Component weights (JSON — should total 100)
          </span>
          <textarea
            name="weights"
            rows={10}
            defaultValue={JSON.stringify(weights, null, 2)}
            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 font-mono text-xs"
          />
        </label>
        <p className="text-xs text-stone-500">
          PRD reference: <code className="font-mono">{JSON.stringify(PRD_WEIGHTS)}</code>
          {cfg?.updated_at && (
            <> · last updated {new Date(cfg.updated_at).toLocaleString('en-IN')}</>
          )}
        </p>
        <button type="submit" className="rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white">
          Save configuration
        </button>
      </form>
    </div>
  )
}
