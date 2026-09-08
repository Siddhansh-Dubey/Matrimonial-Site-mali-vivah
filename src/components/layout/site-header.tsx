'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Heart, Menu, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { LanguageToggle } from '@/components/ui/language-toggle'

const NAV = [
  { href: '/', key: 'nav.home' },
  { href: '/search', key: 'nav.search' },
  { href: '/about', key: 'nav.about' },
  { href: '/contact', key: 'nav.contact' },
]

export function SiteHeader() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-white">
            <Heart className="h-4.5 w-4.5 fill-current" aria-hidden />
          </span>
          <span className="font-display text-lg font-bold leading-none text-stone-900">
            {t('site.name')}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <LanguageToggle />
          <Link href="/login" className="btn-ghost">
            {t('nav.login')}
          </Link>
          <Link href="/register" className="btn-primary">
            {t('nav.register')}
          </Link>
        </div>

        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-lg text-stone-700 hover:bg-stone-100 md:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-stone-200 bg-white md:hidden">
          <div className="container-page flex flex-col gap-1 py-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-stone-200 pt-4">
              <LanguageToggle />
              <Link href="/login" className="btn-secondary" onClick={() => setOpen(false)}>
                {t('nav.login')}
              </Link>
              <Link href="/register" className="btn-primary" onClick={() => setOpen(false)}>
                {t('nav.register')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
