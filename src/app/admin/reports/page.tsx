import { FileWarning } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { resolveReport } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Reports' }
export const dynamic = 'force-dynamic'

export default async function AdminReportsPage() {
  const { admin } = await requireAdminPage()
  const { data: rows } = await admin
    .from('reports')
    .select('id, reporter_id, reported_id, reason, details, status, created_at')
    .in('status', ['open', 'reviewing'])
    .order('created_at', { ascending: true })
    .limit(100)

  const ids = [...new Set((rows ?? []).flatMap((r) => [r.reporter_id, r.reported_id]))]
  const emptyId = '00000000-0000-0000-0000-000000000000'
  const { data: people } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids.length ? ids : [emptyId])
  const nameBy = new Map((people ?? []).map((p) => [p.id, p]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <FileWarning className="h-6 w-6 text-brand-600" /> Reports
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {(rows ?? []).length} open — escalate offenders to suspended from Members.
        </p>
      </div>

      <ul className="space-y-3">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-900">
                  {nameBy.get(r.reported_id)?.full_name ?? r.reported_id.slice(0, 8)} reported for{' '}
                  <span className="text-brand-700">{r.reason.replace(/_/g, ' ')}</span>
                </p>
                <p className="text-xs text-stone-500">
                  by {nameBy.get(r.reporter_id)?.full_name ?? r.reporter_id.slice(0, 8)} ·{' '}
                  {new Date(r.created_at).toLocaleString('en-IN')}
                </p>
                {r.details && <p className="mt-1 text-sm text-stone-600">“{r.details}”</p>}
              </div>
              <div className="flex gap-2">
                {(['reviewing', 'resolved', 'dismissed'] as const).map((s) => (
                  <form key={s} action={resolveReport}>
                    <input type="hidden" name="report_id" value={r.id} />
                    <input type="hidden" name="status" value={s} />
                    <button
                      type="submit"
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                        s === 'resolved'
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : s === 'dismissed'
                            ? 'border border-stone-300 text-stone-600 hover:bg-stone-50'
                            : 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      {s}
                    </button>
                  </form>
                ))}
              </div>
            </div>
          </li>
        ))}
        {(rows ?? []).length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
            No open reports. Great sign.
          </li>
        )}
      </ul>
    </div>
  )
}
