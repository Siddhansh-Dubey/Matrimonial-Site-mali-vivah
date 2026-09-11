'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Heart,
  ImagePlus,
  Loader2,
  Sparkles,
  Star,
  User,
  Users,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { isSupabaseConfigured } from '@/lib/env'
import { createClient } from '@/lib/supabase/client'
import { photoUrl } from '@/lib/profile/photos'
import {
  aboutSchema,
  educationSchema,
  personalSchema,
  preferencesSchema,
  AGE_OPTIONS,
  cityOptions,
  dietOptions,
  educationOptions,
  genderOptions,
  HOBBY_OPTIONS,
  incomeOptions,
  maritalStatusOptions,
  motherTongueOptions,
  occupationOptions,
  subCommunityOptions,
  type AboutInput,
  type EducationInput,
  type PersonalInput,
  type PreferencesInput,
} from '@/lib/profile/profile-schema'
import type {
  Diet,
  Gender,
  MaritalStatus,
  MatrimonyProfile,
  PartnerPreferences,
} from '@/lib/supabase/database.types'

const STEPS = ['basic', 'education', 'about', 'preferences', 'photos'] as const
type Step = (typeof STEPS)[number]

type Errors = Record<string, string | undefined>

/* ------------------------- resume-where-you-left ------------------------- */

type WizardProgress = { completed: Step[]; lastStep: Step }

function progressKey(userId: string): string {
  return `mv-wizard-progress-${userId}`
}

function loadProgress(userId: string): WizardProgress | null {
  try {
    const raw = window.localStorage.getItem(progressKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as WizardProgress
    if (!parsed || !Array.isArray(parsed.completed)) return null
    const completed = parsed.completed.filter((s): s is Step =>
      (STEPS as readonly string[]).includes(s)
    )
    const lastStep = (STEPS as readonly string[]).includes(parsed.lastStep)
      ? parsed.lastStep
      : 'basic'
    return { completed, lastStep }
  } catch {
    return null
  }
}

function saveProgress(userId: string, progress: WizardProgress): void {
  try {
    window.localStorage.setItem(progressKey(userId), JSON.stringify(progress))
  } catch {
    // storage unavailable (private mode) — resume simply falls back to data inference
  }
}

function basicIncomplete(profile: MatrimonyProfile | null): boolean {
  if (!profile) return true
  return !profile.gender || !profile.date_of_birth || !profile.city
}

function educationIncomplete(profile: MatrimonyProfile | null): boolean {
  if (!profile) return true
  return !profile.education || !profile.occupation
}

/**
 * First step the user still needs to complete.
 * 1. Stored progress (steps already clicked through) wins — resume at the first
 *    step NOT in `completed`.
 * 2. Otherwise infer from the saved data: basic → education → about → photos.
 * 3. A fully-completed / published profile resumes at `basic` so every section
 *    can be reviewed and edited.
 */
function getResumeStep(
  profile: MatrimonyProfile | null,
  stored: WizardProgress | null
): Step {
  if (stored && stored.completed.length > 0) {
    const next = STEPS.find((s) => !stored.completed.includes(s))
    // All steps done before → start at the beginning for editing.
    return next ?? 'basic'
  }
  if (basicIncomplete(profile)) return 'basic'
  if (educationIncomplete(profile)) return 'education'
  if (profile?.status === 'active') return 'basic'
  return 'about'
}

function label(option: string): string {
  return option
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ProfileWizard() {
  const { t } = useI18n()
  const router = useRouter()

  const [ready, setReady] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [existing, setExisting] = useState<MatrimonyProfile | null>(null)
  const [prefs, setPrefs] = useState<PartnerPreferences | null>(null)

  const [step, setStep] = useState<Step>('basic')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<Step[]>([])

  // personal
  const [gender, setGender] = useState<Gender>('male')
  const [profileFor, setProfileFor] = useState<'self' | 'son' | 'daughter'>('self')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus>('never_married')
  const [diet, setDiet] = useState<Diet>('vegetarian')
  const [motherTongue, setMotherTongue] = useState('Marathi')
  const [subCommunity, setSubCommunity] = useState('Mali')
  const [gotra, setGotra] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('Maharashtra')

  // education
  const [education, setEducation] = useState('')
  const [educationDetails, setEducationDetails] = useState('')
  const [occupation, setOccupation] = useState('')
  const [annualIncome, setAnnualIncome] = useState('')

  // about
  const [aboutMe, setAboutMe] = useState('')
  const [hobbies, setHobbies] = useState<string[]>([])

  // preferences
  const [preferredGender, setPreferredGender] = useState<Gender>('female')
  const [minAge, setMinAge] = useState('21')
  const [maxAge, setMaxAge] = useState('35')
  const [minHeightCm, setMinHeightCm] = useState('')
  const [maxHeightCm, setMaxHeightCm] = useState('')
  const [preferredCities, setPreferredCities] = useState<string[]>([])
  const [preferredSubCommunities, setPreferredSubCommunities] = useState<string[]>([])
  const [preferredEducation, setPreferredEducation] = useState('')
  const [preferredOccupation, setPreferredOccupation] = useState('')
  const [preferredDiet, setPreferredDiet] = useState<Diet>('vegetarian')
  const [preferredMaritalStatus, setPreferredMaritalStatus] = useState<MaritalStatus>('never_married')
  const [prefNote, setPrefNote] = useState('')

  // photos
  const [photos, setPhotos] = useState<{ id: number; path: string; primary: boolean }[]>([])
  const [primaryPath, setPrimaryPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  // ---- load existing profile ----
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!isSupabaseConfigured) {
        setConfigured(false)
        setReady(true)
        return
      }
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      const uid = data.user?.id ?? null
      if (cancelled) return
      setUserId(uid)

      if (uid) {
        const [mp, pp, ph] = await Promise.all([
          supabase.from('matrimony_profiles').select('*').eq('user_id', uid).maybeSingle(),
          supabase.from('partner_preferences').select('*').eq('profile_id', uid).maybeSingle(),
          supabase.from('profile_photos').select('*').eq('profile_id', uid).order('sort_order', { ascending: true }),
        ])
        if (cancelled) return
        const profile = mp.data as MatrimonyProfile | null
        setExisting(profile)
        const prefRow = pp.data as PartnerPreferences | null
        setPrefs(prefRow)
        const photoRows = ph.data ?? []
        setPhotos(photoRows.map((p) => ({ id: p.id, path: p.storage_path, primary: p.is_primary })))
        const prim = photoRows.find((p) => p.is_primary)?.storage_path ?? photoRows[0]?.storage_path ?? null
        setPrimaryPath(prim)

        if (profile) {
          setProfileFor(profile.profile_for)
          setGender(profile.gender ?? 'male')
          setDateOfBirth(profile.date_of_birth ?? '')
          setHeightCm(profile.height_cm ? String(profile.height_cm) : '')
          setMaritalStatus(profile.marital_status)
          setDiet(profile.diet)
          setMotherTongue(profile.mother_tongue)
          setSubCommunity(profile.sub_community ?? 'Mali')
          setGotra(profile.gotra ?? '')
          setCity(profile.city ?? '')
          setState(profile.state)
          setEducation(profile.education ?? '')
          setEducationDetails(profile.education_details ?? '')
          setOccupation(profile.occupation ?? '')
          setAnnualIncome(profile.annual_income ?? '')
          setAboutMe(profile.about_me ?? '')
          setHobbies(profile.hobbies ?? [])
        }
        if (prefRow) {
          setPreferredGender(prefRow.preferred_gender)
          setMinAge(String(prefRow.min_age))
          setMaxAge(String(prefRow.max_age))
          setMinHeightCm(prefRow.min_height_cm ? String(prefRow.min_height_cm) : '')
          setMaxHeightCm(prefRow.max_height_cm ? String(prefRow.max_height_cm) : '')
          setPreferredCities(prefRow.preferred_cities ?? [])
          setPreferredSubCommunities(prefRow.preferred_sub_communities ?? [])
          setPreferredEducation(prefRow.preferred_education ?? '')
          setPreferredOccupation(prefRow.preferred_occupation ?? '')
          setPreferredDiet(prefRow.preferred_diet ?? 'vegetarian')
          setPreferredMaritalStatus(prefRow.preferred_marital_status ?? 'never_married')
          setPrefNote(prefRow.note ?? '')
        }

        // ---- resume where the user left off ----
        const stored = loadProgress(uid)
        if (stored) setCompletedSteps(stored.completed)
        const resume = getResumeStep(profile, stored)
        setStep(resume)
        if (resume !== 'basic') setResumed(true)
      }
      setReady(true)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const stepIndex = STEPS.indexOf(step)

  function setFieldErrors(next: Errors) {
    setErrors(next)
  }

  // ---- persistence ----
  async function saveProfile(publish: boolean): Promise<boolean> {
    if (!userId) {
      setFormError(t('profile.error.notSignedIn'))
      return false
    }
    const supabase = createClient()

    // Safety net: guarantees our account row (public.profiles) and the draft
    // matrimony rows exist BEFORE we write. Accounts can silently be missing
    // them (e.g. sign-up with a mobile already claimed by another member),
    // and a missing profiles row is exactly what trips the
    // "matrimony_profiles_user_id_fkey" foreign key error. Non-fatal: if the
    // RPC is not installed yet (schema not updated), we simply continue and
    // let the upsert below behave as before.
    const { error: ensureError } = await supabase.rpc('ensure_my_profile')
    if (ensureError) {
      console.warn('[profile] ensure_my_profile skipped:', ensureError.message)
    }

    const mpPayload = {
      user_id: userId,
      profile_for: profileFor,
      gender,
      date_of_birth: dateOfBirth || null,
      height_cm: heightCm ? Number(heightCm) : null,
      marital_status: maritalStatus,
      diet,
      mother_tongue: motherTongue,
      sub_community: subCommunity,
      gotra: gotra || null,
      city,
      state,
      education,
      education_details: educationDetails || null,
      occupation,
      annual_income: annualIncome || null,
      about_me: aboutMe || null,
      hobbies,
      status: publish ? 'active' : 'draft',
    } as const

    const ppPayload = {
      profile_id: userId,
      preferred_gender: preferredGender,
      min_age: Number(minAge) || 21,
      max_age: Number(maxAge) || 35,
      min_height_cm: minHeightCm ? Number(minHeightCm) : null,
      max_height_cm: maxHeightCm ? Number(maxHeightCm) : null,
      preferred_cities: preferredCities,
      preferred_sub_communities: preferredSubCommunities,
      preferred_education: preferredEducation || null,
      preferred_occupation: preferredOccupation || null,
      preferred_diet: preferredDiet,
      preferred_marital_status: preferredMaritalStatus,
      note: prefNote || null,
    } as const

    const { error: mpError } = await supabase
      .from('matrimony_profiles')
      .upsert(mpPayload, { onConflict: 'user_id' })
    if (mpError) {
      setFormError(mpError.message)
      return false
    }
    const { error: ppError } = await supabase
      .from('partner_preferences')
      .upsert(ppPayload, { onConflict: 'profile_id' })
    if (ppError) {
      setFormError(ppError.message)
      return false
    }
    return true
  }

  // ---- step navigation ----
  function validateStep(s: Step): boolean {
    const next: Errors = {}
    if (s === 'basic') {
      const r = personalSchema.safeParse({
        gender,
        profileFor,
        dateOfBirth,
        heightCm: heightCm || undefined,
        maritalStatus,
        diet,
        motherTongue,
        subCommunity,
        gotra,
        city,
        state,
      })
      if (!r.success) {
        for (const issue of r.error.issues) {
          next[issue.path[0] as string] = issue.message
        }
      }
    } else if (s === 'education') {
      const r = educationSchema.safeParse({ education, educationDetails, occupation, annualIncome })
      if (!r.success) {
        for (const issue of r.error.issues) next[issue.path[0] as string] = issue.message
      }
    } else if (s === 'about') {
      const r = aboutSchema.safeParse({ aboutMe, hobbies })
      if (!r.success) for (const issue of r.error.issues) next[issue.path[0] as string] = issue.message
    } else if (s === 'preferences') {
      const r = preferencesSchema.safeParse({
        preferredGender,
        minAge,
        maxAge,
        minHeightCm: minHeightCm || undefined,
        maxHeightCm: maxHeightCm || undefined,
        preferredCities,
        preferredSubCommunities,
        preferredEducation,
        preferredOccupation,
        preferredDiet,
        preferredMaritalStatus,
        note: prefNote,
      })
      if (!r.success) for (const issue of r.error.issues) next[issue.path[0] as string] = issue.message
    }
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  function persistProgress(nextCompleted: Step[], lastStep: Step) {
    setCompletedSteps(nextCompleted)
    if (userId) saveProgress(userId, { completed: nextCompleted, lastStep })
  }

  function markComplete(s: Step): Step[] {
    const next = completedSteps.includes(s) ? completedSteps : [...completedSteps, s]
    return next
  }

  async function goNext() {
    setFormError(null)
    if (!validateStep(step)) return
    setSaving(true)
    // Persist progress as a draft on every step (except the final submit).
    const ok = await saveProfile(false)
    setSaving(false)
    if (!ok) return
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) {
      const nextStep = STEPS[idx + 1]
      persistProgress(markComplete(step), nextStep)
      setStep(nextStep)
    }
  }

  async function goBack() {
    setFormError(null)
    const idx = STEPS.indexOf(step)
    if (idx > 0) {
      const prev = STEPS[idx - 1]
      persistProgress(completedSteps, prev)
      setStep(prev)
    }
  }

  /** Jump via the stepper — saves the current draft first so nothing is lost. */
  async function jumpTo(target: Step) {
    if (target === step || saving) return
    setFormError(null)
    setSaving(true)
    const ok = await saveProfile(false)
    setSaving(false)
    if (!ok) return
    persistProgress(completedSteps, target)
    setErrors({})
    setStep(target)
  }

  async function onPublish(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    // A publish must satisfy EVERY required section, not just preferences —
    // otherwise incomplete profiles would go live on Brides/Grooms pages.
    if (!validateStep('basic')) {
      setStep('basic')
      setFormError('Please complete the Basic details section before publishing.')
      return
    }
    if (!validateStep('education')) {
      setStep('education')
      setFormError('Please complete the Education & career section before publishing.')
      return
    }
    if (!validateStep('preferences')) {
      setStep('preferences')
      return
    }
    setSaving(true)
    const ok = await saveProfile(true)
    setSaving(false)
    if (ok) {
      if (userId) saveProgress(userId, { completed: [...STEPS], lastStep: 'photos' })
      router.push('/profile?published=1')
      router.refresh()
    }
  }

  // ---- photo upload ----
  async function onUpload(file: File) {
    if (!userId || !isSupabaseConfigured) return
    setFormError(null)
    setUploading(true)
    try {
      const supabase = createClient()
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const path = `${userId}/${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from('profile-photos').upload(path, file, { upsert: false })
      if (error) {
        // Storage enforces its own RLS on storage.objects (independent of the
        // profile_photos table policies). This exact message means the write
        // policies have not been installed on the project yet.
        const hint = /row-level security/i.test(error.message)
          ? ' — the photo storage policies are missing on the database. Run supabase/migrations/20260911130000_photo_storage_policies.sql in the Supabase SQL Editor, then try again.'
          : ''
        setFormError(`[photo] ${error.message}${hint}`)
        return
      }
      const isFirst = photos.length === 0
      const { data, error: insertError } = await supabase
        .from('profile_photos')
        .insert({ profile_id: userId, storage_path: path, is_primary: isFirst, sort_order: photos.length })
        .select()
        .single()
      if (insertError) {
        // Don't leave an orphaned object in Storage when the DB row failed.
        await supabase.storage.from('profile-photos').remove([path])
        setFormError(`[photo] ${insertError.message}`)
        return
      }
      setPhotos((prev) => [...prev, { id: data.id, path: data.storage_path, primary: data.is_primary }])
      if (isFirst) setPrimaryPath(data.storage_path)
    } finally {
      setUploading(false)
    }
  }

  async function onSetPrimary(path: string) {
    if (!userId) return
    const supabase = createClient()
    await supabase.from('profile_photos').update({ is_primary: false }).eq('profile_id', userId)
    await supabase.from('profile_photos').update({ is_primary: true }).eq('profile_id', userId).eq('storage_path', path)
    setPhotos((prev) => prev.map((p) => ({ ...p, primary: p.path === path })))
    setPrimaryPath(path)
  }

  async function onRemovePhoto(p: { id: number; path: string; primary: boolean }) {
    if (!userId) return
    const supabase = createClient()
    await supabase.from('profile_photos').delete().eq('id', p.id)
    await supabase.storage.from('profile-photos').remove([p.path])
    const remaining = photos.filter((x) => x.id !== p.id)
    setPhotos(remaining)
    if (p.primary) {
      const next = remaining[0] ?? null
      setPrimaryPath(next?.path ?? null)
      if (next) await onSetPrimary(next.path)
    }
  }

  // ---- render ----
  if (!ready) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    )
  }

  if (!configured) {
    return (
      <section className="bg-cream">
        <div className="container-page mx-auto max-w-2xl py-24 text-center">
          <h1 className="font-display text-3xl font-bold text-ink">{t('profile.error.envTitle')}</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-stone-600">{t('profile.error.env')}</p>
          <Link href="/" className="btn-secondary mt-8">
            {t('nav.home')}
          </Link>
        </div>
      </section>
    )
  }

  const stepTitles: Record<Step, { icon: typeof User; title: string }> = {
    basic: { icon: User, title: t('profile.step.basic.title') },
    education: { icon: BookOpen, title: t('profile.step.education.title') },
    about: { icon: Heart, title: t('profile.step.about.title') },
    preferences: { icon: Users, title: t('profile.step.preferences.title') },
    photos: { icon: ImagePlus, title: t('profile.step.photos.title') },
  }

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        {/* heading */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            {t('profile.kicker')}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon">{t('profile.title')}</h1>
          <p className="mt-3 text-sm text-stone-600 sm:text-base">{t('profile.subtitle')}</p>
        </div>

        {resumed && (
          <p className="mx-auto mt-6 max-w-2xl rounded-2xl border border-gold-400/50 bg-gold-100/60 px-5 py-3 text-center text-[13px] font-medium text-maroon-deep">
            Welcome back — we&apos;ve resumed where you left off (
            {t(`profile.step.${step}.label`)}). Use the steps below to jump anywhere.
          </p>
        )}

        {/* stepper — clickable so any section can be revisited while editing */}
        <ol className="mx-auto mt-9 flex max-w-3xl items-center justify-between">
          {STEPS.map((s, i) => {
            const done = i < stepIndex || completedSteps.includes(s)
            const active = i === stepIndex
            const { icon: Icon } = stepTitles[s]
            return (
              <li key={s} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => jumpTo(s)}
                  title={t(`profile.step.${s}.title`)}
                  className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-1 outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <span
                    className={[
                      'grid h-10 w-10 place-items-center rounded-full ring-1 transition-colors',
                      done && !active
                        ? 'bg-gold-400 text-maroon-deep ring-gold-500'
                        : active
                          ? 'bg-maroon text-white ring-maroon'
                          : 'bg-white text-stone-400 ring-stone-200',
                    ].join(' ')}
                  >
                    {done && !active ? <Check className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span
                    className={[
                      'hidden text-[11px] font-semibold uppercase tracking-wide sm:block',
                      active ? 'text-maroon' : 'text-stone-500',
                    ].join(' ')}
                  >
                    {t(`profile.step.${s}.label`)}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span
                    className={['mx-2 mb-5 h-px flex-1 sm:mb-6', done ? 'bg-gold-500' : 'bg-stone-200'].join(' ')}
                    aria-hidden
                  />
                )}
              </li>
            )
          })}
        </ol>

        {/* card */}
        <form className="card mx-auto mt-8 max-w-2xl px-6 py-8 sm:px-10" onSubmit={(e) => e.preventDefault()}>
          {step === 'basic' && (
            <div className="space-y-5">
              <Field label={t('profile.gender')} error={errors.gender}>
                <div className="grid grid-cols-2 gap-2">
                  {genderOptions.map((g) => (
                    <Toggle key={g} active={gender === g} onClick={() => setGender(g)}>
                      {t(`profile.gender.${g}`)}
                    </Toggle>
                  ))}
                </div>
              </Field>

              <Field label={t('profile.profileFor')} error={errors.profileFor}>
                <div className="grid grid-cols-3 gap-2">
                  {(['self', 'son', 'daughter'] as const).map((f) => (
                    <Toggle key={f} active={profileFor === f} onClick={() => setProfileFor(f)}>
                      {t(`register.for${f[0].toUpperCase()}${f.slice(1)}`)}
                    </Toggle>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.dateOfBirth')} error={errors.dateOfBirth}>
                  <input
                    type="date"
                    value={dateOfBirth}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label={t('profile.heightCm')} error={errors.heightCm}>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="165"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    className="input"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.maritalStatus')}>
                  <Select value={maritalStatus} onChange={(v) => setMaritalStatus(v as MaritalStatus)} options={maritalStatusOptions} />
                </Field>
                <Field label={t('profile.diet')}>
                  <Select value={diet} onChange={(v) => setDiet(v as Diet)} options={dietOptions} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.motherTongue')} error={errors.motherTongue}>
                  <Select value={motherTongue} onChange={setMotherTongue} options={motherTongueOptions} />
                </Field>
                <Field label={t('profile.subCommunity')} error={errors.subCommunity}>
                  <Select value={subCommunity} onChange={setSubCommunity} options={subCommunityOptions} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.city')} error={errors.city}>
                  <Select value={city} onChange={setCity} options={cityOptions} allowEmpty />
                </Field>
                <Field label={t('profile.state')} error={errors.state}>
                  <input value={state} onChange={(e) => setState(e.target.value)} className="input" />
                </Field>
              </div>

              <Field label={t('profile.gotra')} hint={t('profile.gotra.hint')}>
                <input value={gotra} onChange={(e) => setGotra(e.target.value)} className="input" placeholder={t('profile.gotra.placeholder')} />
              </Field>
            </div>
          )}

          {step === 'education' && (
            <div className="space-y-5">
              <Field label={t('profile.education')} error={errors.education}>
                <Select value={education} onChange={setEducation} options={educationOptions} allowEmpty />
              </Field>
              <Field label={t('profile.educationDetails')} hint={t('profile.educationDetails.hint')}>
                <input
                  value={educationDetails}
                  onChange={(e) => setEducationDetails(e.target.value)}
                  className="input"
                  placeholder={t('profile.educationDetails.placeholder')}
                />
              </Field>
              <Field label={t('profile.occupation')} error={errors.occupation}>
                <Select value={occupation} onChange={setOccupation} options={occupationOptions} allowEmpty />
              </Field>
              <Field label={t('profile.annualIncome')}>
                <Select value={annualIncome} onChange={setAnnualIncome} options={incomeOptions} allowEmpty />
              </Field>
            </div>
          )}

          {step === 'about' && (
            <div className="space-y-5">
              <Field label={t('profile.aboutMe')} hint={t('profile.aboutMe.hint')}>
                <textarea
                  rows={5}
                  value={aboutMe}
                  maxLength={1000}
                  onChange={(e) => setAboutMe(e.target.value)}
                  className="input resize-none"
                  placeholder={t('profile.aboutMe.placeholder')}
                />
              </Field>
              <Field label={t('profile.hobbies')} hint={t('profile.hobbies.hint')}>
                <div className="flex flex-wrap gap-2">
                  {HOBBY_OPTIONS.map((h) => {
                    const active = hobbies.includes(h)
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() =>
                          setHobbies((prev) => (active ? prev.filter((x) => x !== h) : [...prev, h]))
                        }
                        className={[
                          'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                          active
                            ? 'border-brand-500 bg-brand-50 text-brand-800'
                            : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400',
                        ].join(' ')}
                      >
                        {label(h)}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
          )}

          {step === 'preferences' && (
            <div className="space-y-5">
              <Field label={t('profile.pref.gender')}>
                <div className="grid grid-cols-2 gap-2">
                  {genderOptions.map((g) => (
                    <Toggle key={g} active={preferredGender === g} onClick={() => setPreferredGender(g)}>
                      {t(`profile.gender.${g}`)}
                    </Toggle>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.pref.minAge')} error={errors.minAge}>
                  <Select value={minAge} onChange={setMinAge} options={AGE_OPTIONS.map(String)} />
                </Field>
                <Field label={t('profile.pref.maxAge')} error={errors.maxAge}>
                  <Select value={maxAge} onChange={setMaxAge} options={AGE_OPTIONS.map(String)} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.pref.minHeight')}>
                  <input type="number" value={minHeightCm} onChange={(e) => setMinHeightCm(e.target.value)} className="input" placeholder="150" />
                </Field>
                <Field label={t('profile.pref.maxHeight')}>
                  <input type="number" value={maxHeightCm} onChange={(e) => setMaxHeightCm(e.target.value)} className="input" placeholder="185" />
                </Field>
              </div>

              <Field label={t('profile.pref.cities')}>
                <MultiSelect options={[...cityOptions]} selected={preferredCities} onChange={setPreferredCities} />
              </Field>

              <Field label={t('profile.pref.subCommunities')}>
                <MultiSelect options={[...subCommunityOptions]} selected={preferredSubCommunities} onChange={setPreferredSubCommunities} />
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.pref.education')}>
                  <Select value={preferredEducation} onChange={setPreferredEducation} options={educationOptions} allowEmpty />
                </Field>
                <Field label={t('profile.pref.occupation')}>
                  <Select value={preferredOccupation} onChange={setPreferredOccupation} options={occupationOptions} allowEmpty />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.pref.diet')}>
                  <Select value={preferredDiet} onChange={(v) => setPreferredDiet(v as Diet)} options={dietOptions} />
                </Field>
                <Field label={t('profile.pref.maritalStatus')}>
                  <Select value={preferredMaritalStatus} onChange={(v) => setPreferredMaritalStatus(v as MaritalStatus)} options={maritalStatusOptions} />
                </Field>
              </div>

              <Field label={t('profile.pref.note')}>
                <textarea rows={3} value={prefNote} maxLength={500} onChange={(e) => setPrefNote(e.target.value)} className="input resize-none" />
              </Field>
            </div>
          )}

          {step === 'photos' && (
            <div className="space-y-5">
              <p className="text-sm text-stone-600">{t('profile.photos.hint')}</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {photos.map((p) => (
                  <div key={p.id} className="relative overflow-hidden rounded-xl ring-1 ring-stone-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(p.path) ?? ''} alt="" className="aspect-square w-full object-cover" />
                    {p.primary && (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-gold-400 px-2 py-0.5 text-[10px] font-bold text-maroon-deep">
                        <Star className="h-3 w-3 fill-current" /> {t('profile.photos.primary')}
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/40 p-1.5">
                      {!p.primary && (
                        <button type="button" onClick={() => onSetPrimary(p.path)} className="flex-1 rounded bg-white/90 px-1 py-1 text-[11px] font-semibold text-stone-800">
                          {t('profile.photos.setPrimary')}
                        </button>
                      )}
                      <button type="button" onClick={() => onRemovePhoto(p)} className="rounded bg-white/90 px-2 py-1 text-[11px] font-semibold text-brand-700">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 text-stone-400 hover:border-brand-400 hover:text-brand-600">
                  {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                  <span className="px-3 text-center text-[11px] font-medium">{t('profile.photos.add')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onUpload(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">{t('profile.photos.reviewNote')}</div>
            </div>
          )}

          {/* error */}
          {formError && (
            <p role="alert" className="mt-6 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
              {formError}
            </p>
          )}

          {/* footer nav */}
          <div className="mt-8 flex items-center justify-between border-t border-stone-100 pt-6">
            <button type="button" onClick={goBack} disabled={stepIndex === 0 || saving} className="btn-secondary disabled:opacity-40">
              <ArrowLeft className="h-4 w-4" /> {t('profile.back')}
            </button>

            {step === 'photos' ? (
              <button type="button" onClick={onPublish} disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t('profile.publish')}
              </button>
            ) : (
              <button type="button" onClick={goNext} disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('profile.next')} <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-stone-500">{t('profile.footnote')}</p>
      </div>
    </section>
  )
}

/* ------------------------------- primitives ------------------------------- */

function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string
  children: React.ReactNode
  error?: string
  hint?: string
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-stone-500">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-brand-700">{error}</p>}
    </div>
  )
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Select({
  value,
  onChange,
  options,
  allowEmpty = false,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  allowEmpty?: boolean
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      {allowEmpty && <option value="">—</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  )
}

function MultiSelect({
  options,
  selected,
  onChange,
}: {
  options: readonly string[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(active ? selected.filter((x) => x !== o) : [...selected, o])}
            className={[
              'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
              active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400',
            ].join(' ')}
          >
            {label(o)}
          </button>
        )
      })}
    </div>
  )
}
