'use client'

import Link from 'next/link'
import { ArrowRight, HeartHandshake, MessagesSquare, UserRoundPlus } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { LeafSprig } from '@/components/home/ornaments'

const STEPS = [
  { icon: UserRoundPlus, titleKey: 'home.how.step1.title', bodyKey: 'home.how.step1.body' },
  { icon: HeartHandshake, titleKey: 'home.how.step2.title', bodyKey: 'home.how.step2.body' },
  { icon: MessagesSquare, titleKey: 'home.how.step3.title', bodyKey: 'home.how.step3.body' },
]

/**
 * "How it works" — three honest steps from registration to first contact.
 * Copy comes from the home.how.* dictionary keys (EN + Marathi).
 */
export function HowItWorksSection() {
  const { t } = useI18n()

  return (
    <section className="relative overflow-hidden bg-cream">
      <LeafSprig className="pointer-events-none absolute left-[4%] top-10 hidden h-24 w-12 -rotate-12 opacity-50 lg:block" />
      <LeafSprig className="pointer-events-none absolute bottom-8 right-[4%] hidden h-24 w-12 rotate-[150deg] opacity-50 lg:block" />

      <div className="container-page relative py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-600">
            {t('home.how.kicker')}
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-maroon sm:text-5xl">
            {t('home.how.title')}
          </h2>
        </div>

        <ol className="relative mx-auto mt-14 grid max-w-5xl gap-10 sm:grid-cols-3 sm:gap-6 lg:gap-10">
          {/* connector line (desktop) */}
          <span
            aria-hidden
            className="absolute left-[16%] right-[16%] top-9 hidden border-t-2 border-dashed border-gold-400/60 sm:block"
          />
          {STEPS.map((step, i) => (
            <li key={step.titleKey} className="relative flex flex-col items-center text-center">
              <span className="relative z-10 grid h-[72px] w-[72px] place-items-center rounded-full bg-maroon text-white shadow-lg shadow-maroon/25 ring-8 ring-cream">
                <step.icon className="h-7 w-7" aria-hidden />
                <span
                  aria-hidden
                  className="absolute -right-1.5 -top-1.5 grid h-7 w-7 place-items-center rounded-full bg-gold-400 font-display text-sm font-bold text-maroon-deep"
                >
                  {i + 1}
                </span>
              </span>
              <h3 className="mt-5 font-display text-xl font-bold text-stone-900">
                {t(step.titleKey)}
              </h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-stone-600">
                {t(step.bodyKey)}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-maroon px-7 py-3 text-[15px] font-semibold text-white shadow-lg shadow-maroon/25 transition-all hover:bg-maroon-dark"
          >
            {t('nav.register')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
          <Link
            href="/search"
            className="inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-maroon/70 bg-white/70 px-7 py-[11px] text-[15px] font-semibold text-maroon transition-all hover:bg-maroon hover:text-white"
          >
            {t('home.hero.find')}
          </Link>
        </div>
      </div>
    </section>
  )
}
