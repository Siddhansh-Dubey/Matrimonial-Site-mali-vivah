'use client'

import { dietOptions, lifestyleOptions } from '@/lib/profile/profile-schema'
import { useI18n } from '@/lib/i18n/provider'
import type { Diet, LifestyleChoice } from '@/lib/supabase/database.types'

type LifestyleFiltersProps = {
  diet: Diet | null
  smoking: LifestyleChoice | null
  drinking: LifestyleChoice | null
}

const selectClassName =
  'w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400'

/**
 * Advanced-search lifestyle controls. They stay inside the parent GET form,
 * so submit, reset links, bookmarks and browser history use the same URL state
 * as every existing search filter.
 */
export function LifestyleFilters({ diet, smoking, drinking }: LifestyleFiltersProps) {
  const { t } = useI18n()

  return (
    <>
      <Field label={t('search.advanced.diet')}>
        <select name="diet" defaultValue={diet ?? ''} className={selectClassName}>
          <option value="">{t('search.advanced.anyDiet')}</option>
          {dietOptions.map((option) => (
            <option key={option} value={option}>
              {t(`search.lifestyle.diet.${option}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('search.advanced.smoking')}>
        <select name="smoking" defaultValue={smoking ?? ''} className={selectClassName}>
          <option value="">{t('search.advanced.anySmoking')}</option>
          {lifestyleOptions.map((option) => (
            <option key={option} value={option}>
              {t(`search.lifestyle.choice.${option}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('search.advanced.drinking')}>
        <select name="drinking" defaultValue={drinking ?? ''} className={selectClassName}>
          <option value="">{t('search.advanced.anyDrinking')}</option>
          {lifestyleOptions.map((option) => (
            <option key={option} value={option}>
              {t(`search.lifestyle.choice.${option}`)}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label-white">{label}</span>
      <div className="mt-2">{children}</div>
    </div>
  )
}
