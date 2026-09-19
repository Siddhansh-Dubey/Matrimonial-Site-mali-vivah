import { Ban, ShieldOff } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { unblockPair } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Blocked Users' }
export const dynamic = 'force-dynamic'

/**
 * Blocked Users (PRD L) — every active block pair, who blocked whom and
 * when, with a one-click unblock. Blocks hide the pair from each other's
 * search, browse, Daily 5, chat and Moments site-wide.
 */
export default async function AdminBlocksPage() {
  const { admin } = await requireAdminPage()

  const { data: blocks } = await admin
    .from('blocks')
    .select(
      `
      blocker_id,
      blocked_id,
      created_at,
      blocker:profiles!blocks_blocker_id_fkey (full_name, email),
      blocked:profiles!blocks_blocked_id_fkey (full_name, email)
    `
    )
    .order('created_at', { ascending: false })
    .limit(200)

  type BlockRow = {
    blocker_id: string
    blocked_id: string
    created_at: string
    blocker: { full_name: string; email: string } | null
    blocked: { full_name: string; email: string } | null
  }
  const rows = (blocks ?? []) as unknown as BlockRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Blocked Users</h1>
        <p className="mt-1 text-sm text-stone-500">
          Members who blocked each other. A blocked pair is invisible in search, browse, Daily 5,
          chat and Moments — in both directions.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
          <ShieldOff className="mx-auto h-7 w-7 text-stone-300" />
          <p className="mt-2">No active blocks. Good.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => (
            <li key={`${b.blocker_id}-${b.blocked_id}`} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-stone-900">
                    {b.blocker?.full_name ?? 'Unknown'}{' '}
                    <span className="text-xs font-normal text-stone-400">({b.blocker?.email ?? b.blocker_id.slice(0, 8)})</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-stone-600">
                    <Ban className="h-3.5 w-3.5 text-brand-600" /> blocked
                  </p>
                  <p className="font-semibold text-stone-900">
                    {b.blocked?.full_name ?? 'Unknown'}{' '}
                    <span className="text-xs font-normal text-stone-400">({b.blocked?.email ?? b.blocked_id.slice(0, 8)})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    since {new Date(b.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
                <form action={unblockPair}>
                  <input type="hidden" name="blocker_id" value={b.blocker_id} />
                  <input type="hidden" name="blocked_id" value={b.blocked_id} />
                  <button
                    type="submit"
                    className="rounded-full border border-emerald-300 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                  >
                    Unblock
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
