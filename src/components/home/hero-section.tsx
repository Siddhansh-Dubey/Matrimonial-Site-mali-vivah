'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarDays,
  Eye,
  Gift,
  Heart,
  Search,
  Send,
  Star,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { LeafSprig } from '@/components/home/ornaments'

function FloatCard({
  icon,
  iconClass,
  title,
  sub,
  className = '',
  floatClass = 'animate-float-soft',
}: {
  icon: ReactNode
  iconClass: string
  title: string
  sub: string
  className?: string
  floatClass?: string
}) {
  return (
    <div
      className={`absolute z-20 items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 shadow-card-float ring-1 ring-stone-100 backdrop-blur ${floatClass} ${className}`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${iconClass}`}>
        {icon}
      </span>
      <span>
        <span className="block text-[13.5px] font-bold leading-tight text-ink">{title}</span>
        <span className="mt-0.5 block max-w-[150px] text-[11.5px] leading-snug text-stone-500">{sub}</span>
      </span>
    </div>
  )
}

export function HeroSection() {
  const { t } = useI18n()

  return (
    <section className="relative overflow-hidden bg-cream">
      <div className="container-page relative grid items-center gap-12 pb-28 pt-10 sm:pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-6 lg:pb-32 lg:pt-16">
        {/* ---------- Left: copy ---------- */}
        <div className="relative z-10 max-w-xl">
          <p className="text-[13px] font-medium uppercase tracking-[0.38em] text-gold-600">
            {t('home.hero.welcome')}
          </p>
          <h1 className="mt-3 font-display text-[52px] font-bold leading-[1.02] tracking-tight sm:text-7xl lg:text-[76px]">
            <span className="text-maroon">{t('brand.name')}</span>
            <span className="text-gold-600">{t('brand.tld')}</span>
          </h1>

          <div className="mt-6 h-[2px] w-16 bg-gold-500" aria-hidden />

          <h2 className="mt-6 font-display text-[30px] font-medium leading-[1.25] text-ink sm:text-4xl">
            {t('home.hero.headlineA')}
            <br />
            <span className="font-bold text-maroon">{t('home.hero.headlineB')}</span>
          </h2>

          <p className="mt-4 font-display text-lg italic text-stone-500">
            {t('home.hero.sub')}
          </p>

          <div className="mt-8 flex flex-col gap-3.5 sm:flex-row sm:items-center">
            <Link
              href="/search"
              className="group inline-flex items-center justify-center gap-2.5 rounded-full bg-maroon px-7 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-maroon/25 transition-all hover:bg-maroon-dark"
            >
              <Search className="h-[18px] w-[18px]" aria-hidden />
              {t('home.hero.find')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
            <Link
              href="/packages"
              className="inline-flex items-center justify-center gap-2.5 rounded-full border-[1.5px] border-maroon/70 bg-white/70 px-7 py-[13px] text-[15px] font-semibold text-maroon transition-all hover:bg-maroon hover:text-white"
            >
              <Gift className="h-[18px] w-[18px]" aria-hidden />
              {t('home.hero.packages')}
            </Link>
          </div>

          <div className="mt-9 flex items-center gap-3">
            <span className="flex items-center gap-1" aria-label={t('home.hero.rating')}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-[18px] w-[18px] fill-amber-400 text-amber-400" aria-hidden />
              ))}
            </span>
            <span>
              <span className="block text-[15px] font-bold text-ink">{t('home.hero.rating')}</span>
              <span className="block text-[13px] text-stone-500">{t('home.hero.trustedBy')}</span>
            </span>
          </div>
        </div>

        {/* ---------- Right: portrait + floating cards ---------- */}
        <div className="relative z-10 mx-auto w-full max-w-[560px]">
          <div className="relative mx-auto aspect-square w-full max-w-[520px]">
            {/* soft halo behind */}
            <div aria-hidden className="absolute inset-0 scale-[1.06] rounded-full bg-cream-deeper/60" />
            <div aria-hidden className="absolute -inset-3 rounded-full border border-gold-400/40" />
            {/* portrait */}
            <div className="absolute inset-0 overflow-hidden rounded-full shadow-2xl shadow-maroon/10 ring-8 ring-white/40">
              <Image
                src="/images/hero-couple.jpg"
                alt="Smiling Mali bride and groom in traditional wedding attire"
                fill
                priority
                sizes="(max-width: 1024px) 90vw, 520px"
                className="object-cover object-top"
              />
            </div>

            {/* leaf decorations */}
            <LeafSprig className="absolute -top-8 left-[16%] h-24 w-12 -rotate-12 opacity-80" />
            <LeafSprig className="absolute left-[-34px] top-[38%] h-28 w-14 -rotate-[24deg] opacity-70" />
            <LeafSprig className="absolute -bottom-4 right-[10%] h-24 w-12 rotate-[150deg] opacity-70" />

            {/* floating cards (desktop) */}
            <FloatCard
              icon={<Heart className="h-5 w-5 fill-maroon text-maroon" aria-hidden />}
              iconClass="bg-rose-100"
              title={t('home.hero.compat.title')}
              sub={t('home.hero.compat.sub')}
              className="left-[-56px] top-[10%] hidden md:flex"
            />
            <FloatCard
              icon={<CalendarDays className="h-5 w-5 text-amber-700" aria-hidden />}
              iconClass="bg-amber-100"
              title={t('home.hero.daily.title')}
              sub={t('home.hero.daily.sub')}
              className="right-[-40px] top-[1%] hidden md:flex"
              floatClass="animate-float-soft-delayed"
            />
            <FloatCard
              icon={<Send className="h-5 w-5 text-emerald-800" aria-hidden />}
              iconClass="bg-[#dde9dc]"
              title={t('home.hero.express.title')}
              sub={t('home.hero.express.sub')}
              className="bottom-[16%] left-[-64px] hidden md:flex"
              floatClass="animate-float-soft-delayed"
            />
            <FloatCard
              icon={<Eye className="h-5 w-5 text-violet-800" aria-hidden />}
              iconClass="bg-violet-100"
              title={t('home.hero.viewed.title')}
              sub={t('home.hero.viewed.sub')}
              className="bottom-[4%] right-[-48px] hidden md:flex"
            />
          </div>

          {/* script note */}
          <div aria-hidden className="absolute -right-8 top-[34%] hidden text-center xl:block">
            <p className="rotate-[4deg] font-script text-[30px] leading-[1.15] text-gold-600">
              {t('home.hero.script1')}
              <br />
              {t('home.hero.script2').split(' ')[0]}
              <br />
              {t('home.hero.script2').split(' ').slice(1).join(' ')}
            </p>
            <Heart className="mx-auto mt-1 h-4 w-4 rotate-[8deg] text-gold-600" aria-hidden />
          </div>

          {/* floating cards (mobile grid) */}
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
            {[
              {
                icon: <Heart className="h-5 w-5 fill-maroon text-maroon" aria-hidden />,
                iconClass: 'bg-rose-100',
                title: t('home.hero.compat.title'),
                sub: t('home.hero.compat.sub'),
              },
              {
                icon: <CalendarDays className="h-5 w-5 text-amber-700" aria-hidden />,
                iconClass: 'bg-amber-100',
                title: t('home.hero.daily.title'),
                sub: t('home.hero.daily.sub'),
              },
              {
                icon: <Send className="h-5 w-5 text-emerald-800" aria-hidden />,
                iconClass: 'bg-[#dde9dc]',
                title: t('home.hero.express.title'),
                sub: t('home.hero.express.sub'),
              },
              {
                icon: <Eye className="h-5 w-5 text-violet-800" aria-hidden />,
                iconClass: 'bg-violet-100',
                title: t('home.hero.viewed.title'),
                sub: t('home.hero.viewed.sub'),
              },
            ].map((c) => (
              <div
                key={c.title}
                className="flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 shadow-card-float ring-1 ring-stone-100"
              >
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${c.iconClass}`}>
                  {c.icon}
                </span>
                <span>
                  <span className="block text-[13.5px] font-bold leading-tight text-ink">{c.title}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-stone-500">{c.sub}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* bottom wave into next section */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 leading-none">
        <svg viewBox="0 0 1440 96" preserveAspectRatio="none" className="h-[64px] w-full sm:h-[84px]">
          <path
            d="M0,64 C240,96 420,16 720,48 C1020,80 1220,96 1440,40 L1440,96 L0,96 Z"
            fill="#ffffff"
          />
          <path
            d="M0,64 C240,96 420,16 720,48 C1020,80 1220,96 1440,40"
            fill="none"
            stroke="#e8c87e"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
        </svg>
        <LeafSprig className="absolute bottom-2 right-[6%] hidden h-20 w-10 rotate-[140deg] opacity-60 lg:block" />
      </div>
    </section>
  )
}
