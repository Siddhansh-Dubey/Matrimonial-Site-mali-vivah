import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Ban,
  CreditCard,
  Eye,
  EyeOff,
  Heart,
  Images,
  Pencil,
  Rocket,
  ShieldAlert,
  Star,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { loadMemberDetail } from '@/lib/admin/member-detail'
import {
  PROFILE_STATUS_LABELS,
  VISIBILITY_REASON_LABELS,
  fmtDate,
  label,
  statusBadgeClass,
} from '@/lib/admin/members'
import { ageFromDate } from '@/lib/profile/profile-schema'
import { photoUrl } from '@/lib/profile/photos'
import { AdminNotice } from '@/components/admin/notice'
import { ConfirmButton } from '@/components/admin/confirm-button'
import {
  adminDeleteMember,
  adminGrantBoost,
  adminRemovePhoto,
  approveMemberProfile,
  manualActivate,
  reactivateMember,
  rejectMemberProfile,
  setFeatured,
  setProfileHidden,
  setProfileSuspended,
  setProfileVerified,
} from '@/app/admin/actions'

export const metadata = { title: 'Admin · Member' }
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Props = { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }

function Card({ title, icon, children, tone = 'default' }: { title: string; icon: ReactNode; children: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <section
      className={`rounded-2xl border bg-white p-5 ${tone === 'danger' ? 'border-brand-300' : 'border-stone-200'}`}
    >
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-stone-900">
        {icon} {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-400">{k}</dt>
      <dd className="min-w-0 break-words text-sm text-stone-800">{v ?? '—'}</dd>
    </div>
  )
}

const btn = (tone: 'neutral' | 'green' | 'red' | 'violet' | 'gold' | 'sky' | 'dark') =>
  ({
    neutral: 'rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-bold text-stone-700 hover:border-maroon',
    green: 'rounded-full border border-emerald-300 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50',
    red: 'rounded-full border border-brand-300 px-3.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50',
    violet: 'rounded-full border border-violet-300 px-3.5 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-50',
    gold: 'rounded-full border border-gold-400 px-3.5 py-1.5 text-xs font-bold text-gold-700 hover:bg-gold-50',
    sky: 'rounded-full border border-sky-300 px-3.5 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-50',
    dark: 'rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-maroon',
  })[tone]

const input =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30'

/**
 * Member detail — ACCOUNT · VISIBILITY & ACTIONS · PROFILE · FAMILY · PHOTOS ·
 * MEMBERSHIP · VERIFICATION · ENGAGEMENT · PREFERENCES · ADMIN HISTORY ·
 * DANGER ZONE. Every fact comes from the database (admin_member_state +
 * table reads); every button is a server action that re-checks admin rights.
 */
export default async function AdminMemberPage({ params, searchParams }: Props) {
  const { admin, userId: adminId } = await requireAdminPage()
  if (!UUID_RE.test(params.id)) notFound()
  const d = await loadMemberDetail(admin, params.id)
  if (!d) notFound()

  const pick = (key: string) => {
    const v = searchParams?.[key]
    return ((Array.isArray(v) ? v[0] : v) ?? '').trim()
  }
  const ok = pick('ok')
  const error = pick('error')

  const { person, profile, prefs, state, counts } = d
  const isSelf = person.id === adminId
  const status = profile?.status ?? null
  const suspended = status === 'suspended'
  const onHold = Boolean(profile?.admin_hidden_at)
  const isPublic = state?.is_public === true
  const live = state?.live_membership === true
  const returnTo = `/admin/members/${person.id}`
  const canApprove = status === 'draft' || status === 'pending_review' || status === 'rejected'
  const canReject = Boolean(status) && !suspended && status !== 'rejected'
  const canReactivate = Boolean(status) && (suspended || onHold || (live && (status === 'hidden' || status === 'expired')))
  const { data: packages } = await admin
    .from('packages')
    .select('id, name, slug, duration_days')
    .eq('is_active', true)
    .order('sort_order')

  const profilePhotos = d.photos.filter((p) => p.kind === 'profile_photo')
  const familyPhoto = d.photos.find((p) => p.kind === 'family_photo') ?? null
  const privacy = (profile?.privacy_settings ?? {}) as Record<string, unknown>
  const privacyOff = ['show_about', 'show_family_details', 'show_family_photo', 'show_income'].filter(
    (k) => privacy[k] === false
  )

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/members" className="inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> All members
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold text-stone-900">
              <span className="break-words">{person.full_name}</span>
              {person.is_admin && (
                <span className="rounded-full bg-gold-300 px-2 py-0.5 text-[10px] font-bold text-maroon-deep">ADMIN</span>
              )}
              {profile?.verified_at && <BadgeCheck className="h-5 w-5 text-emerald-600" aria-label="Verified" />}
              {isSelf && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-700">YOU</span>}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded-full border px-2 py-0.5 font-bold ${statusBadgeClass(status)}`}>
                {status ? PROFILE_STATUS_LABELS[status] : 'no matrimony profile'}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-bold ${
                  isPublic ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-stone-50 text-stone-600'
                }`}
              >
                {isPublic ? 'PUBLIC NOW' : 'NOT PUBLIC'}
              </span>
              {onHold && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-bold text-violet-800">ADMIN HOLD</span>}
              {live ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800">
                  {state?.membership.package_slug} · {state?.membership.days_left} days left
                </span>
              ) : (
                <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 font-bold text-stone-600">
                  {state?.ever_subscribed ? 'membership expired' : 'free member'}
                </span>
              )}
              {d.featured && <span className="rounded-full bg-gold-100 px-2 py-0.5 font-bold text-gold-700">FEATURED</span>}
              {d.boost && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-800">BOOSTED till {fmtDate(d.boost.expires_at)}</span>}
            </p>
            <p className="mt-1 font-mono text-[11px] text-stone-400">{person.id}</p>
          </div>
          {profile && (
            <Link href={`/admin/members/${person.id}/edit`} className={`${btn('dark')} inline-flex shrink-0 items-center gap-1.5`}>
              <Pencil className="h-3.5 w-3.5" /> Edit profile
            </Link>
          )}
        </div>
      </div>

      <AdminNotice ok={ok} error={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ACCOUNT */}
        <Card title="Account" icon={<User className="h-4 w-4 text-maroon" />}>
          <dl className="divide-y divide-stone-100">
            <Row k="Email" v={<>{person.email} {person.email_verified ? <span className="text-emerald-700">· verified</span> : <span className="text-stone-400">· unverified</span>}</>} />
            <Row k="Mobile" v={<>{person.mobile ?? '—'} {person.mobile_verified ? <span className="text-emerald-700">· OTP verified</span> : <span className="text-stone-400">· not verified</span>}</>} />
            <Row k="Profile for" v={label(person.for_whom)} />
            <Row k="Joined" v={fmtDate(person.created_at, true)} />
            <Row k="Last login" v={`${fmtDate(person.last_login_at, true)} · ${person.login_count} logins`} />
            <Row k="Account switch" v={person.is_active ? 'Active' : 'Deactivated (profiles.is_active = false)'} />
            <Row k="Role" v={person.is_admin ? 'Administrator (managed in the database)' : 'Member'} />
          </dl>
        </Card>

        {/* VISIBILITY + ACTIONS */}
        <Card title="Visibility & state" icon={isPublic ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4 text-maroon" />}>
          {!profile || !state ? (
            <p className="text-sm text-stone-500">This account has no matrimony profile yet.</p>
          ) : (
            <>
              <dl className="divide-y divide-stone-100">
                <Row k="Profile status" v={PROFILE_STATUS_LABELS[state.status]} />
                <Row k="Public now" v={isPublic ? 'Yes — discoverable in Browse, Search, Daily 5 and featured' : 'No'} />
                <Row
                  k="Why"
                  v={
                    <>
                      <span className="font-semibold">{VISIBILITY_REASON_LABELS[state.visibility.reason] ?? state.visibility.reason}</span>
                      <span className="block text-xs text-stone-500">{state.visibility.headline} — {state.visibility.detail}</span>
                    </>
                  }
                />
                {state.missing.length > 0 && <Row k="Missing" v={state.missing.join(', ')} />}
                <Row k="Membership truth" v={live ? `Live plan (${state.membership.package_slug}) till ${fmtDate(state.membership.expires_at)}` : state.ever_subscribed ? 'Lapsed — paid before' : 'Never paid'} />
                {onHold && (
                  <Row
                    k="Admin hold"
                    v={<>Since {fmtDate(profile.admin_hidden_at, true)}{profile.admin_hidden_reason ? <span className="block text-xs text-stone-500">Reason (internal): {profile.admin_hidden_reason}</span> : null}</>}
                  />
                )}
                {suspended && (
                  <Row
                    k="Suspension"
                    v={<>Since {fmtDate(profile.suspended_at, true)}{profile.status_before_suspension ? ` · was ${PROFILE_STATUS_LABELS[profile.status_before_suspension]}` : ''}{profile.suspension_reason ? <span className="block text-xs text-stone-500">Reason (internal): {profile.suspension_reason}</span> : null}</>}
                  />
                )}
                {privacyOff.length > 0 && <Row k="Member privacy" v={`Member hides: ${privacyOff.map((k) => k.replace('show_', '').replace(/_/g, ' ')).join(', ')} (their own setting)`} />}
              </dl>

              <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Actions</p>
                {isSelf && <p className="text-xs text-stone-500">Suspend, hide and delete are disabled for your own account.</p>}

                {canApprove && (
                  <form action={approveMemberProfile} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="user_id" value={person.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <ConfirmButton
                      message={`Approve this profile? It becomes ${live ? 'Active · paid (live membership found)' : 'Approved · free — visible only once the member pays'}. Approval never grants membership.`}
                      className={btn('green')}
                    >
                      Approve profile
                    </ConfirmButton>
                    <span className="text-xs text-stone-500">
                      {state.missing.length > 0 ? `Blocked until complete (${state.missing.join(', ')})` : live ? '→ Active · paid' : '→ Approved · free (hidden until paid)'}
                    </span>
                  </form>
                )}

                {canReject && !isSelf && (
                  <form action={rejectMemberProfile} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="hidden" name="user_id" value={person.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <input name="note" required maxLength={500} placeholder="What must the member fix? (sent to them)" className={`${input} sm:flex-1`} />
                    <ConfirmButton message="Send this profile back for changes? The member is notified with your note and the profile leaves the directory." className={btn('red')}>
                      Send back (reject)
                    </ConfirmButton>
                  </form>
                )}

                {!isSelf && (
                  <form action={setProfileSuspended} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="hidden" name="user_id" value={person.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <input type="hidden" name="suspend" value={suspended ? 'false' : 'true'} />
                    {!suspended && <input name="reason" maxLength={300} placeholder="Reason (internal, optional)" className={`${input} sm:flex-1`} />}
                    <ConfirmButton
                      message={
                        suspended
                          ? 'Unsuspend? The status is restored from the member’s ACTUAL membership: live plan → Active · paid, never paid → Approved · free, lapsed → Expired, never published → Draft.'
                          : 'Suspend this profile? It disappears from search, recommendations, Daily 5 and featured and interest is paused. Membership, payments and data are kept.'
                      }
                      className={btn('red')}
                    >
                      <Ban className="mr-1 inline h-3 w-3" />
                      {suspended ? 'Unsuspend' : 'Suspend'}
                    </ConfirmButton>
                  </form>
                )}

                {!isSelf && (
                  <form action={setProfileHidden} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="hidden" name="user_id" value={person.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <input type="hidden" name="hide" value={onHold ? 'false' : 'true'} />
                    {!onHold && <input name="reason" maxLength={300} placeholder="Reason for the hold (internal, optional)" className={`${input} sm:flex-1`} />}
                    <ConfirmButton
                      message={
                        onHold
                          ? 'Lift the admin hold? Visibility then follows the member’s real status and membership.'
                          : 'Place an admin hold? The profile is hidden everywhere while status, membership and payments stay exactly as they are (different from suspension).'
                      }
                      className={btn('violet')}
                    >
                      <EyeOff className="mr-1 inline h-3 w-3" />
                      {onHold ? 'Lift hold (unhide)' : 'Hide (admin hold)'}
                    </ConfirmButton>
                  </form>
                )}

                {canReactivate && (
                  <form action={reactivateMember} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="user_id" value={person.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <ConfirmButton
                      message="Reactivate? Lifts any hold / suspension and restores the status the member’s real membership implies — it never creates a subscription or publishes an incomplete profile."
                      className={btn('green')}
                    >
                      Reactivate (state-aware)
                    </ConfirmButton>
                    <span className="text-xs text-stone-500">
                      → {live ? (state.missing.length ? 'stays non-public: profile incomplete' : 'Active · paid') : state.ever_subscribed ? 'Expired (renewal required)' : 'Approved · free'}
                    </span>
                  </form>
                )}
                {!canReactivate && status === 'expired' && (
                  <p className="text-xs text-stone-500">Expired — cannot be reactivated into a paid state without a renewal (use Mark paid for a manual activation).</p>
                )}
                {!canReactivate && status === 'draft' && (
                  <p className="text-xs text-stone-500">Draft — the member must complete and publish; use Approve once the checklist is complete.</p>
                )}
              </div>
            </>
          )}
        </Card>

        {/* PROFILE */}
        <Card title="Profile" icon={<Heart className="h-4 w-4 text-maroon" />}>
          {!profile ? (
            <p className="text-sm text-stone-500">No matrimony profile.</p>
          ) : (
            <dl className="divide-y divide-stone-100">
              <Row k="Gender · age" v={`${label(profile.gender)} · ${ageFromDate(profile.date_of_birth) ?? '—'} yrs (${fmtDate(profile.date_of_birth)})`} />
              <Row k="Height" v={profile.height_cm ? `${profile.height_cm} cm` : '—'} />
              <Row k="Marital status" v={label(profile.marital_status)} />
              <Row k="Community" v={`${d.communityName ?? '—'} › ${d.subCommunityName ?? '—'}${profile.gotra ? ` · gotra ${profile.gotra}` : ''}`} />
              <Row k="Location" v={[profile.city, profile.state, profile.country].filter(Boolean).join(', ') || '—'} />
              <Row k="Native place" v={profile.native_place} />
              <Row k="Mother tongue" v={profile.mother_tongue} />
              <Row k="Education" v={`${profile.education ?? '—'}${profile.education_details ? ` · ${profile.education_details}` : ''}`} />
              <Row k="Occupation" v={profile.occupation} />
              <Row k="Company" v={profile.company} />
              <Row k="Business name" v={profile.business_name} />
              <Row k="Annual income" v={profile.annual_income} />
              <Row k="Diet · lifestyle" v={`${label(profile.diet)} · smoking ${profile.smoking} · drinking ${profile.drinking}`} />
              <Row k="Hobbies" v={profile.hobbies?.length ? profile.hobbies.join(', ') : '—'} />
              <Row k="About" v={profile.about_me} />
              <Row k="WhatsApp opt-in" v={profile.whatsapp_opt_in ? 'Yes' : 'No'} />
              <Row k="Updated" v={fmtDate(profile.updated_at, true)} />
            </dl>
          )}
        </Card>

        {/* FAMILY */}
        <Card title="Family" icon={<Users className="h-4 w-4 text-maroon" />}>
          {!profile ? (
            <p className="text-sm text-stone-500">No matrimony profile.</p>
          ) : (
            <dl className="divide-y divide-stone-100">
              <Row k="Father" v={profile.father_occupation} />
              <Row k="Mother" v={profile.mother_occupation} />
              <Row k="Siblings" v={profile.siblings} />
              <Row k="Family type" v={label(profile.family_type)} />
              <Row k="Family location" v={profile.family_location} />
              <Row k="Details" v={profile.family_details} />
              <Row k="Family photo" v={familyPhoto ? 'Uploaded' : 'Missing (required to be public)'} />
            </dl>
          )}
        </Card>

        {/* PHOTOS */}
        <Card title="Photos" icon={<Images className="h-4 w-4 text-maroon" />}>
          {d.photos.length === 0 ? (
            <p className="text-sm text-stone-500">No photos uploaded.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {d.photos.map((ph) => {
                const url = photoUrl(ph.storage_path)
                return (
                  <li key={ph.id} className="space-y-1">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="aspect-square w-full rounded-xl object-cover" />
                    ) : (
                      <div className="grid aspect-square w-full place-items-center rounded-xl bg-stone-100 text-[10px] text-stone-400">no preview</div>
                    )}
                    <p className="text-[10px] font-bold uppercase text-stone-500">
                      {ph.kind === 'family_photo' ? 'family' : ph.is_primary ? 'primary' : 'profile'}
                    </p>
                    <form action={adminRemovePhoto}>
                      <input type="hidden" name="user_id" value={person.id} />
                      <input type="hidden" name="photo_id" value={ph.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <ConfirmButton
                        message="Remove this photo? The member is notified; the profile may leave the directory until a replacement is uploaded."
                        className="text-[11px] font-bold text-brand-700 hover:underline"
                      >
                        Remove
                      </ConfirmButton>
                    </form>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-stone-400">Uploads happen through the member’s own profile wizard.</p>
        </Card>

        {/* MEMBERSHIP */}
        <Card title="Membership & payments" icon={<CreditCard className="h-4 w-4 text-maroon" />}>
          <dl className="divide-y divide-stone-100">
            <Row k="Current plan" v={live ? `${state?.membership.tier} · ${state?.membership.package_slug} · ${fmtDate(state?.membership.started_at)} → ${fmtDate(state?.membership.expires_at)} (${state?.membership.days_left} days left)` : state?.ever_subscribed ? 'None live — expired' : 'Free (never paid)'} />
            <Row
              k="Subscriptions"
              v={
                d.subscriptions.length === 0 ? '—' : (
                  <ul className="space-y-0.5 text-xs">
                    {d.subscriptions.map((s) => (
                      <li key={s.id}>
                        {s.package_slug ?? 'package'} · {s.status} · {fmtDate(s.started_at)} → {fmtDate(s.expires_at)}
                      </li>
                    ))}
                  </ul>
                )
              }
            />
            <Row
              k="Payments"
              v={
                d.payments.length === 0 ? '—' : (
                  <ul className="space-y-0.5 text-xs">
                    {d.payments.map((p) => (
                      <li key={p.id}>
                        ₹{p.amount_inr.toLocaleString('en-IN')} · {p.kind}{p.package_slug ? ` (${p.package_slug})` : ''} · {p.status} · {fmtDate(p.created_at, true)}
                      </li>
                    ))}
                  </ul>
                )
              }
            />
            <Row k="Boost" v={d.boost ? `Live till ${fmtDate(d.boost.expires_at, true)} (${d.boost.created_via ?? 'boost'})` : `None live · ${d.boostEntitlements} entitlement${d.boostEntitlements === 1 ? '' : 's'} so far`} />
          </dl>
          {profile && (
            <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
              {(packages ?? []).length > 0 && (
                <form action={manualActivate} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input type="hidden" name="user_id" value={person.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <select name="package_id" className={`${input} sm:w-56`} aria-label="Package">
                    {(packages ?? []).map((pk) => (
                      <option key={pk.id} value={pk.id}>
                        {pk.name} · {pk.duration_days}d
                      </option>
                    ))}
                  </select>
                  <input name="note" maxLength={200} placeholder="Note (e.g. cash receipt no.)" className={`${input} sm:flex-1`} />
                  <ConfirmButton
                    message={`Activate a paid membership without a payment? Uses activate_membership() exactly like Razorpay; renewals stack. ${suspended ? 'NOTE: the profile stays suspended until you unsuspend it.' : ''}`}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    {live ? 'Extend membership' : 'Mark paid'}
                  </ConfirmButton>
                </form>
              )}
              <form action={adminGrantBoost} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="user_id" value={person.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <ConfirmButton
                  message="Grant a support boost for the configured duration? No payment is attached and it is not counted against the member’s plan. Refused while a boost is live."
                  className={btn('sky')}
                  disabled={Boolean(d.boost)}
                >
                  <Rocket className="mr-1 inline h-3 w-3" />
                  {d.boost ? 'Boost already live' : 'Grant boost'}
                </ConfirmButton>
                <span className="text-xs text-stone-500">Duration comes from Admin → Boosts (profile_boost_config).</span>
              </form>
            </div>
          )}
        </Card>

        {/* VERIFICATION */}
        <Card title="Verification" icon={<BadgeCheck className="h-4 w-4 text-maroon" />}>
          <dl className="divide-y divide-stone-100">
            <Row k="Verified badge" v={profile?.verified_at ? `Yes · since ${fmtDate(profile.verified_at)}` : 'No'} />
            <Row k="Mobile OTP" v={person.mobile_verified ? 'Verified' : 'Not verified'} />
            <Row k="Email" v={person.email_verified ? 'Verified' : 'Not verified'} />
            <Row
              k="Requests"
              v={
                d.verifications.length === 0 ? '—' : (
                  <ul className="space-y-0.5 text-xs">
                    {d.verifications.map((v) => (
                      <li key={v.id}>
                        {label(v.type)} · {v.status} · {fmtDate(v.created_at)}{v.reviewed_at ? ` · reviewed ${fmtDate(v.reviewed_at)}` : ''}
                      </li>
                    ))}
                  </ul>
                )
              }
            />
          </dl>
          <p className="mt-2 text-xs text-stone-400">
            Documents are never shown here — review them in the{' '}
            <Link href="/admin/verification" className="font-semibold text-maroon hover:underline">verification queue</Link>.
            Verified ≠ paid ≠ public.
          </p>
          {profile && (
            <form action={setProfileVerified} className="mt-3">
              <input type="hidden" name="user_id" value={person.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <input type="hidden" name="verify" value={profile.verified_at ? 'false' : 'true'} />
              <button type="submit" className={btn('green')}>
                {profile.verified_at ? 'Remove verified badge' : 'Grant verified badge'}
              </button>
            </form>
          )}
        </Card>

        {/* ENGAGEMENT */}
        <Card title="Engagement" icon={<Activity className="h-4 w-4 text-maroon" />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ['Profile views received', counts.viewsReceived],
              ['Profiles viewed', counts.viewsMade],
              ['Interests sent', counts.interestsSent],
              ['Interests received', counts.interestsReceived],
              ['Mutual connections', counts.mutual],
              ['Messages sent', counts.messagesSent],
              ['Moments posted', counts.moments],
              ['Blocked others', counts.blocksBy],
              ['Blocked by others', counts.blocksOf],
              ['Reports against', counts.reportsAgainst],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-stone-50 px-3 py-2">
                <p className="font-display text-lg font-bold text-stone-900">{v}</p>
                <p className="text-[11px] text-stone-500">{k}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
            <span className="text-xs text-stone-500">
              Featured: {d.featured ? `yes · position ${d.featured.position}${isPublic ? '' : ' (not shown — profile not public)'}` : 'no'}
            </span>
            {profile && (
              <form action={setFeatured}>
                <input type="hidden" name="user_id" value={person.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <input type="hidden" name="feature" value={d.featured ? 'false' : 'true'} />
                <input type="hidden" name="position" value={d.featured?.position ?? 100} />
                <button type="submit" className={btn('gold')} title={!d.featured && !isPublic ? 'Only publicly visible profiles can be featured' : undefined}>
                  <Star className="mr-1 inline h-3 w-3" />
                  {d.featured ? 'Un-feature' : 'Feature on homepage'}
                </button>
              </form>
            )}
          </div>
          {d.activity.length > 0 && (
            <ul className="mt-3 divide-y divide-stone-100 text-xs">
              {d.activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="font-semibold text-stone-700">{a.event}</span>
                  <span className="text-stone-400">{fmtDate(a.created_at, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* PREFERENCES */}
        <Card title="Partner preferences" icon={<Heart className="h-4 w-4 text-maroon" />}>
          {!prefs ? (
            <p className="text-sm text-stone-500">Not set.</p>
          ) : (
            <dl className="divide-y divide-stone-100">
              <Row k="Looking for" v={`${label(prefs.preferred_gender)} · ${prefs.min_age}–${prefs.max_age} yrs${prefs.min_height_cm || prefs.max_height_cm ? ` · ${prefs.min_height_cm ?? '?'}–${prefs.max_height_cm ?? '?'} cm` : ''}`} />
              <Row k="Cities" v={prefs.preferred_cities?.length ? prefs.preferred_cities.join(', ') : 'Any'} />
              <Row k="Sub-communities" v={prefs.preferred_sub_communities?.length ? prefs.preferred_sub_communities.join(', ') : 'Any'} />
              <Row k="Education · occupation" v={`${prefs.preferred_education ?? 'Any'} · ${prefs.preferred_occupation ?? 'Any'}`} />
              <Row k="Income" v={prefs.preferred_income ?? 'Any'} />
              <Row k="Diet · marital" v={`${label(prefs.preferred_diet) === '—' ? 'Any' : label(prefs.preferred_diet)} · ${label(prefs.preferred_marital_status) === '—' ? 'Any' : label(prefs.preferred_marital_status)}`} />
              <Row k="Family type · native" v={`${prefs.preferred_family_type ?? 'Any'} · ${prefs.preferred_native_place ?? 'Any'}`} />
              <Row k="Note" v={prefs.note} />
            </dl>
          )}
        </Card>

        {/* ADMIN HISTORY */}
        <Card title="Admin history" icon={<ShieldAlert className="h-4 w-4 text-maroon" />}>
          {d.audit.length === 0 ? (
            <p className="text-sm text-stone-500">No admin actions recorded for this member.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-xs">
              {d.audit.map((a) => {
                const det = a.details ?? {}
                const reason = typeof det.reason === 'string' ? det.reason : typeof det.note === 'string' ? det.note : null
                const to = typeof det.to_status === 'string' ? det.to_status : null
                return (
                  <li key={a.id} className="py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-stone-800">{a.action}</span>
                      <span className="text-stone-400">{fmtDate(a.created_at, true)}</span>
                    </div>
                    <p className="text-stone-500">
                      by {a.admin_id ? a.admin_id.slice(0, 8) : 'unknown admin'}
                      {to ? ` · → ${to}` : ''}
                      {reason ? ` · ${reason}` : ''}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* DANGER ZONE */}
        <Card title="Danger zone" icon={<Trash2 className="h-4 w-4 text-brand-700" />} tone="danger">
          {isSelf ? (
            <p className="text-sm text-stone-600">You cannot delete your own admin account from here.</p>
          ) : person.is_admin ? (
            <p className="text-sm text-stone-600">
              This account is an administrator. Remove its admin rights in the database (profiles.is_admin) before it can be deleted — this protects against accidental loss of admin access.
            </p>
          ) : (
            <form action={adminDeleteMember} className="space-y-3">
              <input type="hidden" name="user_id" value={person.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <p className="text-sm text-stone-700">
                Permanently deletes the login, profile, photos, subscriptions, payments, interests, messages, moments, notifications, boosts and verification requests of <span className="font-semibold">{person.full_name}</span>. Storage files are wiped. <span className="font-semibold text-brand-700">This cannot be undone.</span> A minimal audit record (name, masked email, counts, reason) is kept.
              </p>
              <label className="block text-xs font-semibold text-stone-500">
                Type the member’s email to confirm
                <input name="confirm_email" required autoComplete="off" placeholder={person.email} className={`${input} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                Type DELETE
                <input name="confirm_phrase" required autoComplete="off" pattern="DELETE" placeholder="DELETE" className={`${input} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                Reason (kept in the audit log)
                <input name="reason" maxLength={300} placeholder="e.g. member requested deletion by email on 12 Sep" className={`${input} mt-1`} />
              </label>
              <ConfirmButton
                message={`Permanently delete ${person.full_name}? This cannot be undone.`}
                className="rounded-full bg-brand-700 px-5 py-2 text-xs font-bold text-white hover:bg-brand-800"
              >
                <Trash2 className="mr-1 inline h-3 w-3" /> Delete member permanently
              </ConfirmButton>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
