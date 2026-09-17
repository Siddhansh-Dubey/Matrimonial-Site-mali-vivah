'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Heart, IdCard, Lock, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { isSupabaseConfigured } from '@/lib/env'
import { lastTenDigits, loginSchema } from '@/lib/auth/login-schema'
import { signInWithMobile } from '@/app/login/actions'

/** Where "remember me" keeps the identifier the member actually used. */
const REMEMBER_KEY = 'mali-vivah:remember-identifier'
/** Pre-single-field key — read once, migrated, then dropped. */
const LEGACY_REMEMBER_KEY = 'mali-vivah:remember-email'

type FieldErrors = {
  identifier?: string
  password?: string
}

/**
 * Single sign-in form: ONE identifier (email ID *or* mobile number) + password.
 *
 * Which credential is used is decided by the identifier itself (see
 * `parseIdentifier`): an email goes straight to Supabase password auth, a
 * mobile number goes to the `signInWithMobile` server action, which resolves
 * the account behind `profiles.mobile` and authenticates it server-side — the
 * stored email never has to round-trip through the browser.
 */
export function LoginForm() {
  const { t } = useI18n()
  const router = useRouter()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_KEY)
    // Members who signed in before the single-field form existed still get
    // their address prefilled — then the legacy key is retired.
    const legacy = window.localStorage.getItem(LEGACY_REMEMBER_KEY)
    const prefill = saved ?? legacy
    if (prefill) {
      setIdentifier(prefill)
      setRemember(true)
    }
    if (legacy !== null) window.localStorage.removeItem(LEGACY_REMEMBER_KEY)
  }, [])

  const trust = useMemo(
    () => [
      { icon: ShieldCheck, key: 'login.trust.verified' },
      { icon: Lock, key: 'login.trust.private' },
      { icon: Users, key: 'login.trust.respect' },
    ],
    []
  )

  // A numeric keypad once the member starts typing a number; the email keypad
  // otherwise. One field, so no artificial "+91" prefix box.
  const identifierInputMode = /^[+\d]/.test(identifier.trim()) ? 'tel' : 'email'

  /** Store or clear the identifier the member actually signed in with. */
  function persistIdentifier(value: string | null) {
    if (remember && value) window.localStorage.setItem(REMEMBER_KEY, value)
    else window.localStorage.removeItem(REMEMBER_KEY)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setInfo(null)

    const parsed = loginSchema.safeParse({ identifier, password })
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'password') next.password = t('login.error.password')
        else next.identifier = t(issue.message === 'identifier-required' ? 'login.error.identifier' : 'login.error.invalid')
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

      const { credential } = parsed.data

      // Mobile sign-in: resolve + authenticate server-side so the stored email
      // is never exposed to the browser. Same generic failure as a bad email
      // login, so neither path can be used to enumerate accounts.
      if (credential.kind === 'mobile') {
        const result = await signInWithMobile(credential.value, parsed.data.password)
        if (!result.ok) {
          setFormError(t(result.error === 'unavailable' ? 'login.error.env' : 'login.error.generic'))
          return
        }
        persistIdentifier(credential.value)
        router.push('/profile')
        router.refresh()
        return
      }

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: credential.value,
        password: parsed.data.password,
      })

      if (error || !data.user) {
        setFormError(t('login.error.generic'))
        return
      }

      // Prefer the mobile stored in public.profiles; fall back to the auth
      // metadata for accounts created before the profiles table existed.
      const { data: profile } = await supabase
        .from('profiles')
        .select('mobile')
        .eq('id', data.user.id)
        .maybeSingle()

      const metaPhone =
        data.user.phone ||
        (typeof data.user.user_metadata?.phone === 'string' ? data.user.user_metadata.phone : '') ||
        (typeof data.user.user_metadata?.mobile === 'string' ? data.user.user_metadata.mobile : '')

      if (!profile) {
        // Self-heal: create the missing profile row for pre-migration accounts.
        // Insert WITHOUT the mobile first — profiles.mobile is UNIQUE, and a
        // phone already claimed by another account must not block row creation
        // (a missing profiles row is what later causes the
        // "matrimony_profiles_user_id_fkey" foreign key error). The mobile is
        // backfilled separately; a failure there is non-fatal.
        const metaName =
          typeof data.user.user_metadata?.full_name === 'string'
            ? data.user.user_metadata.full_name.trim().slice(0, 80)
            : ''
        const metaForWhom = data.user.user_metadata?.for_whom
        const { error: healError } = await supabase.from('profiles').insert({
          id: data.user.id,
          email: (data.user.email ?? credential.value).toLowerCase(),
          full_name: metaName.length >= 2 ? metaName : 'Mali Vivah Member',
          for_whom: metaForWhom === 'son' || metaForWhom === 'daughter' ? metaForWhom : 'self',
        })
        if (healError) {
          console.warn('[login] profile backfill skipped:', healError.message)
        } else {
          const healMobile = lastTenDigits(metaPhone)
          if (/^[6-9]\d{9}$/.test(healMobile)) {
            const { error: mobileError } = await supabase
              .from('profiles')
              .update({ mobile: healMobile })
              .eq('id', data.user.id)
            if (mobileError) {
              console.warn('[login] mobile backfill skipped:', mobileError.message)
            }
          }
        }
      } else if (!profile.mobile) {
        // Profile exists but has no mobile on record — fill it from the
        // sign-up metadata (never from typed input, to avoid lock-outs).
        const metaDigits = lastTenDigits(metaPhone)
        if (metaDigits) {
          const { error: healError } = await supabase
            .from('profiles')
            .update({ mobile: metaDigits })
            .eq('id', data.user.id)
          if (healError) {
            console.warn('[login] profile mobile backfill skipped:', healError.message)
          }
        }
      }

      // Audit the login (last_login_at / login_count / login_history row).
      // Non-fatal: a logging failure must never block a successful login.
      const { error: auditError } = await supabase.rpc('record_login')
      if (auditError) {
        console.warn('[login] record_login skipped:', auditError.message)
      }

      persistIdentifier(credential.value)

      router.push('/profile')
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
              <p className="mt-1.5 text-xs font-medium text-brand-700/80">{t('login.identifier.hint')}</p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="login-identifier" className="label">
                  {t('login.identifier')}
                </label>
                <div className="relative">
                  <IdCard className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input
                    id="login-identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    inputMode={identifierInputMode}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t('login.identifier.placeholder')}
                    aria-invalid={Boolean(fieldErrors.identifier)}
                    aria-describedby={fieldErrors.identifier ? 'login-identifier-error' : undefined}
                    className="input pl-11"
                    maxLength={254}
                  />
                </div>
                {fieldErrors.identifier ? (
                  <p id="login-identifier-error" className="mt-1.5 text-xs text-brand-700">
                    {fieldErrors.identifier}
                  </p>
                ) : null}
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
