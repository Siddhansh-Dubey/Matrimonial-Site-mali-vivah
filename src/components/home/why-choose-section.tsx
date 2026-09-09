'use client'

import type { LucideIcon } from 'lucide-react'
import {
  BadgeCheck,
  CalendarDays,
  Heart,
  Lock,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { LeafSprig } from '@/components/home/ornaments'

type Feature = {
  titleKey: string
  bodyKey: string
  Icon: LucideIcon
  iconClass: string
}

const LEFT_FEATURES: Feature[] = [
  {
    titleKey: 'home.whyChoose.community.title',
    bodyKey: 'home.whyChoose.community.body',
    Icon: Users,
    iconClass: 'text-emerald-800',
  },
  {
    titleKey: 'home.whyChoose.smart.title',
    bodyKey: 'home.whyChoose.smart.body',
    Icon: Sparkles,
    iconClass: 'text-violet-700',
  },
  {
    titleKey: 'home.whyChoose.verified.title',
    bodyKey: 'home.whyChoose.verified.body',
    Icon: BadgeCheck,
    iconClass: 'text-sky-700',
  },
]

const RIGHT_FEATURES: Feature[] = [
  {
    titleKey: 'home.whyChoose.daily.title',
    bodyKey: 'home.whyChoose.daily.body',
    Icon: CalendarDays,
    iconClass: 'text-amber-700',
  },
  {
    titleKey: 'home.whyChoose.express.title',
    bodyKey: 'home.whyChoose.express.body',
    Icon: Send,
    iconClass: 'text-rose-600',
  },
  {
    titleKey: 'home.whyChoose.privacy.title',
    bodyKey: 'home.whyChoose.privacy.body',
    Icon: Lock,
    iconClass: 'text-teal-700',
  },
]

function FeatureCard({ feature }: { feature: Feature }) {
  const { t } = useI18n()
  const { Icon, iconClass } = feature
  return (
    <article className="group rounded-2xl bg-brand-50 px-6 py-7 text-center ring-1 ring-brand-100/70 transition-all duration-300 hover:-translate-y-1 hover:shadow-card-float sm:px-7 sm:py-8">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm ring-1 ring-brand-100">
        <Icon className={`h-[22px] w-[22px] ${iconClass}`} aria-hidden />
      </span>
      <h3 className="mt-4 font-display text-lg font-bold text-stone-900">
        {t(feature.titleKey)}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">{t(feature.bodyKey)}</p>
    </article>
  )
}

export function WhyChooseSection() {
  const { t } = useI18n()

  return (
    <section className="relative overflow-hidden bg-white">
      {/* soft blush halo behind the emblem */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-70"
        style={{
          background:
            'radial-gradient(closest-side, rgba(201,44,75,0.06), transparent), radial-gradient(closest-side, rgba(212,160,50,0.10), transparent 72%)',
        }}
      />

      {/* decorative script watermark */}
      <div aria-hidden className="pointer-events-none absolute -left-6 bottom-0 hidden select-none md:block">
        <p className="-rotate-6 font-script text-6xl leading-[1.02] text-gold-600/20 lg:text-7xl">
          {t('home.whyChoose.watermark.a')}
          <br />
          {t('home.whyChoose.watermark.b')}
        </p>
      </div>

      {/* gold leaf sprigs */}
      <LeafSprig className="pointer-events-none absolute left-[3%] top-8 hidden h-20 w-10 -rotate-12 opacity-60 lg:block" />
      <LeafSprig className="pointer-events-none absolute bottom-10 right-[3%] hidden h-24 w-12 rotate-[150deg] opacity-50 lg:block" />

      <div className="container-page relative py-20 sm:py-24">
        {/* heading */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-600">
            {t('home.whyChoose.kicker')}
          </p>
          <h2 className="mt-3 font-display text-5xl font-bold tracking-tight text-maroon sm:text-6xl">
            {t('brand.name')}
            <span className="text-gold-600">{t('brand.tld')}</span>
            <span className="text-ink">?</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-stone-600 sm:text-lg">
            {t('home.whyChoose.intro')}
          </p>
        </div>

        {/* feature columns + emblem */}
        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1fr_auto_1fr] lg:gap-14">
          {/* left column */}
          <ul className="order-2 grid gap-5 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
            {LEFT_FEATURES.map((feature) => (
              <li key={feature.titleKey}>
                <FeatureCard feature={feature} />
              </li>
            ))}
          </ul>

          {/* trust emblem */}
          <div className="order-1 flex justify-center lg:order-2">
            <div className="relative">
              <span aria-hidden className="absolute -inset-2 rounded-full border border-dashed border-gold-400/50" />
              <span aria-hidden className="absolute -inset-4 hidden rounded-full border border-gold-300/40 sm:block" />
              <div className="relative flex h-64 w-64 flex-col items-center justify-center rounded-full bg-white text-center shadow-card-float ring-1 ring-brand-100 sm:h-72 sm:w-72">
                <p className="text-[11px] font-bold uppercase tracking-[0.34em] text-gold-600">
                  {t('home.whyChoose.badge.kicker')}
                </p>
                <p className="mt-2 font-display text-6xl font-bold leading-none text-maroon sm:text-7xl">
                  {t('home.whyChoose.badge.count')}
                </p>
                <p className="mt-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-stone-700">
                  <span aria-hidden className="h-px w-5 bg-gold-500/70" />
                  <Heart className="h-3.5 w-3.5 fill-maroon text-maroon" aria-hidden />
                  {t('home.whyChoose.badge.label')}
                  <Heart className="h-3.5 w-3.5 fill-maroon text-maroon" aria-hidden />
                  <span aria-hidden className="h-px w-5 bg-gold-500/70" />
                </p>
              </div>
            </div>
          </div>

          {/* right column */}
          <ul className="order-3 grid gap-5 sm:grid-cols-2 lg:mt-20 lg:grid-cols-1">
            {RIGHT_FEATURES.map((feature) => (
              <li key={feature.titleKey}>
                <FeatureCard feature={feature} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
