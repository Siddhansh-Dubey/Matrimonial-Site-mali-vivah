import { BadgeCheck, Ban, Rocket, Star } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { setFeatured, setProfileSuspended, setProfileVerified } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Members' }
export const dynamic = 'force-dynamic'

type Props = { searchParams?: { q?: string } }

export default async function AdminMembersPage({ searchParams }: Props) {
  const { admin } = await requireAdminPage()
  const q = (searchParams?.q ?? '').trim()

  let base = admin
    .from('profiles')
    .select('id, full_name, email, mobile, is_active, is_admin, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (q) {
    base = base.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,mobile.ilike.%${q}%`)
  }
  const { data: rows } = await base

  const ids = (rows ?? []).map((r) => r.id)
  const emptyId = '00000000-0000-0000-0000-000000000000'
  const [mps, subs, feats] = await Promise.all([
    admin
      .from('matrimony_profiles')
      .select('user_id, status, gender, city, verified_at')
      .in('user_id', ids.length ? ids : [emptyId]),
    admin
      .from('subscriptions')
      .select('user_id, package_slug, status, expires_at')
      .in('user_id', ids.length ? ids : [emptyId])
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
    admin
      .from('featured_profiles')
      .select('profile_id')
      .in('profile_id', ids.length ? ids : [emptyId]),
  ])
  const mpBy = new Map((mps.data ?? []).map((m) => [m.user_id, m]))
  const subBy = new Map((subs.data ?? []).map((s) => [s.user_id, s]))
  const featSet = new Set((feats.data ?? []).map((f) => f.profile_id))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Members</h1>
        <p className="mt-1 text-sm text-stone-500">Search and manage member profiles.</p>
      </div>

      <form action="/admin/members" method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Name, email or mobile…"
          className="w-full max-w-sm rounded-full border border-stone-300 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30"
        />
        <button type="submit" className="rounded-full bg-maroon px-5 py-2 text-sm font-bold text-white">
          Search
        </button>
      </form>

      <ul className="space-y-3">
        {(rows ?? []).map((p) => {
          const mp = mpBy.get(p.id)
          const sub = subBy.get(p.id)
          const featured = featSet.has(p.id)
          return (
            <li key={p.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-stone-900">
                    {p.full_name}
                    {p.is_admin && (
                      <span className="ml-2 rounded-full bg-gold-300 px-2 py-0.5 text-[10px] font-bold text-maroon-deep">
                        ADMIN
                      </span>
                    )}
                    {mp?.verified_at && <BadgeCheck className="ml-1 inline h-4 w-4 text-emerald-600" />}
                  </p>
                  <p className="text-xs text-stone-500">
                    {p.email} · {p.mobile ?? 'no mobile'} · joined{' '}
                    {new Date(p.created_at).toLocaleDateString('en-IN')}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    profile:{' '}
                    <span className={`font-bold ${mp?.status === 'active' ? 'text-emerald-700' : mp?.status === 'suspended' ? 'text-brand-700' : 'text-stone-600'}`}>
                      {mp?.status ?? '—'}
                    </span>
                    {sub && (
                      <>
                        {' '}· plan: <span className="font-bold text-emerald-700">{sub.package_slug}</span> till{' '}
                        {new Date(sub.expires_at).toLocaleDateString('en-IN')}
                      </>
                    )}
                    {featured && <span className="ml-2 rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-bold text-gold-700">FEATURED</span>}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <form action={setProfileVerified}>
                    <input type="hidden" name="user_id" value={p.id} />
                    <input type="hidden" name="verify" value={mp?.verified_at ? 'false' : 'true'} />
                    <button type="submit" className="rounded-full border border-emerald-300 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50">
                      {mp?.verified_at ? 'Unverify' : 'Verify'}
                    </button>
                  </form>
                  <form action={setFeatured}>
                    <input type="hidden" name="user_id" value={p.id} />
                    <input type="hidden" name="feature" value={featured ? 'false' : 'true'} />
                    <input type="hidden" name="position" value="100" />
                    <button type="submit" className="rounded-full border border-gold-400 px-3.5 py-1.5 text-xs font-bold text-gold-700 hover:bg-gold-50">
                      <Star className="mr-1 inline h-3 w-3" />
                      {featured ? 'Un-feature' : 'Feature'}
                    </button>
                  </form>
                  <form action={setProfileSuspended}>
                    <input type="hidden" name="user_id" value={p.id} />
                    <input type="hidden" name="suspend" value={mp?.status === 'suspended' ? 'false' : 'true'} />
                    <button type="submit" className="rounded-full border border-brand-300 px-3.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50">
                      <Ban className="mr-1 inline h-3 w-3" />
                      {mp?.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </form>
                </div>
              </div>
            </li>
          )
        })}
        {(rows ?? []).length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            No members match that search.
          </li>
        )}
      </ul>

      <p className="flex items-center gap-2 text-xs text-stone-400">
        <Rocket className="h-3.5 w-3.5" /> Membership changes happen in Payments (manual activate /
        refund); here you manage visibility, verification and featuring.
      </p>
    </div>
  )
}
