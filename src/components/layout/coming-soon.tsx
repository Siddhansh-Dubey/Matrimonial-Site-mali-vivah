'use client'

import Link from 'next/link'
import { ArrowRight, Heart } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

export function ComingSoon({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const { t } = useI18n()
  return (
    <section className="bg-cream">
      <div className="container-page mx-auto max-w-2xl py-24 text-center sm:py-32">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
          <Heart className="h-6 w-6 fill-maroon text-maroon" aria-hidden />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-gold-600">
          {t('soon.kicker')}
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold text-ink sm:text-4xl">{t(titleKey)}</h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-stone-600 sm:text-base">
          {t(bodyKey)}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-full bg-maroon px-6 py-3 text-sm font-semibold text-white shadow-md shadow-maroon/25 transition-all hover:bg-maroon-dark"
          >
            {t('nav.register')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Link href="/" className="btn-secondary">
            {t('nav.home')}
          </Link>
        </div>
      </div>
    </section>
  )
}
