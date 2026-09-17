import { Images } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { removeMoment } from '@/app/admin/actions'
import { photoUrl } from '@/lib/profile/photos'

export const metadata = { title: 'Admin · Moments' }
export const dynamic = 'force-dynamic'

export default async function AdminMomentsPage() {
  const { admin } = await requireAdminPage()
  const { data: rows } = await admin
    .from('moments')
    .select('id, user_id, storage_path, caption, expires_at, is_removed, created_at, profiles!moments_user_id_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Images className="h-6 w-6 text-gold-600" /> Moments moderation
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Latest moments (24-hour lifetime). Removing hides them instantly everywhere.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {(rows ?? []).map((m) => {
          const person = m.profiles as { full_name?: string } | null
          const expired = new Date(m.expires_at) < new Date()
          return (
            <li key={m.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(m.storage_path) ?? ''} alt={m.caption ?? 'Moment'} className="aspect-[3/4] w-full object-cover" />
              <div className="space-y-1.5 p-3">
                <p className="truncate text-xs font-semibold text-stone-800">
                  {person?.full_name ?? 'Member'}
                  {m.is_removed && (
                    <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-800">REMOVED</span>
                  )}
                  {expired && <span className="ml-2 text-[10px] font-bold text-stone-400">EXPIRED</span>}
                </p>
                {m.caption && <p className="truncate text-xs text-stone-500">{m.caption}</p>}
                {!m.is_removed && !expired && (
                  <form action={removeMoment}>
                    <input type="hidden" name="moment_id" value={m.id} />
                    <button type="submit" className="text-xs font-bold text-brand-700 hover:underline">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </li>
          )
        })}
        {(rows ?? []).length === 0 && (
          <li className="col-span-full rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
            No moments in the last while.
          </li>
        )}
      </ul>
    </div>
  )
}
