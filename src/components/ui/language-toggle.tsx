'use client'

import { Globe } from 'lucide-react'
import { locales, localeNames, type Locale } from '@/lib/i18n/dictionaries'
import { useI18n } from '@/lib/i18n/provider'

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t('lang.label')}
      className="flex items-center gap-1 rounded-full border border-stone-300 bg-white p-0.5"
    >
      <Globe className="ml-2 h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
      {locales.map((code: Locale) => {
        const active = code === locale
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            className={[
              'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
              active ? 'bg-brand-600 text-white' : 'text-stone-600 hover:bg-stone-100',
            ].join(' ')}
          >
            {localeNames[code]}
          </button>
        )
      })}
    </div>
  )
}
