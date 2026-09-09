'use client'

import Link from 'next/link'
import { FormEvent, useMemo, useState } from 'react'
import { BadgeCheck, Eye, EyeOff, Heart, Lock, Mail, Phone, ShieldCheck, Sparkles, User } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { isSupabaseConfigured } from '@/lib/env'
import { forWhomOptions, registerSchema, type ForWhom } from '@/lib/auth/register-schema'

type FieldErrors = {
  name?: string
  email?: string
  mobile?: string
  password?: string
  confirm?: string
  terms?: string
}

function formatMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}

type SuccessState =
  | { kind: 'verify-email'; email: string }
  | { kind: 'done' }

export function RegisterForm() {
  const { t } = useI18n()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [forWhom, setForWhom] = useState<ForWhom>('self')
  const [terms, setTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [errorIsExisting, setErrorIsExisting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<SuccessState | null>(null)

  const forWhomLabels: Record<ForWhom, string> = {
    self: t('register.forSelf'),
    son: t('register.forSon'),
    daughter: t('register.forDaughter'),
  }

  const trust = useMemo(
    () => [
      { icon: Sparkles, key: 'register.trust.free' },
      { icon: BadgeCheck, key: 'register.trust.review' },
      { icon: ShieldCheck, key: 'register.trust.private' },
    ],
    []
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setErrorIsExisting(false)

    const parsed = registerSchema.safeParse({ name, email, mobile, password, confirm, forWhom, terms })
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === 'name') next.name = t('register.error.name')
        if (field === 'email') next.email = t('register.error.email')
        if (field === 'mobile') next.mobile = t('register.error.mobile')
        if (field === 'password') next.password = t('register.error.password')
        if (field === 'confirm') next.confirm = t('register.error.confirm')
        if (field === 'terms') next.terms = t('register.error.terms')
      }
      setFieldErrors(next)
      return
    }

    setFieldErrors({})
    setSubmitting(true)

    try {
      if (!isSupabaseConfigured) {
        setFormError(t('register.error.env'))
        return
      }

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: {
            full_name: parsed.data.name,
            phone: parsed.data.mobile,
            for_whom: parsed.data.forWhom,
          },
          emailRedirectTo: window.location.origin,
        },
      })

      if (error || !data.user) {
        const message = (error?.message ?? '').toLowerCase()
        if (message.includes('already') || message.includes('registered') || message.includes('exist')) {
          setErrorIsExisting(true)
          setFormError(t('register.error.exists'))
        } else {
          setFormError(t('register.error.generic'))
        }
        return
      }

      if (data.session) {
        setSuccess({ kind: 'done' })
      } else {
        setSuccess({ kind: 'verify-email', email: parsed.data.email })
      }
    } catch {
      setFormError(t('register.error.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    const finished = success.kind === 'done'
    return (
      <div className="container-page flex min-h-[calc(100dvh-8rem)] items-center justify-center py-12">
        <div className="card w-full max-w-md px-6 py-10 text-center sm:px-10">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50">
            <ShieldCheck className="h-7 w-7 text-brand-600" aria-hidden />
          </span>
          <h2 className="mt-5 font-display text-2xl font-bold text-stone-900">
            {t(finished ? 'register.done.title' : 'register.success.title')}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            {t(finished ? 'register.done.body' : 'register.success.body')}
          </p>
          {!finished && (
            <p className="mt-3 break-words text-sm font-semibold text-stone-800">{success.email}</p>
          )}
          <Link href={finished ? '/' : '/login'} className="btn-primary mt-8 w-full">
            {t(finished ? 'register.done.cta' : 'register.success.login')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(201,44,75,0.12),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(212,160,50,0.16),_transparent_40%)]"
      />

      <div className="container-page relative grid min-h-[calc(100dvh-8rem)] items-center gap-10 py-10 lg:grid-cols-2 lg:py-16">
        <section className="relative hidden overflow-hidden rounded-3xl bg-brand-900 px-10 py-12 text-white shadow-xl lg:flex lg:min-h-[640px] lg:flex-col lg:justify-between">
          <div
            aria-hidden
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(226,184,87,0.35) 0, transparent 32%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.12) 0, transparent 28%)',
            }}
          />
          <div className="relative">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">
              <Sparkles className="h-3.5 w-3.5" />
              {t('register.panel.kicker')}
            </p>
            <h1 className="mt-6 font-display text-4xl font-bold leading-tight">{t('register.panel.title')}</h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-brand-100">{t('register.panel.body')}</p>
          </div>

          <ul className="relative mt-12 space-y-4">
            {trust.map(({ icon: Icon, key }) => (
              <li key={key} className="flex items-center gap-3 text-sm text-brand-50">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10">
                  <Icon className="h-5 w-5 text-gold-400" aria-hidden />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </section>

        <section className="relative mx-auto w-full max-w-md">
          <div className="mb-6 text-center lg:hidden">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              <Heart className="h-3.5 w-3.5 fill-current" aria-hidden />
              {t('site.tagline')}
            </span>
          </div>

          <div className="card px-6 py-8 sm:px-8">
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold text-stone-900">{t('register.title')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{t('register.subtitle')}</p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="register-name" className="label">
                  {t('register.name')}
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="register-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('register.name.placeholder')}
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? 'register-name-error' : undefined}
                    className="input pl-11"
                  />
                </div>
                {fieldErrors.name && (
                  <p id="register-name-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.name}
                  </p>
                )}
              </div>

              <div>
                <span className="label">{t('register.forWhom')}</span>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('register.forWhom')}>
                  {forWhomOptions.map((option) => {
                    const active = forWhom === option
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setForWhom(option)}
                        className={[
                          'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                          active
                            ? 'border-brand-500 bg-brand-50 text-brand-800'
                            : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400',
                        ].join(' ')}
                      >
                        {forWhomLabels[option]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="register-email" className="label">
                  {t('register.email')}
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="register-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('register.email.placeholder')}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
                    className="input pl-11"
                  />
                </div>
                {fieldErrors.email && (
                  <p id="register-email-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="register-mobile" className="label">
                  {t('register.mobile')}
                </label>
                <div className="relative flex">
                  <span className="inline-flex items-center gap-1.5 rounded-l-xl border border-r-0 border-stone-300 bg-stone-50 px-3 text-sm font-medium text-stone-600">
                    <Phone className="h-3.5 w-3.5 text-stone-400" aria-hidden />
                    +91
                  </span>
                  <input
                    id="register-mobile"
                    name="mobile"
                    type="tel"
                    autoComplete="tel-national"
                    inputMode="numeric"
                    value={mobile}
                    onChange={(e) => setMobile(formatMobile(e.target.value))}
                    placeholder={t('register.mobile.placeholder')}
                    aria-invalid={Boolean(fieldErrors.mobile)}
                    aria-describedby={fieldErrors.mobile ? 'register-mobile-error' : undefined}
                    className="input rounded-l-none"
                    maxLength={11}
                  />
                </div>
                {fieldErrors.mobile && (
                  <p id="register-mobile-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.mobile}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="register-password" className="label">
                  {t('register.password')}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="register-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('register.password.placeholder')}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={
                      [fieldErrors.password ? 'register-password-error' : undefined, 'register-password-hint']
                        .filter(Boolean)
                        .join(' ')
                    }
                    className="input px-11"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p id="register-password-hint" className="mt-1.5 text-xs text-stone-500">
                  {t('register.password.hint')}
                </p>
                {fieldErrors.password && (
                  <p id="register-password-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="register-confirm" className="label">
                  {t('register.confirm')}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="register-confirm"
                    name="confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={t('register.confirm.placeholder')}
                    aria-invalid={Boolean(fieldErrors.confirm)}
                    aria-describedby={fieldErrors.confirm ? 'register-confirm-error' : undefined}
                    className="input pl-11"
                  />
                </div>
                {fieldErrors.confirm && (
                  <p id="register-confirm-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.confirm}
                  </p>
                )}
              </div>

              <div>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                    aria-invalid={Boolean(fieldErrors.terms)}
                    aria-describedby={fieldErrors.terms ? 'register-terms-error' : undefined}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>
                    {t('register.terms')}
                  </span>
                </label>
                {fieldErrors.terms && (
                  <p id="register-terms-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.terms}
                  </p>
                )}
              </div>

              {formError && (
                <div role="alert" className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
                  {formError}{' '}
                  {errorIsExisting && (
                    <Link href="/login" className="font-semibold underline underline-offset-2">
                      {t('register.login')}
                    </Link>
                  )}
                </div>
              )}

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? t('register.submitting') : t('register.submit')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-stone-600">
              {t('register.haveAccount')}{' '}
              <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
                {t('register.login')}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
