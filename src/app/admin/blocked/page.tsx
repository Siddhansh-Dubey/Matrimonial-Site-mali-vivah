import { ShieldBan } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { removeBlock } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Blocked users' }
export const dynamic = 'force-dynamic'

type Props = { searchParams?: { q?: string } }

/**
 * Member-to-member blocks. Blocks are invisible to the blocked member and
 * enforced everywhere server-side (search, profile pages, interests, chat).
 * Admins step in only for disputes or mistaken blocks — removal is audited.
 */
export default async function AdminBlockedPage({ searchParams }: Props) {
  const { admin } = await requireAdminPage()
  const q = (searchParams?.q ?? '').trim()

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
    .select('id, blocker_id, blocked_id, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (memberIds !== null) {
    // (blocker ∈ ids) OR (blocked ∈ ids). An empty id list matches nothing.
    const ids = memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000']
    query = query.or(`blocker_id.in.(${ids.join(',')}),blocked_id.in.(${ids.join(',')})`)
  }
  const { data: rows } = await query

  const ids = Array.from(
    new Set((rows ?? []).flatMap((r) => [r.blocker_id, r.blocked_id]))
  )
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const nameBy = new Map((profiles ?? []).map((p) => [p.id, p]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Blocked users</h1>
        <p className="mt-1 text-sm text-stone-500">
          Who blocked whom. Removing a block is immediate and audited — use it for disputes and
          mistaken blocks only.
        </p>
      </div>

      <form action="/admin/blocked" method="get" className="flex gap-2">
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

      <ul className="space-y-3">
        {(rows ?? []).map((b) => {
          const blocker = nameBy.get(b.blocker_id)
          const blocked = nameBy.get(b.blocked_id)
          return (
            <li key={b.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-stone-900">
                    <span className="font-semibold">{blocker?.full_name ?? 'Member'}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800">
                      <ShieldBan className="h-3 w-3" /> blocked
                    </span>
                    <span className="font-semibold">{blocked?.full_name ?? 'Member'}</span>
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {blocker?.email ?? ''} → {blocked?.email ?? ''} ·{' '}
                    {new Date(b.created_at).toLocaleString('en-IN')}
                    {b.reason && <> · “{b.reason}”</>}
                  </p>
                </div>
                <form action={removeBlock}>
                  <input type="hidden" name="block_id" value={b.id} />
                  <button
                    type="submit"
                    className="rounded-full border border-emerald-300 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                  >
                    Remove block
                  </button>
                </form>
              </div>
            </li>
          )
        })}
        {(rows ?? []).length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            {q ? 'No blocks involve that member.' : 'Nobody has blocked anyone yet.'}
          </li>
        )}
      </ul>
    </div>
  )
}
