'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight, Menu, UserRound, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { LanguageToggle } from '@/components/ui/language-toggle'

const NAV = [
  { href: '/', key: 'nav.home' },
  { href: '/search?lookingFor=bride', key: 'nav.brides' },
  { href: '/search?lookingFor=groom', key: 'nav.grooms' },
  { href: '/success-stories', key: 'nav.stories' },
  { href: '/packages', key: 'nav.packages' },
  { href: '/about', key: 'nav.about' },
  { href: '/contact', key: 'nav.contact' },
]

function BrandMark() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden className="h-11 w-11 shrink-0 sm:h-[52px] sm:w-[52px]">
      {/* Couple silhouette approximation */}
      <path
        d="M26 44c-9.5-4.6-16-9.7-16-16.4 0-4.4 3.2-7.6 7.2-7.6 2.5 0 4.6 1.2 5.9 3.1L26 26l2.9-2.9a7.3 7.3 0 0 1 5.9-3.1c4 0 7.2 3.2 7.2 7.6C42 34.3 35.5 39.4 26 44Z"
        stroke="#9e0b1e"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="13" r="4.2" stroke="#9e0b1e" strokeWidth="2" fill="none" />
      <path
        d="M28.5 6.5c-2.6 0-4.4 1.6-4.9 3.6l6.9 2.6c.4-2.7-1.3-6.2-2-6.2ZM20 18.5c1.8 2.4 5.2 3.4 8.6 2.6"
        stroke="#9e0b1e"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M26 40.5v-3M22.5 39.2l1.6-2.5M29.5 39.2l-1.6-2.5"
        stroke="#c9a24b"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="26" cy="6" r="1.4" fill="#c9a24b" />
    </svg>
  )
}

export function SiteHeader() {
  const { t } = useI18n()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur">
      <div className="container-page flex min-h-[76px] items-center justify-between gap-4 py-3">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <BrandMark />
          <span className="leading-none">
            <span className="font-display text-[22px] font-bold tracking-tight sm:text-2xl">
              <span className="text-maroon">{t('brand.name')}</span>
              <span className="text-gold-600">{t('brand.tld')}</span>
            </span>
            <span className="mt-1.5 flex items-center gap-1.5 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              <span className="h-px w-4 bg-gold-500/70" aria-hidden />
              {t('brand.tagline')}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-5 lg:flex xl:gap-6" aria-label="Primary">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href.split('?')[0])
            return (
              <Link
                key={item.key}
                href={item.href}
                className={[
                  'relative py-2 text-[13.5px] font-medium transition-colors',
                  active ? 'text-maroon' : 'text-stone-800 hover:text-maroon',
                ].join(' ')}
              >
                {t(item.key)}
                {active && <span className="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full bg-maroon" aria-hidden />}
              </Link>
            )
          })}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <LanguageToggle />
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 rounded-full bg-maroon px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-maroon/25 transition-all hover:bg-maroon-dark"
          >
            <UserRound className="h-4 w-4" aria-hidden />
            {t('nav.loginRegister')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-lg text-stone-700 hover:bg-cream-dark lg:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-stone-200/70 bg-cream pb-2 lg:hidden">
          <div className="container-page flex flex-col gap-1 py-4">
            {NAV.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-cream-dark"
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2.5 border-t border-stone-200/70 pt-4">
              <LanguageToggle />
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-maroon px-5 py-3 text-sm font-semibold text-white"
                onClick={() => setOpen(false)}
              >
                <UserRound className="h-4 w-4" aria-hidden />
                {t('nav.loginRegister')}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/register" className="btn-secondary" onClick={() => setOpen(false)}>
                {t('nav.register')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
