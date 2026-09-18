'use client'

import { useState, useRef, useTransition, type FormEvent, type ChangeEvent } from 'react'
import Link from 'next/link'
import {
  Heart,
  Star,
  Sparkles,
  Camera,
  X,
  UploadCloud,
  CheckCircle2,
  Calendar,
  Lock,
  Loader2,
  Quote,
} from 'lucide-react'
import { submitSuccessStoryAction } from '@/app/success-stories/submit/actions'
import { useI18n } from '@/lib/i18n/provider'
import { VALUED_FEATURES } from '@/lib/success-stories/schema'

const RATING_LABELS: Record<number, string> = {
  1: 'stories.rating.1',
  2: 'stories.rating.2',
  3: 'stories.rating.3',
  4: 'stories.rating.4',
  5: 'stories.rating.5',
}

const MILESTONE_OPTIONS = [
  { value: 'found_match', key: 'stories.milestone.found_match', defaultLabel: 'We found our match' },
  { value: 'engaged', key: 'stories.milestone.engaged', defaultLabel: 'We are engaged' },
  { value: 'married', key: 'stories.milestone.married', defaultLabel: 'We are married' },
] as const

const FEATURE_OPTIONS = [
  { value: 'genuine_profiles', key: 'stories.valued.genuine_profiles', defaultLabel: 'Genuine profiles' },
  { value: 'community_matching', key: 'stories.valued.community_matching', defaultLabel: 'Community-focused matching' },
  { value: 'easy_connect', key: 'stories.valued.easy_connect', defaultLabel: 'Easy to connect' },
  { value: 'helpful_details', key: 'stories.valued.helpful_details', defaultLabel: 'Helpful profile details' },
  { value: 'privacy_safety', key: 'stories.valued.privacy_safety', defaultLabel: 'Privacy and safety' },
  { value: 'compatible_match', key: 'stories.valued.compatible_match', defaultLabel: 'Finding a compatible match' },
  { value: 'family_friendly', key: 'stories.valued.family_friendly', defaultLabel: 'Family-friendly experience' },
  { value: 'other', key: 'stories.valued.other', defaultLabel: 'Other' },
] as const

export function SuccessStoryForm() {
  const { t } = useI18n()
  const [isPending, startTransition] = useTransition()

  // Form states
  const [coupleNames, setCoupleNames] = useState('')
  const [title, setTitle] = useState('')
  const [rating, setRating] = useState<number>(5)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  const [story, setStory] = useState('')
  const [milestone, setMilestone] = useState<'found_match' | 'engaged' | 'married'>('found_match')
  const [weddingDate, setWeddingDate] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [valuedFeatures, setValuedFeatures] = useState<string[]>([])
  const [futureMembersNote, setFutureMembersNote] = useState('')
  const [consent, setConsent] = useState(false)

  // Status and validation feedback
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submittedSuccess, setSubmittedSuccess] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  function toggleFeature(val: string) {
    setValuedFeatures((prev) =>
      prev.includes(val) ? prev.filter((item) => item !== val) : [...prev, val]
    )
  }

  function handlePhotoSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFieldErrors((prev) => ({ ...prev, photo: 'Only JPG, PNG, and WebP images are allowed.' }))
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setFieldErrors((prev) => ({ ...prev, photo: 'Photo must be under 5 MB.' }))
      return
    }

    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next.photo
      return next
    })

    setPhotoFile(file)
    const url = URL.createObjectURL(file)
    setPhotoPreview(url)
  }

  function removePhoto() {
    setPhotoFile(null)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function validateClient(): boolean {
    const errors: Record<string, string> = {}

    if (coupleNames.trim().length < 2) {
      errors.couple_names = 'Please provide both of your display names (at least 2 characters).'
    } else if (coupleNames.trim().length > 100) {
      errors.couple_names = 'Couple names cannot exceed 100 characters.'
    }

    if (title.trim().length < 3) {
      errors.title = 'Please give your story a heartfelt title (at least 3 characters).'
    } else if (title.trim().length > 120) {
      errors.title = 'Title cannot exceed 120 characters.'
    }

    if (!rating || rating < 1 || rating > 5) {
      errors.rating = 'Please rate your experience from 1 to 5 stars.'
    }

    if (story.trim().length < 100) {
      errors.story = `Please tell us a little more about your journey (${story.trim().length}/100 minimum characters).`
    } else if (story.trim().length > 2500) {
      errors.story = 'Story cannot exceed 2,500 characters.'
    }

    if (futureMembersNote.trim().length > 800) {
      errors.future_members_note = 'Note cannot exceed 800 characters.'
    }

    if (!consent) {
      errors.consent = 'You must confirm partner consent and agree to publication before submitting.'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)

    if (!validateClient()) {
      setFormError('Please review and complete the required fields below.')
      return
    }

    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('couple_names', coupleNames.trim())
        fd.set('title', title.trim())
        fd.set('rating', String(rating))
        fd.set('story', story.trim())
        fd.set('milestone', milestone)
        if (weddingDate) fd.set('wedding_date', weddingDate)
        if (photoFile) fd.set('photo', photoFile)
        fd.set('valued_features', JSON.stringify(valuedFeatures))
        if (futureMembersNote.trim()) fd.set('future_members_note', futureMembersNote.trim())
        fd.set('consent', consent ? 'true' : 'false')

        const res = await submitSuccessStoryAction(fd)
        if (!res.ok) {
          setFormError(res.error)
          if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        } else {
          setSubmittedSuccess(true)
        }
      } catch {
        setFormError('An unexpected network error occurred. Please try submitting again.')
      }
    })
  }

  if (submittedSuccess) {
    return (
      <div className="mx-auto max-w-2xl rounded-[28px] border border-stone-200 bg-white p-8 text-center shadow-card-float sm:p-12">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="mt-5 font-display text-3xl font-bold text-maroon sm:text-4xl">
          {t('stories.success.title')}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-stone-600 sm:text-base">
          {t('stories.success.body')}
        </p>

        <div className="mx-auto mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link href="/success-stories" className="btn-primary w-full sm:w-auto">
            {t('stories.success.back')}
          </Link>
          <Link href="/profile" className="btn-secondary w-full sm:w-auto">
            {t('stories.success.profile')}
          </Link>
        </div>
      </div>
    )
  }

  const activeRating = hoverRating ?? rating
  const currentRatingLabelKey = RATING_LABELS[activeRating]

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {formError && (
        <div
          role="alert"
          className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm font-medium text-brand-900"
        >
          {formError}
        </div>
      )}

      {/* SECTION 1 — YOUR STORY */}
      <section className="rounded-[26px] border border-stone-200/80 bg-white p-6 shadow-card-float sm:p-8">
        <div className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
          <Heart className="h-4 w-4 fill-gold-500 text-gold-500" />
          <span>Part 1 · Your Story</span>
        </div>
        <h3 className="mt-1 font-display text-2xl font-bold text-stone-900">
          The Story of You Two
        </h3>

        <div className="mt-6 space-y-6">
          {/* Couple Display Names */}
          <div>
            <label htmlFor="couple_names" className="label text-sm font-bold text-stone-800">
              {t('stories.form.names')} <span className="text-brand-600">*</span>
            </label>
            <input
              id="couple_names"
              type="text"
              value={coupleNames}
              onChange={(e) => setCoupleNames(e.target.value)}
              placeholder={t('stories.form.names.placeholder')}
              maxLength={100}
              className={`input ${fieldErrors.couple_names ? 'border-brand-500 focus:ring-brand-400' : ''}`}
              aria-invalid={Boolean(fieldErrors.couple_names)}
              aria-describedby="couple_names_help"
            />
            <p id="couple_names_help" className="mt-1 text-xs text-stone-500">
              {t('stories.form.names.help')}
            </p>
            {fieldErrors.couple_names && (
              <p className="mt-1 text-xs font-medium text-brand-700">{fieldErrors.couple_names}</p>
            )}
          </div>

          {/* Story Title */}
          <div>
            <label htmlFor="story_title" className="label text-sm font-bold text-stone-800">
              {t('stories.form.title')} <span className="text-brand-600">*</span>
            </label>
            <input
              id="story_title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('stories.form.title.placeholder')}
              maxLength={120}
              className={`input ${fieldErrors.title ? 'border-brand-500 focus:ring-brand-400' : ''}`}
              aria-invalid={Boolean(fieldErrors.title)}
            />
            {fieldErrors.title && (
              <p className="mt-1 text-xs font-medium text-brand-700">{fieldErrors.title}</p>
            )}
          </div>

          {/* Rating */}
          <div>
            <label className="label text-sm font-bold text-stone-800">
              {t('stories.form.rating')} <span className="text-brand-600">*</span>
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <div
                role="radiogroup"
                aria-label={t('stories.form.rating')}
                className="flex items-center gap-1.5"
              >
                {[1, 2, 3, 4, 5].map((star) => {
                  const isFilled = star <= (hoverRating ?? rating)
                  return (
                    <button
                      key={star}
                      type="button"
                      role="radio"
                      aria-checked={rating === star}
                      aria-label={`${star} star${star > 1 ? 's' : ''}`}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      onClick={() => setRating(star)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                          e.preventDefault()
                          setRating(Math.min(5, star + 1))
                        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                          e.preventDefault()
                          setRating(Math.max(1, star - 1))
                        }
                      }}
                      className="group p-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-gold-400 rounded-lg"
                    >
                      <Star
                        className={`h-7 w-7 transition-colors ${
                          isFilled
                            ? 'fill-amber-400 text-amber-500 drop-shadow-sm'
                            : 'text-stone-300 hover:text-stone-400'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
              <span className="text-sm font-semibold text-stone-700">
                {currentRatingLabelKey ? t(currentRatingLabelKey) : ''}
              </span>
            </div>
            {fieldErrors.rating && (
              <p className="mt-1 text-xs font-medium text-brand-700">{fieldErrors.rating}</p>
            )}
          </div>

          {/* Relationship Milestone */}
          <div>
            <label className="label text-sm font-bold text-stone-800">
              {t('stories.form.milestone')}
            </label>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {MILESTONE_OPTIONS.map((opt) => {
                const selected = milestone === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMilestone(opt.value)}
                    className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition-all ${
                      selected
                        ? 'border-maroon bg-brand-50/70 text-maroon shadow-sm ring-1 ring-maroon'
                        : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-full border ${
                        selected ? 'border-maroon bg-maroon' : 'border-stone-300'
                      }`}
                    />
                    {t(opt.key)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Wedding Date (shown if married or always available optional) */}
          {milestone === 'married' && (
            <div className="rounded-2xl border border-gold-200/60 bg-amber-50/40 p-4 transition-all">
              <label htmlFor="wedding_date" className="label text-sm font-bold text-stone-800">
                {t('stories.form.weddingDate')} <span className="text-xs font-normal text-stone-500">(Optional)</span>
              </label>
              <div className="relative mt-1 max-w-xs">
                <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  id="wedding_date"
                  type="date"
                  value={weddingDate}
                  onChange={(e) => setWeddingDate(e.target.value)}
                  className="input pl-11"
                />
              </div>
            </div>
          )}

          {/* Your Story Textarea */}
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="story_text" className="label text-sm font-bold text-stone-800">
                {t('stories.form.story')} <span className="text-brand-600">*</span>
              </label>
              <span
                className={`text-xs ${
                  story.trim().length < 100
                    ? 'font-medium text-amber-600'
                    : story.trim().length > 2400
                      ? 'font-medium text-brand-600'
                      : 'text-stone-500'
                }`}
              >
                {story.trim().length.toLocaleString()} / 2,500 characters
              </span>
            </div>
            <p className="mb-2 text-xs text-stone-500">{t('stories.form.story.prompt')}</p>
            <div className="relative">
              <Quote className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-stone-300" />
              <textarea
                id="story_text"
                rows={6}
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder="We connected through our shared cultural roots and love for family. After conversing on Mali Vivah, our parents met and everything felt natural and right..."
                maxLength={2500}
                className={`input pl-10 pt-3 leading-relaxed ${
                  fieldErrors.story ? 'border-brand-500 focus:ring-brand-400' : ''
                }`}
                aria-invalid={Boolean(fieldErrors.story)}
              />
            </div>
            {story.trim().length > 0 && story.trim().length < 100 && (
              <p className="mt-1 text-xs text-amber-700 font-medium">
                Please add {100 - story.trim().length} more characters to reach the 100 character minimum.
              </p>
            )}
            {fieldErrors.story && (
              <p className="mt-1 text-xs font-medium text-brand-700">{fieldErrors.story}</p>
            )}
          </div>

          {/* Couple Photo (Optional) */}
          <div>
            <label className="label text-sm font-bold text-stone-800">
              {t('stories.form.photo')}{' '}
              <span className="text-xs font-normal text-stone-500">(Optional)</span>
            </label>
            <p className="text-xs text-stone-500 mb-2">{t('stories.form.photo.help')}</p>

            {photoPreview ? (
              <div className="relative inline-block overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Couple preview"
                  className="h-44 w-60 object-cover object-top"
                />
                <button
                  type="button"
                  onClick={removePhoto}
                  className="absolute right-2 top-2 rounded-full bg-stone-900/70 p-1.5 text-white hover:bg-stone-900 transition-colors"
                  aria-label="Remove photo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-brand-50/20 px-6 py-7 text-center transition-colors hover:border-gold-400 hover:bg-brand-50/40"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm ring-1 ring-stone-200">
                  <Camera className="h-6 w-6 text-brand-700" />
                </div>
                <p className="mt-3 text-sm font-semibold text-stone-800">
                  Click to select a couple photo
                </p>
                <p className="mt-1 text-xs text-stone-500">JPG, PNG or WebP · Up to 5 MB</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoSelect}
              className="hidden"
            />
            {fieldErrors.photo && (
              <p className="mt-1 text-xs font-medium text-brand-700">{fieldErrors.photo}</p>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 2 — WHAT DID YOU LIKE? */}
      <section className="rounded-[26px] border border-stone-200/80 bg-white p-6 shadow-card-float sm:p-8">
        <div className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
          <Sparkles className="h-4 w-4 text-gold-600" />
          <span>Part 2 · Your Experience</span>
        </div>
        <h3 className="mt-1 font-display text-2xl font-bold text-stone-900">
          {t('stories.form.valued')}
        </h3>
        <p className="mt-1 text-xs text-stone-500">
          Select what made your experience meaningful on Mali Vivah.
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          {FEATURE_OPTIONS.map((opt) => {
            const selected = valuedFeatures.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleFeature(opt.value)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                  selected
                    ? 'bg-maroon text-white shadow-sm ring-2 ring-maroon'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200/80 ring-1 ring-stone-200'
                }`}
              >
                {selected ? '✓ ' : '+ '}
                {t(opt.key)}
              </button>
            )
          })}
        </div>
      </section>

      {/* SECTION 3 — NOTE TO FUTURE MEMBERS */}
      <section className="rounded-[26px] border border-stone-200/80 bg-white p-6 shadow-card-float sm:p-8">
        <div className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">
          <Quote className="h-4 w-4 text-brand-600" />
          <span>Part 3 · Advice &amp; Encouragement</span>
        </div>
        <h3 className="mt-1 font-display text-2xl font-bold text-stone-900">
          {t('stories.form.futureNote')}
        </h3>
        <p className="mt-1 text-xs text-stone-500">
          Optional words of encouragement or wisdom for couples and families starting their journey.
        </p>

        <div className="mt-5">
          <div className="flex items-baseline justify-end">
            <span className="text-xs text-stone-500">
              {futureMembersNote.trim().length} / 800 characters
            </span>
          </div>
          <textarea
            rows={3}
            value={futureMembersNote}
            onChange={(e) => setFutureMembersNote(e.target.value)}
            placeholder={t('stories.form.futureNote.placeholder')}
            maxLength={800}
            className="input mt-1 leading-relaxed"
          />
          {fieldErrors.future_members_note && (
            <p className="mt-1 text-xs font-medium text-brand-700">
              {fieldErrors.future_members_note}
            </p>
          )}
        </div>
      </section>

      {/* SECTION 4 — CONSENT & SUBMISSION */}
      <section className="rounded-[26px] border border-gold-300/60 bg-amber-50/50 p-6 shadow-card-float sm:p-8">
        <div className="flex items-start gap-3">
          <input
            id="consent_checkbox"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-stone-300 text-maroon focus:ring-maroon"
          />
          <label htmlFor="consent_checkbox" className="text-xs leading-relaxed text-stone-700 sm:text-sm">
            <span className="font-semibold text-stone-900">Consent to publish: </span>
            {t('stories.form.consent')}
          </label>
        </div>
        {fieldErrors.consent && (
          <p className="mt-2 text-xs font-medium text-brand-700">{fieldErrors.consent}</p>
        )}

        <div className="mt-6 flex flex-col items-center justify-between gap-4 border-t border-gold-200/60 pt-6 sm:flex-row">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Lock className="h-4 w-4 text-gold-600" />
            <span>{t('stories.submit.trust')}</span>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2 min-w-[200px]"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t('stories.form.submitting')}</span>
              </>
            ) : (
              <>
                <Heart className="h-4 w-4 fill-current" />
                <span>{t('stories.form.submit')}</span>
              </>
            )}
          </button>
        </div>
      </section>
    </form>
  )
}
