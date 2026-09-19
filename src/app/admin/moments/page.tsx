import { Flag, Images } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { removeMoment } from '@/app/admin/actions'
import { photoUrl } from '@/lib/profile/photos'

export const metadata = { title: 'Admin · Moments' }
export const dynamic = 'force-dynamic'

export default async function AdminMomentsPage() {
  const { admin } = await requireAdminPage()
  const [{ data: rows }, { data: reports }] = await Promise.all([
    admin
      .from('moments')
      .select('id, user_id, media_type, storage_path, caption, expires_at, is_removed, created_at, profiles!moments_user_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('moment_reports')
      .select('id, moment_id, reason, details, created_at, moments!moment_reports_moment_id_fkey(id, user_id, is_removed, expires_at)')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

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

      {(reports ?? []).length > 0 && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
            <Flag className="h-4 w-4" /> Reported moments ({reports?.length})
          </h2>
          <ul className="mt-3 space-y-2.5">
            {(reports ?? []).map((r) => {
              const moment = r.moments as { is_removed?: boolean; expires_at?: string } | null
              const gone = moment?.is_removed || (moment?.expires_at ? new Date(moment.expires_at) < new Date() : false)
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-bold text-stone-900">
                      {String(r.reason).replace(/_/g, ' ')}
                    </span>
                    {r.details && <span className="text-stone-500"> — {r.details}</span>}
                    <span className="ml-2 text-xs text-stone-400">
                      {new Date(r.created_at).toLocaleString('en-IN')}
                    </span>
                    {gone && (
                      <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-500">
                        GONE
                      </span>
                    )}
                  </div>
                  {!gone && (
                    <form action={removeMoment}>
                      <input type="hidden" name="moment_id" value={r.moment_id} />
                      <button type="submit" className="text-xs font-bold text-brand-700 hover:underline">
                        Remove moment
                      </button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {(rows ?? []).map((m) => {
          const person = m.profiles as { full_name?: string } | null
          const expired = new Date(m.expires_at) < new Date()
          return (
            <li key={m.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {m.media_type === 'video' ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={photoUrl(m.storage_path) ?? ''} muted playsInline preload="metadata" controls className="aspect-[3/4] w-full bg-black object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl(m.storage_path) ?? ''} alt={m.caption ?? 'Moment'} className="aspect-[3/4] w-full object-cover" />
              )}
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
