'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

const QUICK_LINKS = [
  { href: '/', key: 'nav.home' },
  { href: '/search', key: 'footer.browseProfiles' },
  { href: '/packages', key: 'nav.packages' },
  { href: '/contact', key: 'nav.contact' },
]

const IMPORTANT_LINKS = [
  { href: '/terms', key: 'footer.terms' },
  { href: '/privacy', key: 'footer.privacy' },
  { href: '/cancellation-and-refund', key: 'footer.cancellation' },
  { href: '/rules', key: 'footer.rules' },
]

function GoldEmblem({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 52 52" fill="none" aria-hidden className={className}>
      <path
        d="M26 44c-9.5-4.6-16-9.7-16-16.4 0-4.4 3.2-7.6 7.2-7.6 2.5 0 4.6 1.2 5.9 3.1L26 26l2.9-2.9a7.3 7.3 0 0 1 5.9-3.1c4 0 7.2 3.2 7.2 7.6C42 34.3 35.5 39.4 26 44Z"
        stroke="#e2b857"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="13" r="4.2" stroke="#e2b857" strokeWidth="1.8" />
      <path
        d="M28.5 6.5c-2.6 0-4.4 1.6-4.9 3.6l6.9 2.6c.4-2.7-1.3-6.2-2-6.2ZM20 18.5c1.8 2.4 5.2 3.4 8.6 2.6"
        stroke="#e2b857"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M26 40.5v-3M22.5 39.2l1.6-2.5M29.5 39.2l-1.6-2.5"
        stroke="#e2b857"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="26" cy="6" r="1.4" fill="#e2b857" />
    </svg>
  )
}

export function SiteFooter() {
  const { t } = useI18n()
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden bg-[#530c17] text-white">
      {/* top photo band, fading into the maroon footer body */}
      <div className="relative h-36 w-full sm:h-44 lg:h-48">
        <Image
          src="/images/footer-band.jpg"
          alt=""
          fill
          priority={false}
          sizes="100vw"
          className="object-cover object-[50%_18%]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-[#530c17]/25 via-[#530c17]/5 to-[#530c17]"
        />
      </div>

      {/* main columns */}
      <div className="container-page relative pb-14 pt-14 sm:pt-16">
        <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.45fr]">
          {/* Brand */}
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-500/50" />
              <GoldEmblem className="h-12 w-12 shrink-0" />
              <span aria-hidden className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-500/50" />
            </div>
            <p className="mt-4 text-center font-display text-[26px] font-bold leading-none tracking-tight sm:text-3xl">
              <span className="text-white">{t('brand.name')}</span>
              <span className="text-gold-400">{t('brand.tld')}</span>
            </p>
            <p className="mt-3 flex items-center justify-center gap-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.24em] text-gold-300/85">
              <span aria-hidden className="h-px w-5 bg-gold-500/60" />
              <Heart className="h-3 w-3 fill-gold-400 text-gold-400" aria-hidden />
              {t('brand.tagline')}
              <Heart className="h-3 w-3 fill-gold-400 text-gold-400" aria-hidden />
              <span aria-hidden className="h-px w-5 bg-gold-500/60" />
            </p>
            <p className="mt-6 text-left text-sm leading-relaxed text-white/70">
              {t('footer.description')}
            </p>
          </div>

          {/* Quick Links */}
          <nav aria-label={t('footer.heading.quick')}>
            <FooterHeading>{t('footer.heading.quick')}</FooterHeading>
            <ul className="mt-5 space-y-2.5">
              {QUICK_LINKS.map(({ href, key }) => (
                <li key={key}>
                  <FooterLink href={href}>{t(key)}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Important Links */}
          <nav aria-label={t('footer.heading.important')}>
            <FooterHeading>{t('footer.heading.important')}</FooterHeading>
            <ul className="mt-5 space-y-2.5">
              {IMPORTANT_LINKS.map(({ href, key }) => (
                <li key={key}>
                  <FooterLink href={href}>{t(key)}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Connect with us */}
          <div>
            <FooterHeading>{t('footer.heading.connect')}</FooterHeading>
            <a
              href="https://wa.me/919876543210"
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex max-w-xs items-center gap-3.5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 transition-colors hover:border-gold-400/40 hover:bg-white/10"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#25d366] text-white shadow-md">
                {/* WhatsApp glyph */}
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-6 w-6">
                  <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
                </svg>
              </span>
              <span>
                <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">
                  {t('footer.haveQuestions')}
                </span>
                <span className="mt-0.5 block text-sm font-bold leading-snug text-white group-hover:text-gold-300">
                  {t('footer.whatsapp')}
                </span>
              </span>
            </a>

            <p className="mt-8 font-script text-[27px] leading-[1.2] text-gold-300/90 sm:text-[30px]">
              {t('footer.script')}
            </p>
          </div>
        </div>
      </div>

      {/* bottom bar */}
      <div className="relative border-t border-gold-500/20">
        <div className="container-page relative flex flex-col items-center justify-between gap-4 py-7 text-center lg:flex-row lg:text-left">
          <p className="order-2 text-xs text-white/60 sm:text-sm lg:order-1">
            © 2024–{year} {t('footer.rightsText')}
          </p>
          <p className="order-1 text-[11px] font-bold uppercase tracking-[0.3em] text-gold-300/90 sm:text-xs lg:order-2">
            {t('footer.slogan')}
          </p>
          <p
            aria-hidden
            className="order-3 hidden select-none font-script text-5xl leading-none text-gold-300/20 xl:block"
          >
            {t('footer.watermarkScript')}
          </p>
        </div>
      </div>
    </footer>
  )
}

function FooterHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.22em] text-white">
      {children}
      <span aria-hidden className="h-px w-7 bg-gold-500/50" />
    </h3>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-[15px] text-white/75 transition-colors hover:text-gold-300 hover:underline hover:underline-offset-4"
    >
      {children}
    </Link>
  )
}
