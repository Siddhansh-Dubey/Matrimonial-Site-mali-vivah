'use client'

import Link from 'next/link'
import { Heart } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

export function SiteFooter() {
  const { t } = useI18n()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="container-page flex flex-col items-center justify-between gap-4 py-8 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-white">
            <Heart className="h-4 w-4 fill-current" aria-hidden />
          </span>
          <div>
            <p className="font-display text-sm font-bold text-stone-900">{t('site.name')}</p>
            <p className="text-xs text-stone-500">{t('site.tagline')}</p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-stone-600">
          <Link href="/about" className="hover:text-brand-700">{t('nav.about')}</Link>
          <Link href="/contact" className="hover:text-brand-700">{t('nav.contact')}</Link>
          <Link href="/privacy" className="hover:text-brand-700">Privacy</Link>
          <Link href="/terms" className="hover:text-brand-700">Terms</Link>
        </nav>
        <p className="text-xs text-stone-400">© {year} {t('site.name')}</p>
      </div>
    </footer>
  )
}
