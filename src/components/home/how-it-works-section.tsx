'use client'

import Link from 'next/link'
import { HeartHandshake, Search, UserPlus } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

const STEPS = [
  { Icon: UserPlus, key: 'home.how.step1' },
  { Icon: Search, key: 'home.how.step2' },
  { Icon: HeartHandshake, key: 'home.how.step3' },
]

/**
 * "How It Works" — the three-step journey in plain, honest language.
 * Copy lives in the i18n dictionaries (home.how.*) so both languages stay
 * in sync; the steps describe how the product actually works.
 */
export function HowItWorksSection() {
  const { t } = useI18n()
  return (
    <section className="bg-white">
      <div className="container-page py-16 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            {t('home.how.kicker')}
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold text-maroon sm:text-4xl">
            {t('home.how.title')}
          </h2>
        </div>

        <ol className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
          {STEPS.map(({ Icon, key }, i) => (
            <li key={key} className="card relative p-6">
              <span className="absolute right-4 top-4 font-display text-3xl font-bold text-gold-200" aria-hidden>
                {i + 1}
              </span>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-maroon text-gold-300">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-stone-900">
                {t(`${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{t(`${key}.body`)}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 text-center">
          <Link href="/register" className="btn-primary">
            {t('home.hero.ctaPrimary')}
          </Link>
        </div>
      </div>
    </section>
  )
}
