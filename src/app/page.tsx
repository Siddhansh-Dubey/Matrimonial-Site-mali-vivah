'use client'

import Link from 'next/link'
import { BadgeCheck, ChevronDown, Heart, HeartHandshake, Lock, ShieldCheck, UserCheck, Users } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

export default function HomePage() {
  const { t } = useI18n()

  const trust = [
    { icon: BadgeCheck, title: t('home.trust.verified'), body: t('home.trust.verifiedBody') },
    { icon: Lock, title: t('home.trust.private'), body: t('home.trust.privateBody') },
    { icon: Users, title: t('home.trust.family'), body: t('home.trust.familyBody') },
    { icon: Heart, title: t('home.trust.small'), body: t('home.trust.smallBody') },
  ]

  const steps = [
    { number: '01', title: t('home.how.step1.title'), body: t('home.how.step1.body') },
    { number: '02', title: t('home.how.step2.title'), body: t('home.how.step2.body') },
    { number: '03', title: t('home.how.step3.title'), body: t('home.how.step3.body') },
  ]

  const why = [
    { icon: UserCheck, title: t('home.why.review.title'), body: t('home.why.review.body') },
    { icon: ShieldCheck, title: t('home.why.private.title'), body: t('home.why.private.body') },
    { icon: HeartHandshake, title: t('home.why.respect.title'), body: t('home.why.respect.body') },
  ]

  const faqs = [
    { q: t('home.faq.q1'), a: t('home.faq.a1') },
    { q: t('home.faq.q2'), a: t('home.faq.a2') },
    { q: t('home.faq.q3'), a: t('home.faq.a3') },
    { q: t('home.faq.q4'), a: t('home.faq.a4') },
    { q: t('home.faq.q5'), a: t('home.faq.a5') },
  ]

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(201,44,75,0.08),_transparent_46%),radial-gradient(circle_at_bottom_right,_rgba(212,160,50,0.10),_transparent_40%)]"
        />
        <div className="container-page relative mx-auto max-w-3xl py-20 text-center sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
            <Heart className="h-3.5 w-3.5 fill-current" aria-hidden />
            {t('site.tagline')}
          </span>
          <h1 className="mt-6 font-display text-4xl font-bold leading-tight text-stone-900 sm:text-5xl">
            {t('home.hero.title')}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
            {t('home.hero.body')}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className="btn-primary w-full sm:w-auto">
              {t('home.hero.ctaPrimary')}
            </Link>
            <a href="#how-it-works" className="btn-secondary w-full sm:w-auto">
              {t('home.hero.ctaSecondary')}
            </a>
          </div>
          <p className="mt-6 text-xs text-stone-500 sm:text-sm">{t('home.hero.note')}</p>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y border-stone-200 bg-white">
        <div className="container-page grid grid-cols-1 gap-x-8 gap-y-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50">
                <Icon className="h-5 w-5 text-brand-600" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container-page py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">{t('home.how.kicker')}</p>
          <h2 className="mt-3 font-display text-3xl font-bold text-stone-900 sm:text-4xl">{t('home.how.title')}</h2>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <li key={step.number} className="card px-7 py-8">
              <span className="font-display text-3xl font-bold text-brand-200">{step.number}</span>
              <h3 className="mt-4 font-display text-xl font-bold text-stone-900">{step.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-stone-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Why families trust us */}
      <section className="border-y border-stone-200 bg-white">
        <div className="container-page py-20 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">{t('home.why.kicker')}</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-stone-900 sm:text-4xl">{t('home.why.title')}</h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {why.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-stone-200 bg-stone-50/60 px-7 py-8">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
                  <Icon className="h-5 w-5 text-brand-600" aria-hidden />
                </span>
                <h3 className="mt-5 font-display text-xl font-bold text-stone-900">{title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-stone-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container-page py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">{t('home.faq.kicker')}</p>
          <h2 className="mt-3 font-display text-3xl font-bold text-stone-900 sm:text-4xl">{t('home.faq.title')}</h2>
        </div>
        <div className="mx-auto mt-10 max-w-2xl divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
          {faqs.map(({ q, a }) => (
            <details key={q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-semibold text-stone-900 [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-stone-400 transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="container-page pb-20 sm:pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-brand-900 px-6 py-14 text-center text-white sm:px-12 sm:py-16">
          <div
            aria-hidden
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'radial-gradient(circle at 15% 25%, rgba(226,184,87,0.35) 0, transparent 34%), radial-gradient(circle at 85% 80%, rgba(255,255,255,0.12) 0, transparent 30%)',
            }}
          />
          <div className="relative mx-auto max-w-xl">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{t('home.cta.title')}</h2>
            <p className="mt-4 text-sm leading-relaxed text-brand-100 sm:text-base">{t('home.cta.body')}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className="btn w-full bg-white text-brand-800 hover:bg-brand-50 sm:w-auto"
              >
                {t('home.cta.button')}
              </Link>
              <Link href="/login" className="btn w-full border border-white/30 text-white hover:bg-white/10 sm:w-auto">
                {t('home.cta.login')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
