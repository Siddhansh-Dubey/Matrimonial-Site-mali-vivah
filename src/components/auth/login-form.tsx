'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Heart, Lock, Mail, Phone, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { isSupabaseConfigured } from '@/lib/env'
import { lastTenDigits, loginSchema } from '@/lib/auth/login-schema'

type FieldErrors = {
  email?: string
  mobile?: string
  password?: string
}

function formatMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}

export function LoginForm() {
  const { t } = useI18n()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem('mali-vivah:remember-email')
    if (saved) {
      setEmail(saved)
      setRemember(true)
    }
  }, [])

  const trust = useMemo(
    () => [
      { icon: ShieldCheck, key: 'login.trust.verified' },
      { icon: Lock, key: 'login.trust.private' },
      { icon: Users, key: 'login.trust.respect' },
    ],
    []
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setInfo(null)

    const parsed = loginSchema.safeParse({ email, mobile, password })
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === 'email') next.email = t('login.error.email')
        if (field === 'mobile') next.mobile = t('login.error.mobile')
        if (field === 'password') next.password = t('login.error.password')
      }
      setFieldErrors(next)
      return
    }

    setFieldErrors({})
    setSubmitting(true)

    try {
      if (!isSupabaseConfigured) {
        setFormError(t('login.error.env'))
        return
      }

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      })

      if (error || !data.user) {
        setFormError(t('login.error.generic'))
        return
      }

      const storedPhone =
        data.user.phone ||
        (typeof data.user.user_metadata?.phone === 'string' ? data.user.user_metadata.phone : '') ||
        (typeof data.user.user_metadata?.mobile === 'string' ? data.user.user_metadata.mobile : '')

      const storedDigits = lastTenDigits(storedPhone)
      if (storedDigits && storedDigits !== parsed.data.mobile) {
        await supabase.auth.signOut()
        setFormError(t('login.error.mismatch'))
        return
      }

      if (remember) {
        window.localStorage.setItem('mali-vivah:remember-email', parsed.data.email)
      } else {
        window.localStorage.removeItem('mali-vivah:remember-email')
      }

      router.push('/')
      router.refresh()
    } catch {
      setFormError(t('login.error.generic'))
    } finally {
      setSubmitting(false)
    }
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
              {t('login.panel.kicker')}
            </p>
            <h1 className="mt-6 font-display text-4xl font-bold leading-tight">{t('login.panel.title')}</h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-brand-100">{t('login.panel.body')}</p>
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
              <h2 className="font-display text-3xl font-bold text-stone-900">{t('login.title')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{t('login.subtitle')}</p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="login-email" className="label">
                  {t('login.email')}
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.email.placeholder')}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                    className="input pl-11"
                  />
                </div>
                {fieldErrors.email && (
                  <p id="login-email-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="login-mobile" className="label">
                  {t('login.mobile')}
                </label>
                <div className="relative flex">
                  <span className="inline-flex items-center gap-1.5 rounded-l-xl border border-r-0 border-stone-300 bg-stone-50 px-3 text-sm font-medium text-stone-600">
                    <Phone className="h-3.5 w-3.5 text-stone-400" aria-hidden />
                    +91
                  </span>
                  <input
                    id="login-mobile"
                    name="mobile"
                    type="tel"
                    autoComplete="tel-national"
                    inputMode="numeric"
                    value={mobile}
                    onChange={(e) => setMobile(formatMobile(e.target.value))}
                    placeholder={t('login.mobile.placeholder')}
                    aria-invalid={Boolean(fieldErrors.mobile)}
                    aria-describedby={fieldErrors.mobile ? 'login-mobile-error' : undefined}
                    className="input rounded-l-none"
                    maxLength={11}
                  />
                </div>
                {fieldErrors.mobile && (
                  <p id="login-mobile-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.mobile}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="login-password" className="label">
                  {t('login.password')}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.password.placeholder')}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
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
                {fieldErrors.password && (
                  <p id="login-password-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
                  />
                  {t('login.remember')}
                </label>
                <button
                  type="button"
                  className="text-sm font-medium text-brand-700 hover:text-brand-800"
                  onClick={() => setInfo(t('login.forgot.hint'))}
                >
                  {t('login.forgot')}
                </button>
              </div>

              {formError && (
                <p role="alert" className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
                  {formError}
                </p>
              )}
              {info && !formError && (
                <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {info}
                </p>
              )}

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? t('login.submitting') : t('login.submit')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-stone-600">
              {t('login.noAccount')}{' '}
              <Link href="/register" className="font-semibold text-brand-700 hover:text-brand-800">
                {t('login.register')}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
