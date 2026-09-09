'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Heart } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

type Gender = 'bride' | 'groom'

type Profile = {
  photo: string
  alt: string
  name: string
  gender: Gender
  age: number
  city: string
  education: string
  occupation: string
}

// Sample/demo profiles with masked names (matching the reference design).
// TODO: replace with real member data + consented photos when the profile DB lands.
const PROFILES: Profile[] = [
  {
    photo: '/images/profiles/bride-1.jpg',
    alt: 'Featured Mali bride profile photograph',
    name: 'A***** K*****',
    gender: 'bride',
    age: 26,
    city: 'Pune',
    education: 'B.E. (Computer)',
    occupation: 'Working Professional',
  },
  {
    photo: '/images/profiles/groom-1.jpg',
    alt: 'Featured Mali groom profile photograph',
    name: 'R***** J*****',
    gender: 'groom',
    age: 29,
    city: 'Mumbai',
    education: 'MBA',
    occupation: 'Business Owner',
  },
  {
    photo: '/images/profiles/bride-2.jpg',
    alt: 'Featured Mali bride profile photograph',
    name: 'S***** M*****',
    gender: 'bride',
    age: 25,
    city: 'Nashik',
    education: 'M.Sc. (Biotechnology)',
    occupation: 'Working Professional',
  },
  {
    photo: '/images/profiles/groom-2.jpg',
    alt: 'Featured Mali groom profile photograph',
    name: 'P***** D*****',
    gender: 'groom',
    age: 30,
    city: 'Pune',
    education: 'CA',
    occupation: 'Working Professional',
  },
]

const TABS: { id: 'all' | Gender; key: string }[] = [
  { id: 'all', key: 'home.featured.tabAll' },
  { id: 'bride', key: 'home.featured.tabBrides' },
  { id: 'groom', key: 'home.featured.tabGrooms' },
]

export function FeaturedProfilesSection() {
  const { t } = useI18n()
  const [tab, setTab] = useState<'all' | Gender>('all')

  const visible = tab === 'all' ? PROFILES : PROFILES.filter((p) => p.gender === tab)

  return (
    <section id="featured-profiles" className="relative overflow-hidden bg-cream">
      <div className="container-page relative py-20 sm:py-24">
        {/* heading */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            {t('home.featured.kicker')}
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            <span className="text-maroon">{t('home.featured.titleA')}</span>{' '}
            <span className="text-gold-600">{t('home.featured.titleB')}</span>
          </h2>
          <p className="mt-4 text-base text-stone-600 sm:text-lg">{t('home.featured.subtitle')}</p>
        </div>

        {/* tab row */}
        <div className="relative mt-9 flex items-center justify-center">
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-full bg-white/70 p-1.5 ring-1 ring-stone-200/70 sm:gap-2.5">
            {TABS.map(({ id, key }) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={active}
                  className={[
                    'rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-5',
                    active
                      ? 'bg-maroon text-white shadow-md shadow-maroon/25'
                      : 'text-maroon hover:bg-brand-50',
                  ].join(' ')}
                >
                  {t(key)}
                </button>
              )
            })}
          </div>

          <Link
            href="/search"
            className="group absolute right-0 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-sm font-bold text-maroon hover:text-maroon-dark lg:inline-flex"
          >
            {t('home.featured.viewAll')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
        </div>

        {/* cards */}
        <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((profile) => (
            <li key={profile.name}>
              <ProfileCard profile={profile} />
            </li>
          ))}
        </ul>

        {/* closing tagline */}
        <div className="mt-16 flex flex-col items-center gap-5 text-center sm:mt-20">
          <span aria-hidden className="flex items-center gap-3">
            <span className="h-px w-10 bg-gold-500/60 sm:w-16" />
            <Heart className="h-3.5 w-3.5 fill-gold-500 text-gold-500" />
            <span className="h-px w-10 bg-gold-500/60 sm:w-16" />
          </span>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold-700/80 sm:text-sm">
            {t('home.featured.tagline')}
          </p>
        </div>
      </div>
    </section>
  )
}

function ProfileCard({ profile }: { profile: Profile }) {
  const { t } = useI18n()
  const { photo, alt, name, gender, age, city, education, occupation } = profile

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[22px] bg-white shadow-card-float ring-1 ring-stone-100/80">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <Image
          src={photo}
          alt={alt}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
          className="object-cover object-top"
        />
        <span className="absolute left-3.5 top-3.5 rounded-full bg-gold-300 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-maroon-deep shadow-sm">
          {t('home.featured.badge')}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center px-5 pb-6 pt-5 text-center">
        <h3 className="font-display text-[21px] font-bold leading-snug text-maroon">{name}</h3>
        <p className="mt-1 text-[13.5px] text-stone-600">
          {age} {t('home.featured.years')} | {city}, Maharashtra
        </p>
        <p className="mt-1 text-[13.5px] text-stone-600">
          {education} | {occupation}
        </p>

        <Link
          href={gender === 'bride' ? '/search?lookingFor=bride' : '/search?lookingFor=groom'}
          className="mt-5 inline-flex items-center justify-center rounded-full border-[1.5px] border-brand-300/80 bg-brand-50 px-9 py-2.5 text-sm font-bold text-brand-800 transition-all hover:border-brand-600 hover:bg-brand-600 hover:text-white"
        >
          {t('home.featured.knowMore')}
        </Link>
      </div>
    </article>
  )
}
