import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Download,
  GraduationCap,
  Heart,
  Lock,
  MapPin,
  Phone,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
import { MASK_BLUR_CLASS, maskPhone } from '@/lib/profile/mask'
import { getProfileVisibility } from '@/lib/profile/visibility'
import { ProfileActions } from '@/components/profile/profile-actions'
import type { PublicProfileCard } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Profile' }
export const dynamic = 'force-dynamic'

export default async function PublicProfilePage({ params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The detail page is also a safe public preview. Logged-out visitors can
  // follow a card from /brides or /grooms, but they still see the same masked
  // free-view fields and cannot record a profile view or take member actions.
  const { data } = await supabase.rpc('get_public_profile', { p_user_id: params.id })
  const profile = data as PublicProfileCard | null
  if (!profile) notFound()

  // Visibility verdict — prefers the v2 RPC flags, falls back to live checks
  // when the packages migration has not been applied yet.
  const visibility = user
    ? await getProfileVisibility(supabase, user.id, params.id, {
        rpcPaid: profile.viewer_is_paid,
        rpcMutual: profile.mutual_interest,
        rpcContact: profile.contact_phone,
      })
    : {
        isPaid: false,
        mutual: false,
        canSeeDetails: false,
        canSeePhone: false,
        phone: null,
      }
  const { isPaid, mutual, canSeeDetails, canSeePhone, phone } = visibility

  // Record the view (best effort — never block the page).
  if (user) {
    await supabase.from('profile_views').insert({ viewer_id: user.id, viewed_id: params.id })
  }

  const photos = (profile.photos ?? []).map(photoUrl).filter((p): p is string => Boolean(p))
  const displayName = canSeeDetails && profile.name_full ? profile.name_full : profile.name
  const backHref = profile.gender === 'male' ? '/grooms' : profile.gender === 'female' ? '/brides' : '/search'

  return (
    <section className="bg-cream">
      <div className="container-page py-8 sm:py-12">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-maroon hover:text-maroon-dark"
        >
          <ArrowLeft className="h-4 w-4" /> Back to browse
        </Link>

        {/* gating banner */}
        {!canSeeDetails && (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-gold-400/50 bg-gold-100/50 px-5 py-4 text-sm text-maroon-deep sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-2 font-bold">
              <Lock className="h-4 w-4" /> Free preview
            </span>
            <span className="text-maroon/80">
              Only the photo and occupation are visible.{' '}
              {user ? 'Purchase any package to unlock every detail.' : 'Register to explore more matches.'}
            </span>
            <Link
              href={user ? '/packages' : '/register'}
              className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-5 py-2 text-xs font-bold text-white hover:bg-maroon-dark sm:ml-auto"
            >
              {user ? 'View packages' : 'Register free'}
            </Link>
          </div>
        )}
        {canSeeDetails && !canSeePhone && (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-900 sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-2 font-bold">
              <Phone className="h-4 w-4" /> Phone number locked
            </span>
            <span>
              {mutual
                ? 'Mutual interest confirmed — the phone number will appear below.'
                : 'The phone number is revealed only after both sides express interest in each other.'}
            </span>
          </div>
        )}
        {canSeePhone && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-900">
            <Heart className="h-4 w-4 fill-current" />
            It&apos;s a mutual match — contact details are now visible below.
          </div>
        )}

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          {/* photos — ALWAYS visible */}
          <div>
            <div className="overflow-hidden rounded-[26px] bg-brand-50 ring-1 ring-stone-100">
              {photos.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photos[0]}
                  alt={`${displayName} photograph`}
                  className="aspect-[4/3] w-full object-cover object-top"
                />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center">
                  <span className="font-display text-7xl font-bold text-brand-200">
                    {displayName.charAt(0)}
                  </span>
                </div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {photos.slice(1).map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={p}
                    src={p}
                    alt=""
                    className="aspect-square w-full rounded-xl object-cover ring-1 ring-stone-200"
                  />
                ))}
              </div>
            )}

            {/* family photo — paid viewers only (the RPC returns null otherwise) */}
            {canSeeDetails && profile.family_photo && (
              <div className="mt-4">
                <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <Users className="h-3.5 w-3.5" /> Family photo
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(profile.family_photo) ?? ''}
                  alt="Family photograph"
                  className="w-full rounded-2xl object-cover ring-1 ring-stone-200"
                />
              </div>
            )}
          </div>

          {/* details */}
          <div className="card h-fit p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 font-display text-3xl font-bold text-maroon">
                  <span className="truncate">{displayName}</span>
                  {profile.verified && (
                    <BadgeCheck className="h-6 w-6 shrink-0 text-emerald-600" aria-label="Verified profile" />
                  )}
                </h1>
                {canSeeDetails ? (
                  <p className="mt-1 text-sm text-stone-600">
                    {profile.age != null ? `${profile.age} years` : ''}
                    {profile.height_cm ? ` · ${profile.height_cm} cm` : ''}
                  </p>
                ) : (
                  <p className={`mt-1 text-sm text-stone-600 ${MASK_BLUR_CLASS}`} aria-hidden>
                    27 years · 165 cm
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-gold-300 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-maroon-deep">
                {canSeeDetails ? (profile.sub_community ?? 'Mali') : 'Mali'}
              </span>
            </div>

            {canSeeDetails ? (
              <dl className="mt-6 space-y-3 text-sm">
                <Item
                  icon={MapPin}
                  label="Location"
                  value={[profile.city, profile.state].filter(Boolean).join(', ') || '—'}
                />
                {profile.native_place && (
                  <Item icon={MapPin} label="Native place" value={profile.native_place} />
                )}
                <Item icon={GraduationCap} label="Education" value={profile.education ?? '—'} />
                {profile.education_details && (
                  <Item icon={GraduationCap} label="Details" value={profile.education_details} />
                )}
                <Item icon={Briefcase} label="Occupation" value={profile.occupation ?? '—'} />
                {profile.company && <Item icon={Briefcase} label="Company" value={profile.company} />}
                {profile.annual_income && (
                  <Item icon={Briefcase} label="Annual income" value={profile.annual_income} />
                )}
                <Item icon={Briefcase} label="Smoking" value={label(profile.smoking ?? 'never')} />
                <Item icon={Briefcase} label="Drinking" value={label(profile.drinking ?? 'never')} />
                <Item icon={Heart} label="Marital status" value={label(profile.marital_status ?? 'never_married')} />
                <Item icon={UserIcon} label="Diet" value={label(profile.diet ?? 'vegetarian')} />
                <Item icon={UserIcon} label="Mother tongue" value={profile.mother_tongue ?? 'Marathi'} />
                {profile.gotra && <Item icon={UserIcon} label="Gotra" value={profile.gotra} />}
              </dl>
            ) : (
              <dl className="mt-6 space-y-3 text-sm">
                {/* Occupation — the ONE detail a free viewer may see. */}
                <Item icon={Briefcase} label="Occupation" value={profile.occupation ?? '—'} />
                <LockedItem icon={MapPin} label="Location" fake="Pune, Maharashtra" />
                <LockedItem icon={GraduationCap} label="Education" fake="B.E. Computer" />
                <LockedItem icon={Heart} label="Marital status" fake="Never Married" />
                <LockedItem icon={UserIcon} label="Diet" fake="Vegetarian" />
              </dl>
            )}

            {canSeeDetails ? (
              profile.hobbies &&
              profile.hobbies.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Hobbies
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {profile.hobbies.map((h) => (
                      <span
                        key={h}
                        className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800"
                      >
                        {label(h)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Hobbies
                </p>
                <div className="mt-2 flex flex-wrap gap-2" aria-hidden>
                  {['Reading', 'Music', 'Travel'].map((h) => (
                    <span
                      key={h}
                      className={`rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-500 ${MASK_BLUR_CLASS}`}
                    >
                      {h}
                    </span>
                  ))}
                  <Lock className="h-4 w-4 self-center text-stone-400" />
                </div>
              </div>
            )}

            {/* family section — paid viewers, honoring member privacy settings */}
            {canSeeDetails &&
              (profile.father_occupation ||
                profile.mother_occupation ||
                profile.siblings ||
                profile.family_type ||
                profile.family_location ||
                profile.family_details) && (
                <div className="mt-6">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <Users className="h-3.5 w-3.5" /> Family
                  </p>
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                    {profile.father_occupation && <Row label="Father" value={profile.father_occupation} />}
                    {profile.mother_occupation && <Row label="Mother" value={profile.mother_occupation} />}
                    {profile.siblings && <Row label="Siblings" value={profile.siblings} />}
                    {profile.family_type && <Row label="Family type" value={label(profile.family_type)} />}
                    {profile.family_location && <Row label="Family lives in" value={profile.family_location} />}
                  </dl>
                  {profile.family_details && (
                    <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{profile.family_details}</p>
                  )}
                </div>
              )}

            {/* phone — paid + mutual only */}
            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <Phone className="h-3.5 w-3.5" /> Phone number
              </p>
              {canSeePhone && phone ? (
                <a
                  href={`tel:${phone.replace(/\D/g, '')}`}
                  className="mt-1 block font-display text-xl font-bold tracking-wide text-maroon"
                >
                  {phone}
                </a>
              ) : (
                <p className="mt-1 flex items-center gap-2">
                  <span className={`font-display text-xl font-bold tracking-wide text-stone-400 ${MASK_BLUR_CLASS}`} aria-hidden>
                    {maskPhone(phone ?? '9876543210')}
                  </span>
                  <Lock className="h-4 w-4 text-stone-400" />
                </p>
              )}
              <p className="mt-1 text-xs text-stone-500">
                {!isPaid
                  ? 'Purchase any package, then express mutual interest to reveal the number.'
                  : !mutual
                    ? 'Revealed only after both sides express interest in each other.'
                    : 'Visible because interest is mutual.'}
              </p>
            </div>

            {/* biodata PDF — same gate as the phone number: paid + mutual interest */}
            {canSeePhone && (
              <a
                href={`/api/biodata/${profile.id}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-maroon px-4 py-3 text-sm font-bold text-white shadow-lg shadow-maroon/20 hover:bg-maroon-dark"
              >
                <Download className="h-4 w-4" /> Download biodata (PDF)
              </a>
            )}

            <div className="mt-7 border-t border-stone-100 pt-6">
              {user ? (
                profile.id === user.id ? (
                  <div className="rounded-2xl bg-brand-50 px-4 py-4 text-center">
                    <p className="text-sm font-semibold text-maroon">This is your published profile.</p>
                    <Link href="/profile/edit" className="btn-primary mt-3">
                      Edit your profile
                    </Link>
                  </div>
                ) : (
                  <ProfileActions profileId={profile.id} />
                )
              ) : (
                <div className="rounded-2xl bg-brand-50 px-4 py-4 text-center">
                  <p className="text-sm font-semibold text-maroon">Want to connect with this profile?</p>
                  <Link href="/register" className="btn-primary mt-3">
                    Register free
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {canSeeDetails ? (
          profile.about_me && (
            <div className="card mx-auto mt-8 max-w-3xl p-6 sm:p-8">
              <h2 className="font-display text-xl font-bold text-maroon">About</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-stone-600">
                {profile.about_me}
              </p>
            </div>
          )
        ) : (
          <div className="card mx-auto mt-8 max-w-3xl p-6 sm:p-8">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-maroon">
              About <Lock className="h-4 w-4 text-stone-400" />
            </h2>
            <p className={`mt-3 text-sm leading-relaxed text-stone-600 ${MASK_BLUR_CLASS}`} aria-hidden>
              This member&apos;s introduction is hidden for free accounts. Purchase any package
              to read the full introduction, hobbies and lifestyle details.
            </p>
            <Link href="/packages" className="btn-primary mt-5">
              Unlock with a package
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}

function Item({ icon: Icon, label, value }: { icon: typeof Heart; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-stone-400">{label}</dt>
        <dd className="font-medium text-stone-800">{value}</dd>
      </div>
    </div>
  )
}

function LockedItem({ icon: Icon, label, fake }: { icon: typeof Heart; label: string; fake: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-stone-400">{label}</dt>
        <dd className="flex items-center gap-1.5 font-medium text-stone-800">
          <span className={MASK_BLUR_CLASS} aria-hidden>
            {fake}
          </span>
          <Lock className="h-3 w-3 text-stone-400" />
        </dd>
      </div>
    </div>
  )
}

function label(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function Row({ label: lbl, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-stone-400">{lbl}</dt>
      <dd className="font-medium text-stone-800">{value}</dd>
    </div>
  )
}
