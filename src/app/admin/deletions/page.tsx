import { AlertTriangle, Trash2 } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { cancelDeletion, processDeletion } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Deletions' }
export const dynamic = 'force-dynamic'

export default async function AdminDeletionsPage() {
  const { admin } = await requireAdminPage()
  const { data: rows } = await admin
    .from('account_deletion_requests')
    .select('id, user_id, reason, created_at, profiles!account_deletion_requests_user_id_fkey(full_name, email)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Trash2 className="h-6 w-6 text-brand-600" /> Account deletion requests
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Members already see their profile hidden the moment they request. Processing is permanent
          — it deletes the auth user and everything keyed to it.
        </p>
      </div>

      <ul className="space-y-3">
        {(rows ?? []).map((r) => {
          const person = r.profiles as { full_name?: string; email?: string } | null
          return (
            <li key={r.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-stone-900">{person?.full_name ?? 'Member'}</p>
                  <p className="text-xs text-stone-500">
                    {person?.email ?? ''} · requested {new Date(r.created_at).toLocaleString('en-IN')}
                  </p>
                  {r.reason && <p className="mt-1 text-sm text-stone-600">“{r.reason}”</p>}
                </div>
                <div className="flex gap-2">
                  <form action={processDeletion}>
                    <input type="hidden" name="request_id" value={r.id} />
                    <input type="hidden" name="user_id" value={r.user_id} />
                    <button type="submit" className="rounded-full bg-brand-700 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800">
                      <AlertTriangle className="mr-1 inline h-3 w-3" /> Delete permanently
                    </button>
                  </form>
                  <form action={cancelDeletion}>
                    <input type="hidden" name="request_id" value={r.id} />
                    <button type="submit" className="rounded-full border border-stone-300 px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50">
                      Keep account
                    </button>
                  </form>
                </div>
              </div>
            </li>
          )
        })}
        {(rows ?? []).length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
            No pending deletion requests.
          </li>
        )}
      </ul>
    </div>
  )
}
