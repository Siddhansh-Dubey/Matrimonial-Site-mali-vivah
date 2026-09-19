import Link from 'next/link'
import { BadgeCheck, Ban, ChevronLeft, ChevronRight, EyeOff, Rocket, Search, Star } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import {
  PROFILE_STATUS_FILTERS,
  PROFILE_STATUS_LABELS,
  fmtDate,
  statusBadgeClass,
  type AdminMemberList,
} from '@/lib/admin/members'
import { AdminNotice } from '@/components/admin/notice'
import { ConfirmButton } from '@/components/admin/confirm-button'
import {
  adminGrantBoost,
  manualActivate,
  setFeatured,
  setProfileHidden,
  setProfileSuspended,
  setProfileVerified,
} from '@/app/admin/actions'

export const metadata = { title: 'Admin · Members' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type Filters = {
  q: string
  status: string
  paid: string
  verified: string
  featured: string
  city: string
  package: string
  page: number
}

type Props = { searchParams?: Record<string, string | string[] | undefined> }

const pick = (sp: Props['searchParams'], key: string) => {
  const v = sp?.[key]
  return ((Array.isArray(v) ? v[0] : v) ?? '').trim()
}

const allow = (value: string, allowed: readonly string[]) => (allowed.includes(value) ? value : '')

/** Query string for the current filters (used for paging + return_to). */
function qs(f: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...f, ...overrides }
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(merged)) {
    if (k === 'page') {
      if (Number(v) > 1) params.set('page', String(v))
      continue
    }
    if (v) params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/**
 * Members list — every filter is a parameter of ONE server-side query
 * (admin_list_members RPC, paged), so the browser never receives more than
 * a page. Row actions are the existing ones (Mark paid / Extend, Verify,
 * Feature, Suspend) plus Hide and Boost; everything else — approve, edit,
 * reactivate, delete — lives on the member detail page.
 */
export default async function AdminMembersPage({ searchParams }: Props) {
  const { admin, userId } = await requireAdminPage()

  const filters: Filters = {
    q: pick(searchParams, 'q').slice(0, 120),
    status: allow(
      pick(searchParams, 'status'),
      PROFILE_STATUS_FILTERS.map((s) => s.value)
    ),
    paid: allow(pick(searchParams, 'paid'), ['', 'paid', 'free', 'expired']),
    verified: allow(pick(searchParams, 'verified'), ['', 'verified', 'unverified']),
    featured: allow(pick(searchParams, 'featured'), ['', 'featured', 'not_featured']),
    city: pick(searchParams, 'city').slice(0, 80),
    package: pick(searchParams, 'package').slice(0, 80),
    page: Math.max(1, Number.parseInt(pick(searchParams, 'page') || '1', 10) || 1),
  }
  const ok = pick(searchParams, 'ok')
  const error = pick(searchParams, 'error')

  const [listRes, pkgRes] = await Promise.all([
    admin.rpc('admin_list_members', {
      p_q: filters.q || null,
      p_status: filters.status || null,
      p_paid: filters.paid || null,
      p_verified: filters.verified || null,
      p_featured: filters.featured || null,
      p_city: filters.city || null,
      p_package: filters.package || null,
      p_limit: PAGE_SIZE,
      p_offset: (filters.page - 1) * PAGE_SIZE,
    }),
    admin.from('packages').select('id, name, slug, duration_days').eq('is_active', true).order('sort_order'),
  ])

  const list = (listRes.data as unknown as AdminMemberList | null) ?? { total: 0, limit: PAGE_SIZE, offset: 0, rows: [] }
  const rows = list.rows ?? []
  const packages = pkgRes.data ?? []
  const totalPages = Math.max(1, Math.ceil((list.total ?? 0) / PAGE_SIZE))
  const returnTo = `/admin/members${qs(filters)}`

  const anyFilter =
    filters.status || filters.paid || filters.verified || filters.featured || filters.city || filters.package

  const inputCls =
    'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-900">Members</h1>
        <p className="mt-1 text-sm text-stone-500">
          Search and manage member profiles. Filters run in the database; open a member for the full
          account, membership and visibility picture.
        </p>
      </div>

      <AdminNotice ok={ok} error={listRes.error ? `Could not load members: ${listRes.error.message}` : error} />

      <form action="/admin/members" method="get" className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Name, email, mobile or UUID…"
              className={`${inputCls} pl-9`}
            />
          </label>
          <button type="submit" className="rounded-xl bg-maroon px-5 py-2 text-sm font-bold text-white">
            Search
          </button>
        </div>
        <details className="mt-3" open={Boolean(anyFilter)}>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-stone-500">
            Filters{anyFilter ? ' · active' : ''}
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs font-semibold text-stone-500">
              Profile status
              <select name="status" defaultValue={filters.status} className={`${inputCls} mt-1`}>
                {PROFILE_STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              Membership
              <select name="paid" defaultValue={filters.paid} className={`${inputCls} mt-1`}>
                <option value="">Paid or free</option>
                <option value="paid">Paid (live plan)</option>
                <option value="free">Free (never paid)</option>
                <option value="expired">Expired (paid before)</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              Live package
              <select name="package" defaultValue={filters.package} className={`${inputCls} mt-1`}>
                <option value="">Any package</option>
                {packages.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              Verification
              <select name="verified" defaultValue={filters.verified} className={`${inputCls} mt-1`}>
                <option value="">Any</option>
                <option value="verified">Verified badge</option>
                <option value="unverified">Not verified</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              Featured
              <select name="featured" defaultValue={filters.featured} className={`${inputCls} mt-1`}>
                <option value="">Any</option>
                <option value="featured">Featured</option>
                <option value="not_featured">Not featured</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              City
              <input name="city" defaultValue={filters.city} placeholder="e.g. Pune" className={`${inputCls} mt-1`} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className="rounded-full bg-stone-900 px-4 py-1.5 text-xs font-bold text-white">
              Apply filters
            </button>
            <Link
              href="/admin/members"
              className="rounded-full border border-stone-300 px-4 py-1.5 text-xs font-bold text-stone-600 hover:border-maroon"
            >
              Clear
            </Link>
          </div>
        </details>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span>
          {list.total ?? 0} member{(list.total ?? 0) === 1 ? '' : 's'}
          {anyFilter || filters.q ? ' match' : ''} · page {filters.page} of {totalPages}
        </span>
        <span className="flex items-center gap-1">
          {filters.page > 1 ? (
            <Link
              href={`/admin/members${qs(filters, { page: filters.page - 1 })}`}
              className="inline-flex items-center gap-1 rounded-full border border-stone-300 px-3 py-1 font-bold text-stone-700 hover:border-maroon"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Link>
          ) : null}
          {filters.page < totalPages ? (
            <Link
              href={`/admin/members${qs(filters, { page: filters.page + 1 })}`}
              className="inline-flex items-center gap-1 rounded-full border border-stone-300 px-3 py-1 font-bold text-stone-700 hover:border-maroon"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </span>
      </div>

      <ul className="space-y-3">
        {rows.map((p) => {
          const isSelf = p.id === userId
          const suspended = p.status === 'suspended'
          const onHold = Boolean(p.admin_hidden_at)
          return (
            <li key={p.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-stone-900">
                    <Link href={`/admin/members/${p.id}`} className="truncate hover:text-maroon hover:underline">
                      {p.full_name}
                    </Link>
                    {p.is_admin && (
                      <span className="rounded-full bg-gold-300 px-2 py-0.5 text-[10px] font-bold text-maroon-deep">
                        ADMIN
                      </span>
                    )}
                    {p.verified_at && <BadgeCheck className="inline h-4 w-4 text-emerald-600" aria-label="Verified" />}
                  </p>
                  <p className="break-all text-xs text-stone-500">
                    {p.email} · {p.mobile ?? 'no mobile'} · joined {fmtDate(p.created_at)}
                    {p.age ? ` · ${p.age} yrs` : ''}
                    {p.gender ? ` · ${p.gender}` : ''}
                    {p.city ? ` · ${p.city}` : ''}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`rounded-full border px-2 py-0.5 font-bold ${statusBadgeClass(p.status)}`}>
                      {p.status ? PROFILE_STATUS_LABELS[p.status] : 'no profile'}
                    </span>
                    {p.is_paid ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800">
                        {p.package_slug} · till {fmtDate(p.expires_at)}
                      </span>
                    ) : (
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 font-bold text-stone-600">
                        {p.ever_subscribed ? 'plan expired' : 'free'}
                      </span>
                    )}
                    {onHold && (
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-bold text-violet-800">
                        ADMIN HOLD
                      </span>
                    )}
                    {p.featured && (
                      <span className="rounded-full bg-gold-100 px-2 py-0.5 font-bold text-gold-700">FEATURED</span>
                    )}
                    {p.boosted && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-800">BOOSTED</span>
                    )}
                    {!p.is_active && (
                      <span className="rounded-full bg-stone-200 px-2 py-0.5 font-bold text-stone-700">ACCOUNT OFF</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Link
                    href={`/admin/members/${p.id}`}
                    className="rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-maroon"
                  >
                    Manage →
                  </Link>
                  {packages.length > 0 && p.status && (
                    <form
                      action={manualActivate}
                      className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50/50 p-1"
                      title="Grant a paid membership through activate_membership (renewals stack)"
                    >
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <select
                        name="package_id"
                        aria-label={`Package for ${p.full_name}`}
                        className="max-w-[9rem] rounded-full border-0 bg-transparent py-0.5 pl-2 pr-1 text-xs font-semibold text-emerald-800 focus:outline-none"
                      >
                        {packages.map((pk) => (
                          <option key={pk.id} value={pk.id}>
                            {pk.name}
                          </option>
                        ))}
                      </select>
                      <ConfirmButton
                        message={`Activate a paid membership for ${p.full_name} without a payment? This is recorded in the audit log.`}
                        className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        {p.is_paid ? 'Extend' : 'Mark paid'}
                      </ConfirmButton>
                    </form>
                  )}
                  {p.status && (
                    <form action={setProfileVerified}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input type="hidden" name="verify" value={p.verified_at ? 'false' : 'true'} />
                      <button
                        type="submit"
                        className="rounded-full border border-emerald-300 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                      >
                        {p.verified_at ? 'Unverify' : 'Verify'}
                      </button>
                    </form>
                  )}
                  {p.status && (
                    <form action={setFeatured}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input type="hidden" name="feature" value={p.featured ? 'false' : 'true'} />
                      <input type="hidden" name="position" value="100" />
                      <button
                        type="submit"
                        className="rounded-full border border-gold-400 px-3.5 py-1.5 text-xs font-bold text-gold-700 hover:bg-gold-50"
                      >
                        <Star className="mr-1 inline h-3 w-3" />
                        {p.featured ? 'Un-feature' : 'Feature'}
                      </button>
                    </form>
                  )}
                  {p.status && !isSelf && (
                    <form action={setProfileHidden}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input type="hidden" name="hide" value={onHold ? 'false' : 'true'} />
                      <ConfirmButton
                        message={
                          onHold
                            ? `Lift the admin hold on ${p.full_name}? Visibility then follows their real status and membership.`
                            : `Hide ${p.full_name} from Browse, Search, matches and featured? Status, membership and payments stay untouched.`
                        }
                        className="rounded-full border border-violet-300 px-3.5 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-50"
                      >
                        <EyeOff className="mr-1 inline h-3 w-3" />
                        {onHold ? 'Unhide' : 'Hide'}
                      </ConfirmButton>
                    </form>
                  )}
                  {p.status && !isSelf && (
                    <form action={setProfileSuspended}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <input type="hidden" name="suspend" value={suspended ? 'false' : 'true'} />
                      <ConfirmButton
                        message={
                          suspended
                            ? `Unsuspend ${p.full_name}? Their status is restored from their actual membership (paid → active, free → hidden, lapsed → expired).`
                            : `Suspend ${p.full_name}? The profile disappears from search, recommendations, Daily 5 and featured; interest is paused. Membership data is kept.`
                        }
                        className="rounded-full border border-brand-300 px-3.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
                      >
                        <Ban className="mr-1 inline h-3 w-3" />
                        {suspended ? 'Unsuspend' : 'Suspend'}
                      </ConfirmButton>
                    </form>
                  )}
                  {p.status && !p.boosted && (
                    <form action={adminGrantBoost}>
                      <input type="hidden" name="user_id" value={p.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <ConfirmButton
                        message={`Grant ${p.full_name} a support boost for the configured duration (no payment, not counted against their plan)?`}
                        className="rounded-full border border-sky-300 px-3.5 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-50"
                      >
                        <Rocket className="mr-1 inline h-3 w-3" />
                        Boost
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              </div>
            </li>
          )
        })}
        {rows.length === 0 && !listRes.error && (
          <li className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            No members match that search.
          </li>
        )}
      </ul>

      <p className="flex items-center gap-2 text-xs text-stone-400">
        <Rocket className="h-3.5 w-3.5" /> Mark paid uses the same activation machinery as Razorpay
        (it never un-suspends). Approve, edit, reactivate and delete live on the member page.
      </p>
    </div>
  )
}
