import { Ban, ShieldOff } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { unblockPair } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Blocked Users' }
export const dynamic = 'force-dynamic'

type Props = { searchParams?: { q?: string } }

/**
 * Blocked Users (PRD L) — every active block pair, who blocked whom and
 * when, with a one-click unblock. Blocks hide the pair from each other's
 * search, browse, Daily 5, chat and Moments site-wide.
 */
export default async function AdminBlocksPage({ searchParams }: Props) {
  const { admin } = await requireAdminPage()
  const q = (searchParams?.q ?? '').trim()

  // Optional member filter: resolve name/email/mobile → ids, then keep
  // blocks where either side matches. An empty id list matches nothing.
  let memberIds: string[] | null = null
  if (q) {
    const { data: found } = await admin
      .from('profiles')
      .select('id')
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,mobile.ilike.%${q}%`)
      .limit(50)
    memberIds = (found ?? []).map((m) => m.id)
  }

  let query = admin
    .from('blocks')
    .select(
      `
      blocker_id,
      blocked_id,
      reason,
      created_at,
      blocker:profiles!blocks_blocker_id_fkey (full_name, email),
      blocked:profiles!blocks_blocked_id_fkey (full_name, email)
    `
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (memberIds !== null) {
    const ids = memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000']
    query = query.or(`blocker_id.in.(${ids.join(',')}),blocked_id.in.(${ids.join(',')})`)
  }
  const { data: blocks } = await query

  type BlockRow = {
    blocker_id: string
    blocked_id: string
    reason: string | null
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

      <form action="/admin/blocks" method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Member name, email or mobile…"
          className="w-full max-w-sm rounded-full border border-stone-300 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
        />
        <button type="submit" className="rounded-full bg-maroon px-5 py-2 text-sm font-bold text-white">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
          <ShieldOff className="mx-auto h-7 w-7 text-stone-300" />
          <p className="mt-2">{q ? 'No blocks involve that member.' : 'No active blocks. Good.'}</p>
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
                    {b.reason && <> · “{b.reason}”</>}
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
