'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Heart,
  Home,
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
  loadCommunityHierarchy,
  resolveProfileCommunity,
  subCommunitiesOf,
  type CommunityHierarchy,
} from '@/lib/profile/community'
import {
  aboutSchema,
  educationSchema,
  familySchema,
  personalSchema,
  preferencesSchema,
  AGE_OPTIONS,
  cityOptions,
  dietOptions,
  educationOptions,
  familyTypeOptions,
  genderOptions,
  HOBBY_OPTIONS,
  incomeOptions,
  lifestyleOptions,
  maritalStatusOptions,
  motherTongueOptions,
  occupationOptions,
  type AboutInput,
  type EducationInput,
  type FamilyInput,
  type PersonalInput,
  type PreferencesInput,
} from '@/lib/profile/profile-schema'
import type {
  Diet,
  FamilyType,
  Gender,
  LifestyleChoice,
  MaritalStatus,
  MatrimonyProfile,
  PartnerPreferences,
  PlatinumLaunchState,
} from '@/lib/supabase/database.types'

const STEPS = ['basic', 'education', 'about', 'family', 'preferences', 'photos'] as const
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
  // Platinum Launch Offer — the server-authoritative claim result, if the
  // save just completed the profile (first-100 grant or 24h demo). The
  // browser never decides eligibility: claim_platinum_launch_offer() does.
  const [launchOffer, setLaunchOffer] = useState<PlatinumLaunchState | null>(null)
  const launchRef = useRef<PlatinumLaunchState | null>(null)
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
  // Community hierarchy — the selected DB rows are the source of truth;
  // the display name (legacy `sub_community` text) is DERIVED from them.
  const [communityId, setCommunityId] = useState('')
  const [subCommunityId, setSubCommunityId] = useState('')
  const [gotra, setGotra] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('Maharashtra')
  const [country, setCountry] = useState('India')
  const [nativePlace, setNativePlace] = useState('')

  // education / career
  const [education, setEducation] = useState('')
  const [educationDetails, setEducationDetails] = useState('')
  const [occupation, setOccupation] = useState('')
  const [company, setCompany] = useState('')
  // Separate from `company`: employees fill company (the employer), business
  // owners fill businessName. Either, both or neither — both are optional.
  const [businessName, setBusinessName] = useState('')
  const [annualIncome, setAnnualIncome] = useState('')

  // about
  const [aboutMe, setAboutMe] = useState('')
  const [hobbies, setHobbies] = useState<string[]>([])
  const [smoking, setSmoking] = useState<LifestyleChoice>('never')
  const [drinking, setDrinking] = useState<LifestyleChoice>('never')

  // family
  const [fatherOccupation, setFatherOccupation] = useState('')
  const [motherOccupation, setMotherOccupation] = useState('')
  const [siblings, setSiblings] = useState('')
  const [familyType, setFamilyType] = useState<FamilyType>('joint')
  const [familyLocation, setFamilyLocation] = useState('')
  const [familyDetails, setFamilyDetails] = useState('')

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
  const [preferredIncome, setPreferredIncome] = useState('')
  const [preferredDiet, setPreferredDiet] = useState<Diet>('vegetarian')
  const [preferredMaritalStatus, setPreferredMaritalStatus] = useState<MaritalStatus>('never_married')
  const [preferredNativePlace, setPreferredNativePlace] = useState('')
  const [preferredFamilyType, setPreferredFamilyType] = useState<'' | FamilyType>('')
  const [prefNote, setPrefNote] = useState('')

  // Community hierarchy — loaded from public.communities / sub_communities
  // (active rows, sort_order preserved). No hard-coded fallback: if the
  // lookup fails the selectors show an explicit error state instead.
  const [hierarchy, setHierarchy] = useState<CommunityHierarchy>({
    communities: [],
    subCommunities: [],
    error: null,
  })
  const availableSubCommunities = subCommunitiesOf(hierarchy, communityId || null)
  const selectedCommunity = hierarchy.communities.find((c) => c.id === communityId) ?? null
  // The display name (legacy `sub_community` text) is DERIVED from this row
  // at save time — never an independent source of truth.
  const selectedSubCommunity = availableSubCommunities.find((s) => s.id === subCommunityId) ?? null

  // photos — profile photos and (separately) the ONE family photo. The
  // publish gate requires both blocks before a profile can go live.
  const [photos, setPhotos] = useState<{ id: number; path: string; primary: boolean }[]>([])
  const [familyPhoto, setFamilyPhoto] = useState<{ id: number; path: string } | null>(null)
  const [primaryPath, setPrimaryPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'profile_photo' | 'family_photo' | null>(null)

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
        const [mp, pp, ph, tree] = await Promise.all([
          supabase.from('matrimony_profiles').select('*').eq('user_id', uid).maybeSingle(),
          supabase.from('partner_preferences').select('*').eq('profile_id', uid).maybeSingle(),
          supabase.from('profile_photos').select('*').eq('profile_id', uid).order('sort_order', { ascending: true }),
          loadCommunityHierarchy(supabase),
        ])
        if (cancelled) return
        setHierarchy(tree)
        const profile = mp.data as MatrimonyProfile | null
        setExisting(profile)
        const prefRow = pp.data as PartnerPreferences | null
        setPrefs(prefRow)
        const photoRows = ph.data ?? []
        const asKind = (p: (typeof photoRows)[number]): 'profile_photo' | 'family_photo' =>
          (p as { kind?: string }).kind === 'family_photo' ? 'family_photo' : 'profile_photo'
        const profileRows = photoRows.filter((p) => asKind(p) === 'profile_photo')
        const familyRow = photoRows.find((p) => asKind(p) === 'family_photo')
        setPhotos(profileRows.map((p) => ({ id: p.id, path: p.storage_path, primary: p.is_primary })))
        setFamilyPhoto(familyRow ? { id: familyRow.id, path: familyRow.storage_path } : null)
        const prim = profileRows.find((p) => p.is_primary)?.storage_path ?? profileRows[0]?.storage_path ?? null
        setPrimaryPath(prim)

        if (profile) {
          setProfileFor(profile.profile_for)
          setGender(profile.gender ?? 'male')
          setDateOfBirth(profile.date_of_birth ? profile.date_of_birth.slice(0, 10) : '')
          setHeightCm(profile.height_cm ? String(profile.height_cm) : '')
          setMaritalStatus(profile.marital_status)
          setDiet(profile.diet)
          setMotherTongue(profile.mother_tongue)
          // Initialise from community_id / sub_community_id; legacy rows that
          // only carry the text are resolved against the DB rows (cases A–D).
          const resolved = resolveProfileCommunity(tree, profile)
          setCommunityId(resolved.communityId)
          setSubCommunityId(resolved.subCommunityId)
          setGotra(profile.gotra ?? '')
          setCity(profile.city ?? '')
          setState(profile.state)
          setCountry(profile.country || 'India')
          setNativePlace(profile.native_place ?? '')
          setEducation(profile.education ?? '')
          setEducationDetails(profile.education_details ?? '')
          setOccupation(profile.occupation ?? '')
          setCompany(profile.company ?? '')
          setBusinessName(profile.business_name ?? '')
          setAnnualIncome(profile.annual_income ?? '')
          setAboutMe(profile.about_me ?? '')
          setHobbies(profile.hobbies ?? [])
          setSmoking(profile.smoking ?? 'never')
          setDrinking(profile.drinking ?? 'never')
          setFatherOccupation(profile.father_occupation ?? '')
          setMotherOccupation(profile.mother_occupation ?? '')
          setSiblings(profile.siblings ?? '')
          setFamilyType(profile.family_type ?? 'joint')
          setFamilyLocation(profile.family_location ?? '')
          setFamilyDetails(profile.family_details ?? '')
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
          setPreferredIncome(prefRow.preferred_income ?? '')
          setPreferredDiet(prefRow.preferred_diet ?? 'vegetarian')
          setPreferredMaritalStatus(prefRow.preferred_marital_status ?? 'never_married')
          setPreferredNativePlace(prefRow.preferred_native_place ?? '')
          setPreferredFamilyType(prefRow.preferred_family_type ?? '')
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

    // Community fields are only written when the member has a real selection.
    // If the hierarchy could not be loaded (or a legacy row could not be
    // resolved yet — CASE D), a draft save from a later step must NOT wipe the
    // values already stored; the basic-step validation still requires a pick.
    const communityPayload = selectedSubCommunity
      ? {
          community_id: selectedSubCommunity.communityId,
          sub_community_id: selectedSubCommunity.id,
          sub_community: selectedSubCommunity.name,
        }
      : {}

    const mpPayload = {
      user_id: userId,
      profile_for: profileFor,
      gender,
      date_of_birth: dateOfBirth || null,
      height_cm: heightCm ? Number(heightCm) : null,
      marital_status: maritalStatus,
      diet,
      mother_tongue: motherTongue,
      // Authoritative hierarchy IDs. The legacy text is derived from the
      // selected DB row (and re-synced by the DB trigger), never typed.
      ...communityPayload,
      gotra: gotra || null,
      city,
      state,
      country: country.trim() || 'India',
      native_place: nativePlace.trim() || null,
      education,
      education_details: educationDetails || null,
      occupation,
      company: company.trim() || null,
      business_name: businessName.trim() || null,
      annual_income: annualIncome || null,
      about_me: aboutMe || null,
      hobbies,
      smoking,
      drinking,
      // Family block (F)
      father_occupation: fatherOccupation.trim() || null,
      mother_occupation: motherOccupation.trim() || null,
      siblings: siblings.trim() || null,
      family_type: familyType,
      family_location: familyLocation.trim() || null,
      family_details: familyDetails.trim() || null,
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
      preferred_income: preferredIncome || null,
      preferred_diet: preferredDiet,
      preferred_marital_status: preferredMaritalStatus,
      preferred_native_place: preferredNativePlace.trim() || null,
      preferred_family_type: preferredFamilyType || null,
      note: prefNote || null,
    } as const

    const { error: mpError } = await supabase
      .from('matrimony_profiles')
      .upsert(mpPayload, { onConflict: 'user_id' })
    if (mpError) {
      // The publish gate refuses an incomplete go-live; show exactly what is
      // missing so the member can fix it instead of guessing.
      setFormError(
        mpError.message.startsWith('PROFILE_INCOMPLETE')
          ? mpError.message.replace(/^PROFILE_INCOMPLETE: ?/, 'Complete your profile before publishing: ')
          : /^COMMUNITY_(MISMATCH|INACTIVE|INVALID)/.test(mpError.message)
            ? t('profile.error.community')
            : mpError.message
      )
      return false
    }
    const { error: ppError } = await supabase
      .from('partner_preferences')
      .upsert(ppPayload, { onConflict: 'profile_id' })
    if (ppError) {
      setFormError(ppError.message)
      return false
    }

    // Platinum Launch Offer: after the profile save succeeded, let the SERVER
    // decide whether this member just became eligible (required details
    // complete → first-100 30-day grant or 24-hour demo). The RPC is atomic
    // and idempotent — repeated saves, refreshes or double clicks return the
    // existing grant and can never duplicate it. Any failure here (e.g. the
    // migration is not applied yet) is non-fatal: the dashboard retries the
    // same RPC lazily, exactly like sweep_my_membership.
    try {
      const { data: launchData } = await supabase.rpc('claim_platinum_launch_offer')
      const launch = (launchData ?? null) as PlatinumLaunchState | null
      // Remember ONLY a freshly issued grant: a later save/publish in the same
      // session returns 'already_claimed' and must not erase the celebration.
      if (launch && launch.status === 'granted') {
        launchRef.current = launch
        setLaunchOffer(launch)
      }
    } catch {
      // Promotion must never break the save flow.
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
        communityId,
        subCommunityId,
        gotra,
        city,
        state,
        country,
        nativePlace,
      })
      if (!r.success) {
        for (const issue of r.error.issues) {
          next[issue.path[0] as string] = issue.message
        }
      }
    } else if (s === 'education') {
      const r = educationSchema.safeParse({
        education,
        educationDetails,
        occupation,
        company,
        businessName,
        annualIncome,
      })
      if (!r.success) {
        for (const issue of r.error.issues) next[issue.path[0] as string] = issue.message
      }
    } else if (s === 'about') {
      const r = aboutSchema.safeParse({ aboutMe, hobbies, smoking, drinking })
      if (!r.success) for (const issue of r.error.issues) next[issue.path[0] as string] = issue.message
    } else if (s === 'family') {
      const r = familySchema.safeParse({
        fatherOccupation,
        motherOccupation,
        siblings,
        familyType,
        familyLocation,
        familyDetails,
      })
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
        preferredIncome,
        preferredDiet,
        preferredMaritalStatus,
        preferredNativePlace,
        preferredFamilyType: preferredFamilyType || undefined,
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
    if (photos.length === 0) {
      setFormError('Add at least one profile photo before publishing — add it below, then publish again.')
      return
    }
    if (!familyPhoto) {
      setFormError('Add your family photo before publishing — add it below in the family photo block, then publish again.')
      return
    }
    setSaving(true)
    const ok = await saveProfile(true)
    setSaving(false)
    if (ok) {
      if (userId) saveProgress(userId, { completed: [...STEPS], lastStep: 'photos' })
      // Carry the just-issued launch grant to the dashboard so it can
      // celebrate truthfully (the card itself re-reads server state).
      const launch = launchRef.current
      const launchParam =
        launch?.status === 'granted'
          ? `&launch=${launch.grant_type === 'first_100' ? 'first100' : 'demo'}`
          : ''
      router.push(`/profile?published=1${launchParam}`)
      router.refresh()
    }
  }

  // ---- photo upload ----
  async function onUpload(file: File, kind: 'profile_photo' | 'family_photo' = 'profile_photo') {
    if (!userId || !isSupabaseConfigured) return
    setFormError(null)
    setUploading(kind)
    try {
      const supabase = createClient()
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const folder = kind === 'family_photo' ? `${userId}/family` : userId
      const path = `${folder}/${Date.now()}-${safeName}`
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
      if (kind === 'family_photo') {
        // Exactly one family photo: replace the old row/object. (The DB keeps
        // one family row per profile via a partial unique index, so we delete
        // the old row first — ON CONFLICT cannot target partial indexes.)
        const old = familyPhoto
        if (old) {
          const { error: delError } = await supabase
            .from('profile_photos')
            .delete()
            .eq('profile_id', userId)
            .eq('kind', 'family_photo')
          if (delError) {
            await supabase.storage.from('profile-photos').remove([path])
            setFormError(`[photo] ${delError.message}`)
            return
          }
        }
        const { data, error: insertError } = await supabase
          .from('profile_photos')
          .insert({ profile_id: userId, storage_path: path, is_primary: false, sort_order: 999, kind: 'family_photo' })
          .select()
          .single()
        if (insertError) {
          await supabase.storage.from('profile-photos').remove([path])
          setFormError(`[photo] ${insertError.message}`)
          return
        }
        setFamilyPhoto({ id: data.id, path: data.storage_path })
        if (old) await supabase.storage.from('profile-photos').remove([old.path])
      } else {
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
      }
    } finally {
      setUploading(null)
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
    if (familyPhoto && p.id === familyPhoto.id) {
      setFamilyPhoto(null)
      return
    }
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
    family: { icon: Home, title: t('profile.step.family.title') },
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
                <Field label={t('profile.community')} error={errors.communityId ?? (hierarchy.error ? t('profile.community.loadError') : undefined)}>
                  <select
                    value={communityId}
                    onChange={(e) => {
                      const next = e.target.value
                      setCommunityId(next)
                      // A sub-community from another community is never kept.
                      if (!subCommunitiesOf(hierarchy, next).some((s) => s.id === subCommunityId)) {
                        setSubCommunityId('')
                      }
                    }}
                    className="input"
                    disabled={hierarchy.communities.length === 0}
                  >
                    <option value="">{hierarchy.error ? t('profile.community.unavailable') : t('profile.community.select')}</option>
                    {hierarchy.communities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field
                  label={t('profile.subCommunity')}
                  error={errors.subCommunityId}
                  hint={!communityId ? t('profile.subCommunity.pickCommunityFirst') : undefined}
                >
                  <select
                    value={subCommunityId}
                    onChange={(e) => setSubCommunityId(e.target.value)}
                    className="input disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                    disabled={!communityId || availableSubCommunities.length === 0}
                  >
                    <option value="">{t('profile.subCommunity.select')}</option>
                    {availableSubCommunities.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {selectedCommunity && selectedSubCommunity && (
                  <p className="self-end pb-3 text-xs text-stone-500">
                    {selectedCommunity.name} · {selectedSubCommunity.name}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.city')} error={errors.city}>
                  <Select value={city} onChange={setCity} options={cityOptions} allowEmpty />
                </Field>
                <Field label={t('profile.state')} error={errors.state}>
                  <input value={state} onChange={(e) => setState(e.target.value)} className="input" />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.country')}>
                  <input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="input"
                    placeholder="India"
                  />
                </Field>
                <Field label={t('profile.nativePlace')} hint={t('profile.nativePlace.hint')}>
                  <input
                    value={nativePlace}
                    onChange={(e) => setNativePlace(e.target.value)}
                    className="input"
                    placeholder={t('profile.nativePlace.placeholder')}
                  />
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
              <Field label={t('profile.company')} hint={t('profile.company.hint')}>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="input"
                  placeholder={t('profile.company.placeholder')}
                />
              </Field>
              {/* Business name is its OWN field — the company box above is
                  never overwritten with it, and vice versa. */}
              <Field label={t('profile.businessName')} hint={t('profile.businessName.hint')}>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="input"
                  placeholder={t('profile.businessName.placeholder')}
                />
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

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.smoking')}>
                  <Select value={smoking} onChange={(v) => setSmoking(v as LifestyleChoice)} options={lifestyleOptions} />
                </Field>
                <Field label={t('profile.drinking')}>
                  <Select value={drinking} onChange={(v) => setDrinking(v as LifestyleChoice)} options={lifestyleOptions} />
                </Field>
              </div>
            </div>
          )}

          {step === 'family' && (
            <div className="space-y-5">
              <p className="text-sm text-stone-600">{t('profile.family.intro')}</p>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.family.fatherOccupation')}>
                  <input
                    value={fatherOccupation}
                    onChange={(e) => setFatherOccupation(e.target.value)}
                    className="input"
                    placeholder={t('profile.family.fatherOccupation.placeholder')}
                  />
                </Field>
                <Field label={t('profile.family.motherOccupation')}>
                  <input
                    value={motherOccupation}
                    onChange={(e) => setMotherOccupation(e.target.value)}
                    className="input"
                    placeholder={t('profile.family.motherOccupation.placeholder')}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('profile.family.siblings')}>
                  <input
                    value={siblings}
                    onChange={(e) => setSiblings(e.target.value)}
                    className="input"
                    placeholder={t('profile.family.siblings.placeholder')}
                  />
                </Field>
                <Field label={t('profile.family.type')}>
                  <Select value={familyType} onChange={(v) => setFamilyType(v as FamilyType)} options={familyTypeOptions} />
                </Field>
              </div>

              <Field label={t('profile.family.location')}>
                <input
                  value={familyLocation}
                  onChange={(e) => setFamilyLocation(e.target.value)}
                  className="input"
                  placeholder={t('profile.family.location.placeholder')}
                />
              </Field>

              <Field label={t('profile.family.details')} hint={t('profile.family.details.hint')}>
                <textarea
                  rows={3}
                  value={familyDetails}
                  maxLength={500}
                  onChange={(e) => setFamilyDetails(e.target.value)}
                  className="input resize-none"
                />
              </Field>

              <p className="rounded-xl bg-brand-50 px-4 py-3 text-xs text-brand-800">
                {t('profile.family.privacyNote')}
              </p>
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
                {hierarchy.error ? (
                  <p className="text-xs text-brand-700">{t('profile.community.loadError')}</p>
                ) : (
                  <MultiSelect
                    options={Array.from(new Set(hierarchy.subCommunities.map((s) => s.name)))}
                    selected={preferredSubCommunities}
                    onChange={setPreferredSubCommunities}
                  />
                )}
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
                <Field label={t('profile.pref.income')}>
                  <Select value={preferredIncome} onChange={setPreferredIncome} options={incomeOptions} allowEmpty />
                </Field>
                <Field label={t('profile.pref.nativePlace')}>
                  <input
                    value={preferredNativePlace}
                    onChange={(e) => setPreferredNativePlace(e.target.value)}
                    className="input"
                    placeholder={t('profile.pref.nativePlace.placeholder')}
                  />
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

              <Field label={t('profile.pref.familyType')}>
                <Select
                  value={preferredFamilyType}
                  onChange={(v) => setPreferredFamilyType((v || '') as '' | FamilyType)}
                  options={familyTypeOptions}
                  allowEmpty
                />
              </Field>

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
                  {uploading === 'profile_photo' ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                  <span className="px-3 text-center text-[11px] font-medium">{t('profile.photos.add')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onUpload(f, 'profile_photo')
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>

              {/* Family photo — mandatory before publishing. It is stored as a
                  separate kind and shown to matched members with the biodata. */}
              <div className="rounded-2xl border border-gold-300/60 bg-gold-50/60 p-4">
                <p className="text-sm font-bold text-stone-900">
                  {t('profile.familyPhoto.title')}{' '}
                  <span className="text-brand-700" aria-hidden>*</span>
                  <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-brand-800">
                    {t('profile.familyPhoto.required')}
                  </span>
                </p>
                <p className="mt-1 text-xs text-stone-500">{t('profile.familyPhoto.hint')}</p>
                <div className="mt-3 flex items-start gap-3">
                  {familyPhoto ? (
                    <div className="relative overflow-hidden rounded-xl ring-1 ring-stone-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoUrl(familyPhoto.path) ?? ''} alt="" className="h-28 w-28 object-cover" />
                      <button
                        type="button"
                        onClick={() => onRemovePhoto({ id: familyPhoto.id, path: familyPhoto.path, primary: false })}
                        className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700"
                        aria-label="Remove family photo"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-gold-100 text-[11px] font-medium text-gold-700">
                      {t('profile.familyPhoto.none')}
                    </div>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-2 self-center rounded-full bg-maroon px-4 py-2 text-xs font-bold text-white hover:bg-maroon-dark">
                    {uploading === 'family_photo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {familyPhoto ? t('profile.familyPhoto.replace') : t('profile.familyPhoto.add')}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) onUpload(f, 'family_photo')
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">{t('profile.photos.reviewNote')}</div>
            </div>
          )}

          {/* Platinum Launch Offer — server granted the promotion on save.
              Shown for draft saves (a publish redirects to the dashboard,
              which renders the full card). Never worded as a payment. */}
          {launchOffer?.status === 'granted' && launchOffer.has_grant && (
            <div
              role="status"
              className="mt-6 rounded-xl border border-gold-400/60 bg-gradient-to-br from-maroon-deep to-brand-800 px-4 py-4 text-sm text-white"
            >
              <p className="flex items-center gap-2 font-display text-base font-bold text-gold-200">
                <Sparkles className="h-4 w-4" aria-hidden />
                {launchOffer.grant_type === 'demo_24h'
                  ? '🎉 Your free 24-hour Platinum demo is now active.'
                  : launchOffer.slot_number
                    ? `🎉 You're one of the first 100 members! (Slot #${launchOffer.slot_number})`
                    : '🎉 You have received 30 days of Platinum access free.'}
              </p>
              <p className="mt-1.5 text-white/80">
                {launchOffer.grant_type === 'demo_24h'
                  ? 'Full Platinum capabilities for 24 hours — no payment needed.'
                  : "You've received 30 days of Platinum access free — no payment needed."}
                {launchOffer.expires_at ? (
                  <>
                    {' '}
                    Active until{' '}
                    <span className="font-semibold">
                      {new Date(launchOffer.expires_at).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </span>
                    .
                  </>
                ) : null}
              </p>
              <Link
                href="/profile"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-gold-400 px-4 py-1.5 text-xs font-bold text-maroon-deep hover:bg-gold-300"
              >
                <Star className="h-3.5 w-3.5" /> Go to my dashboard
              </Link>
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
