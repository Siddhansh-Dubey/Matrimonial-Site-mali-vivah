import { BadgeCheck, Check, X } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { decideVerification } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Verification' }
export const dynamic = 'force-dynamic'

/**
 * Verification queue — pending requests with the submitted document showing
 * through a short-lived signed URL (the verification-docs bucket is private
 * to everyone but the owner and the service role rendering this page).
 */
export default async function AdminVerificationPage() {
  const { admin } = await requireAdminPage()

  const { data: pending } = await admin
    .from('verification_requests')
    .select('id, user_id, type, storage_path, created_at, profiles!verification_requests_user_id_fkey(full_name, email)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)

  const rows = pending ?? []

  // Signed URLs (60s TTL — just long enough to render the queue).
  const signed = new Map<string, string>()
  for (const r of rows) {
    if (!r.storage_path) continue
    try {
      const { data } = await admin.storage.from('verification-docs').createSignedUrl(r.storage_path, 120)
      if (data?.signedUrl) signed.set(r.id, data.signedUrl)
    } catch {
      /* preview unavailable — decision form still works */
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <BadgeCheck className="h-6 w-6 text-emerald-600" /> Verification queue
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {rows.length} pending request{rows.length === 1 ? '' : 's'} — approving applies the badge
          instantly and notifies the member.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
          All caught up — the queue is empty.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => {
            const person = r.profiles as { full_name?: string; email?: string } | null
            const url = signed.get(r.id)
            return (
              <li key={r.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="Verification document" className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 text-sm text-stone-400">
                    No document attached
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
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
