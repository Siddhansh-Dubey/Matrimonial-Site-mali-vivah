import { Star } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { setFeatured } from '@/app/admin/actions'
import { photoUrl } from '@/lib/profile/photos'

export const metadata = { title: 'Admin · Featured' }
export const dynamic = 'force-dynamic'

export default async function AdminFeaturedPage() {
  const { admin } = await requireAdminPage()

  const { data: rows } = await admin
    .from('featured_profiles')
    .select('profile_id, position, created_at')
    .order('position', { ascending: true })

  const ids = (rows ?? []).map((r: { profile_id: string }) => r.profile_id)
  const emptyId = '00000000-0000-0000-0000-000000000000'
  const [mps, photos, people] = await Promise.all([
    admin
      .from('matrimony_profiles')
      .select('user_id, status, gender, city')
      .in('user_id', ids.length ? ids : [emptyId]),
    admin
      .from('profile_photos')
      .select('profile_id, storage_path, is_primary')
      .in('profile_id', ids.length ? ids : [emptyId])
      .eq('kind', 'profile_photo'),
    admin
      .from('profiles')
      .select('id, full_name')
      .in('id', ids.length ? ids : [emptyId]),
  ])
  const nameBy = new Map((people.data ?? []).map((p) => [p.id, p.full_name]))
  const mpBy = new Map((mps.data ?? []).map((m) => [m.user_id, m]))
  const photoBy = new Map(
    (photos.data ?? [])
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((p) => [p.profile_id, p.storage_path] as const)
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Star className="h-6 w-6 text-gold-600" /> Homepage featured profiles
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Add from Members (“Feature”), reorder here. A profile must be live (active) to appear on
          the homepage — the RPC double-checks and skips anything hidden.
        </p>
      </div>

      <ul className="space-y-3">
        {(rows ?? []).map((r) => {
          const fullName = nameBy.get(r.profile_id) ?? 'Member'
          const mp = mpBy.get(r.profile_id)
          const photo = photoBy.get(r.profile_id)
          return (
            <li key={r.profile_id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4">
              {photoUrl(photo) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl(photo) ?? ''} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-xl bg-brand-50 text-lg font-bold text-brand-300">
                  {fullName[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-stone-900">{fullName}</p>
                <p className="text-xs text-stone-500">
                  {mp?.gender ?? '—'} · {mp?.city ?? '—'} · status:{' '}
                  <span className={mp?.status === 'active' ? 'font-bold text-emerald-700' : 'font-bold text-brand-700'}>
                    {mp?.status ?? '—'}
                  </span>
                </p>
              </div>
              <form action={setFeatured} className="flex items-center gap-2">
                <input type="hidden" name="user_id" value={r.profile_id} />
                <input type="hidden" name="feature" value="true" />
                <input
                  name="position"
                  type="number"
                  min={0}
                  max={32767}
                  step={1}
                  defaultValue={r.position}
                  className="w-20 rounded-full border border-stone-300 px-3 py-1.5 text-sm"
                  aria-label="Position"
                />
                <button type="submit" className="rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-bold text-stone-700 hover:border-maroon">
                  Save position
                </button>
              </form>
              <form action={setFeatured}>
                <input type="hidden" name="user_id" value={r.profile_id} />
                <input type="hidden" name="feature" value="false" />
                <button type="submit" className="text-xs font-bold text-brand-700 hover:underline">
                  Remove
                </button>
              </form>
            </li>
          )
        })}
        {(rows ?? []).length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
            Nothing featured yet — use Members → Feature.
          </li>
        )}
      </ul>
    </div>
  )
}
