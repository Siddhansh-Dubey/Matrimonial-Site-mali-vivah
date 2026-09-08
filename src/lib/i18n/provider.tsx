'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { defaultLocale, locales, translate, type Locale } from './dictionaries'

const STORAGE_KEY = 'mali-vivah:locale'

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && (locales as readonly string[]).includes(stored)) {
      setLocaleState(stored as Locale)
    }
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next
  }, [])

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key: string) => translate(locale, key) }),
    [locale, setLocale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
