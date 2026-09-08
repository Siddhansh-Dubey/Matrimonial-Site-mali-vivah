'use client'

import Link from 'next/link'
import { CheckCircle2, Database, Layout, Server } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { isSupabaseConfigured } from '@/lib/env'

const READY = [
  { icon: Layout, label: 'Next.js 14 App Router + TypeScript + Tailwind' },
  { icon: Database, label: 'Supabase browser / server / admin clients' },
  { icon: Server, label: 'Auth session refresh middleware' },
  { icon: CheckCircle2, label: 'Responsive shell with English / मराठी toggle' },
]

export default function HomePage() {
  const { t } = useI18n()

  return (
    <div className="container-page py-16 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
          {t('site.tagline')}
        </span>
        <h1 className="mt-5 font-display text-4xl font-bold text-stone-900 sm:text-5xl">
          {t('setup.title')}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-stone-600">{t('setup.body')}</p>

        <ul className="mx-auto mt-10 grid max-w-lg gap-3 text-left">
          {READY.map(({ icon: Icon, label }) => (
            <li key={label} className="card flex items-center gap-3 px-4 py-3">
              <Icon className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <span className="text-sm text-stone-700">{label}</span>
            </li>
          ))}
        </ul>

        {!isSupabaseConfigured && (
          <p className="mx-auto mt-8 max-w-lg rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t('setup.env')}
          </p>
        )}

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="btn-primary">{t('nav.register')}</Link>
          <Link href="/search" className="btn-secondary">{t('nav.search')}</Link>
        </div>
      </div>
    </div>
  )
}
