import { BadgeCheck, Check, X } from 'lucide-react'
import Link from 'next/link'
import { requireAdminPage } from '@/lib/admin/server'
import { decideVerification } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Verification' }
export const dynamic = 'force-dynamic'

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All statuses' },
] as const

const TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'mobile', label: 'Mobile OTP' },
  { value: 'photo', label: 'Photo' },
  { value: 'id_proof', label: 'ID proof' },
] as const

/**
 * Verification queue — filterable by status and request type, with submitted
 * documents shown through short-lived signed URLs (the verification-docs
 * bucket is private to everyone but the owner and the service role rendering
 * this page).
 */
export default async function AdminVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>
}) {
  const { admin } = await requireAdminPage()
  const sp = await searchParams
  const status = STATUSES.some((s) => s.value === sp.status) ? (sp.status as string) : 'pending'
  const type = TYPES.some((t) => t.value === sp.type) ? (sp.type as string) : 'all'
  const href = (s: string, t: string) => `/admin/verification?status=${s}&type=${t}`

  let query = admin
    .from('verification_requests')
    .select('id, user_id, type, storage_path, status, created_at, profiles!verification_requests_user_id_fkey(full_name, email)')
    .order('created_at', { ascending: status === 'pending' })
    .limit(100)
  if (status !== 'all') query = query.eq('status', status)
  if (type !== 'all') query = query.eq('type', type)
  const { data: rows } = await query

  const list = rows ?? []

  // Signed URLs (120s TTL — just long enough to render the queue).
  const signed = new Map<string, string>()
  for (const r of list) {
    if (!r.storage_path) continue
    try {
      const { data } = await admin.storage.from('verification-docs').createSignedUrl(r.storage_path, 120)
      if (data?.signedUrl) signed.set(r.id, data.signedUrl)
    } catch {
      /* preview unavailable — decision form still works */
    }
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-bold transition ${
      active
        ? 'border-stone-900 bg-stone-900 text-white'
        : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
    }`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <BadgeCheck className="h-6 w-6 text-emerald-600" /> Verification queue
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {list.length} request{list.length === 1 ? '' : 's'} — approving applies the badge
          instantly and notifies the member.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-stone-400">Status</span>
          {STATUSES.map((s) => (
            <Link key={s.value} href={href(s.value, type)} className={chip(status === s.value)}>
              {s.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-stone-400">Type</span>
          {TYPES.map((t) => (
            <Link key={t.value} href={href(status, t.value)} className={chip(type === t.value)}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
          {status === 'pending' ? 'All caught up — the queue is empty.' : 'No requests match this filter.'}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.map((r) => {
            const person = r.profiles as { full_name?: string; email?: string } | null
            const url = signed.get(r.id)
            return (
              <li key={r.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {r.status !== 'pending' && (
                  <div
                    className={`px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide ${
                      r.status === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    {r.status}
                  </div>
                )}
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="Verification document" className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 text-sm text-stone-400">
                    {r.type === 'mobile' ? 'OTP-verified — no document' : 'No document attached'}
                  </div>
                )}
                <div className="space-y-3 p-4">
                  <div>
                    <p className="font-semibold text-stone-900">{person?.full_name ?? 'Member'}</p>
                    <p className="text-xs text-stone-500">
                      {person?.email ?? ''} · {r.type.replace(/_/g, ' ')} ·{' '}
                      {new Date(r.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                  {r.status === 'pending' && (
                    <div className="flex gap-2">
                      <form action={decideVerification} className="flex-1">
                        <input type="hidden" name="request_id" value={r.id} />
                        <input type="hidden" name="decision" value="verified" />
                        <button type="submit" className="w-full rounded-full bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700">
                          <Check className="mr-1 inline h-3 w-3" /> Approve
                        </button>
                      </form>
                      <form action={decideVerification} className="flex-1">
                        <input type="hidden" name="request_id" value={r.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button type="submit" className="w-full rounded-full border border-brand-300 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">
                          <X className="mr-1 inline h-3 w-3" /> Reject
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
