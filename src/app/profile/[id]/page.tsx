import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Briefcase, GraduationCap, Heart, MapPin, User as UserIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { photoUrl } from '@/lib/profile/photos'
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
  if (!user) redirect('/login')

  const { data } = await supabase.rpc('get_public_profile', { p_user_id: params.id })
  const profile = data as PublicProfileCard | null
  if (!profile) notFound()

  // Record the view (best effort — never block the page).
  await supabase.from('profile_views').insert({ viewer_id: user.id, viewed_id: params.id })

  const photos = (profile.photos ?? []).map(photoUrl).filter((p): p is string => Boolean(p))

  return (
    <section className="bg-cream">
      <div className="container-page py-8 sm:py-12">
        <Link href="/search" className="inline-flex items-center gap-1.5 text-sm font-semibold text-maroon hover:text-maroon-dark">
          <ArrowLeft className="h-4 w-4" /> Back to browse
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          {/* photos */}
          <div>
            <div className="overflow-hidden rounded-[26px] bg-brand-50 ring-1 ring-stone-100">
              {photos.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[0]} alt={`${profile.name} photograph`} className="aspect-[4/3] w-full object-cover object-top" />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center">
                  <span className="font-display text-7xl font-bold text-brand-200">{profile.name.charAt(0)}</span>
                </div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3">
                {photos.slice(1).map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={p} alt="" className="aspect-square w-full rounded-xl object-cover ring-1 ring-stone-200" />
                ))}
              </div>
            )}
          </div>

          {/* details */}
          <div className="card h-fit p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-bold text-maroon">{profile.name}</h1>
                <p className="mt-1 text-sm text-stone-600">
                  {profile.age != null ? `${profile.age} years` : ''}
                  {profile.height_cm ? ` · ${profile.height_cm} cm` : ''}
                </p>
              </div>
              <span className="rounded-full bg-gold-300 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-maroon-deep">
                {profile.sub_community ?? 'Mali'}
              </span>
            </div>

            <dl className="mt-6 space-y-3 text-sm">
              <Item icon={MapPin} label="Location" value={[profile.city, profile.state].filter(Boolean).join(', ')} />
              <Item icon={GraduationCap} label="Education" value={profile.education ?? '—'} />
              {profile.education_details && <Item icon={GraduationCap} label="Details" value={profile.education_details} />}
              <Item icon={Briefcase} label="Occupation" value={profile.occupation ?? '—'} />
              {profile.annual_income && <Item icon={Briefcase} label="Annual income" value={profile.annual_income} />}
              <Item icon={Heart} label="Marital status" value={label(profile.marital_status)} />
              <Item icon={UserIcon} label="Diet" value={label(profile.diet)} />
              <Item icon={UserIcon} label="Mother tongue" value={profile.mother_tongue} />
              {profile.gotra && <Item icon={UserIcon} label="Gotra" value={profile.gotra} />}
            </dl>

            {profile.hobbies && profile.hobbies.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Hobbies</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.hobbies.map((h) => (
                    <span key={h} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800">
                      {label(h)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-7 border-t border-stone-100 pt-6">
              <ProfileActions profileId={profile.id} />
            </div>
          </div>
        </div>

        {profile.about_me && (
          <div className="card mx-auto mt-8 max-w-3xl p-6 sm:p-8">
            <h2 className="font-display text-xl font-bold text-maroon">About</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-stone-600">{profile.about_me}</p>
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

function label(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
