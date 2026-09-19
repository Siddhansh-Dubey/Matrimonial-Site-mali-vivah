import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
import { requireAdminPage } from '@/lib/admin/server'
import { AdminNotice } from '@/components/admin/notice'
import { PROFILE_STATUS_LABELS, label } from '@/lib/admin/members'
import { loadCommunityHierarchy, resolveProfileCommunity, subCommunitiesOf } from '@/lib/profile/community'
import {
  HOBBY_OPTIONS,
  cityOptions,
  dietOptions,
  educationOptions,
  familyTypeOptions,
  genderOptions,
  incomeOptions,
  lifestyleOptions,
  maritalStatusOptions,
  motherTongueOptions,
  occupationOptions,
} from '@/lib/profile/profile-schema'
import { updateMemberProfile } from '@/app/admin/actions'

export const metadata = { title: 'Admin · Edit member' }
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Props = { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }

const input =
  'mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-maroon/30'

function Field({ label: text, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-semibold text-stone-500">
      {text}
      {children}
      {hint && <span className="mt-0.5 block text-[11px] font-normal text-stone-400">{hint}</span>}
    </label>
  )
}

/** Select with the shared option list; keeps an unlisted stored value selectable. */
function OptionSelect({
  name,
  value,
  options,
  allowEmpty = true,
  emptyLabel = '— not set —',
}: {
  name: string
  value: string | null | undefined
  options: readonly string[]
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  const list = value && !options.includes(value) ? [value, ...options] : [...options]
  return (
    <select name={name} defaultValue={value ?? ''} className={input}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {list.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="font-display text-base font-bold text-stone-900">{title}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/**
 * Admin edit form. Same field vocabulary + option lists as the member wizard
 * (src/lib/profile/profile-schema.ts, community hierarchy from the database),
 * submitted to updateMemberProfile → admin_update_member_profile(), which
 * only accepts allow-listed columns. Status, verification, privacy settings
 * and login identity are intentionally NOT editable here.
 */
export default async function AdminMemberEditPage({ params, searchParams }: Props) {
  const { admin } = await requireAdminPage()
  if (!UUID_RE.test(params.id)) notFound()

  const [{ data: person }, { data: profile }, { data: prefs }, hierarchy] = await Promise.all([
    admin.from('profiles').select('id, full_name, email').eq('id', params.id).maybeSingle(),
    admin.from('matrimony_profiles').select('*').eq('user_id', params.id).maybeSingle(),
    admin.from('partner_preferences').select('*').eq('profile_id', params.id).maybeSingle(),
    loadCommunityHierarchy(admin),
  ])
  if (!person || !profile) notFound()

  const pick = (key: string) => {
    const v = searchParams?.[key]
    return ((Array.isArray(v) ? v[0] : v) ?? '').trim()
  }
  const returnTo = `/admin/members/${person.id}/edit`
  const resolved = resolveProfileCommunity(hierarchy, profile)

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/members/${person.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to {person.full_name}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-stone-900">Edit profile</h1>
        <p className="mt-1 text-sm text-stone-500">
          Status is <span className="font-semibold">{PROFILE_STATUS_LABELS[profile.status]}</span> and is not changed
          by this form — use the actions on the member page. Verification, privacy settings and the login email are
          managed elsewhere. Only changed fields are written; every change is audited.
        </p>
      </div>

      <AdminNotice ok={pick('ok')} error={pick('error')} />

      <form action={updateMemberProfile} className="space-y-4">
        <input type="hidden" name="user_id" value={person.id} />
        <input type="hidden" name="return_to" value={returnTo} />

        <Section title="Account & basics">
          <Field label="Display name">
            <input name="full_name" defaultValue={person.full_name} minLength={2} maxLength={80} required className={input} />
          </Field>
          <Field label="Login email (read-only)">
            <input value={person.email} readOnly className={`${input} bg-stone-50 text-stone-500`} />
          </Field>
          <Field label="Profile for">
            <OptionSelect name="profile_for" value={profile.profile_for} options={['self', 'son', 'daughter']} allowEmpty={false} />
          </Field>
          <Field label="Gender">
            <OptionSelect name="gender" value={profile.gender} options={genderOptions} />
          </Field>
          <Field label="Date of birth">
            <input name="date_of_birth" type="date" defaultValue={profile.date_of_birth?.slice(0, 10) ?? ''} className={input} />
          </Field>
          <Field label="Height (cm)">
            <input name="height_cm" type="number" min={120} max={220} defaultValue={profile.height_cm ?? ''} className={input} />
          </Field>
          <Field label="Marital status">
            <OptionSelect name="marital_status" value={profile.marital_status} options={maritalStatusOptions} allowEmpty={false} />
          </Field>
          <Field label="Mother tongue">
            <OptionSelect name="mother_tongue" value={profile.mother_tongue} options={motherTongueOptions} allowEmpty={false} />
          </Field>
        </Section>

        <Section title="Community (database hierarchy)">
          <Field
            label="Community › sub-community"
            hint={
              hierarchy.error
                ? `Hierarchy could not be loaded: ${hierarchy.error}`
                : 'The community is derived from the chosen sub-community, so the pair can never mismatch.'
            }
          >
            <input type="hidden" name="sub_community_initial" value={resolved.subCommunityId} />
            <select
              name="sub_community_id"
              defaultValue={resolved.subCommunityId}
              disabled={Boolean(hierarchy.error) || hierarchy.communities.length === 0}
              className={input}
            >
              <option value="">— not set —</option>
              {hierarchy.communities.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {subCommunitiesOf(hierarchy, c.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      {c.name} › {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Gotra">
            <input name="gotra" defaultValue={profile.gotra ?? ''} maxLength={80} className={input} />
          </Field>
        </Section>

        <Section title="Location">
          <Field label="City">
            <OptionSelect name="city" value={profile.city} options={cityOptions} />
          </Field>
          <Field label="State">
            <input name="state" defaultValue={profile.state} maxLength={80} className={input} />
          </Field>
          <Field label="Country">
            <input name="country" defaultValue={profile.country} maxLength={80} className={input} />
          </Field>
          <Field label="Native place">
            <input name="native_place" defaultValue={profile.native_place ?? ''} maxLength={80} className={input} />
          </Field>
        </Section>

        <Section title="Education & career">
          <Field label="Education">
            <OptionSelect name="education" value={profile.education} options={educationOptions} />
          </Field>
          <Field label="Education details">
            <input name="education_details" defaultValue={profile.education_details ?? ''} maxLength={120} className={input} />
          </Field>
          <Field label="Occupation">
            <OptionSelect name="occupation" value={profile.occupation} options={occupationOptions} />
          </Field>
          <Field label="Annual income">
            <OptionSelect name="annual_income" value={profile.annual_income} options={incomeOptions} />
          </Field>
          <Field label="Company (employer)" hint="Where the member works — separate from a business they own.">
            <input name="company" defaultValue={profile.company ?? ''} maxLength={120} className={input} />
          </Field>
          <Field label="Business name (owned business)" hint="Optional; blank clears it. Never merged with company.">
            <input name="business_name" defaultValue={profile.business_name ?? ''} maxLength={120} className={input} />
          </Field>
        </Section>

        <Section title="Lifestyle & about">
          <Field label="Diet">
            <OptionSelect name="diet" value={profile.diet} options={dietOptions} allowEmpty={false} />
          </Field>
          <Field label="Smoking">
            <OptionSelect name="smoking" value={profile.smoking} options={lifestyleOptions} allowEmpty={false} />
          </Field>
          <Field label="Drinking">
            <OptionSelect name="drinking" value={profile.drinking} options={lifestyleOptions} allowEmpty={false} />
          </Field>
          <div className="text-xs font-semibold text-stone-500">
            Hobbies
            <input type="hidden" name="hobbies_present" value="1" />
            <div className="mt-1 flex flex-wrap gap-2">
              {Array.from(new Set([...(profile.hobbies ?? []), ...HOBBY_OPTIONS])).map((h) => (
                <label key={h} className="inline-flex items-center gap-1 rounded-full border border-stone-300 px-2.5 py-1 text-xs font-normal text-stone-700">
                  <input type="checkbox" name="hobbies" value={h} defaultChecked={(profile.hobbies ?? []).includes(h)} className="h-3.5 w-3.5 rounded border-stone-300 text-maroon" />
                  {h}
                </label>
              ))}
            </div>
          </div>
          <label className="block text-xs font-semibold text-stone-500 sm:col-span-2">
            About
            <textarea name="about_me" defaultValue={profile.about_me ?? ''} maxLength={1000} rows={4} className={input} />
          </label>
        </Section>

        <Section title="Family">
          <Field label="Father’s occupation">
            <input name="father_occupation" defaultValue={profile.father_occupation ?? ''} maxLength={120} className={input} />
          </Field>
          <Field label="Mother’s occupation">
            <input name="mother_occupation" defaultValue={profile.mother_occupation ?? ''} maxLength={120} className={input} />
          </Field>
          <Field label="Siblings">
            <input name="siblings" defaultValue={profile.siblings ?? ''} maxLength={120} className={input} />
          </Field>
          <Field label="Family type">
            <OptionSelect name="family_type" value={profile.family_type} options={familyTypeOptions} allowEmpty={false} />
          </Field>
          <Field label="Family location">
            <input name="family_location" defaultValue={profile.family_location ?? ''} maxLength={120} className={input} />
          </Field>
          <label className="block text-xs font-semibold text-stone-500 sm:col-span-2">
            Family details
            <textarea name="family_details" defaultValue={profile.family_details ?? ''} maxLength={500} rows={3} className={input} />
          </label>
        </Section>

        <Section title="Partner preferences">
          <Field label="Looking for">
            <OptionSelect name="preferred_gender" value={prefs?.preferred_gender ?? 'female'} options={genderOptions} allowEmpty={false} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min age">
              <input name="min_age" type="number" min={18} max={60} defaultValue={prefs?.min_age ?? 21} className={input} />
            </Field>
            <Field label="Max age">
              <input name="max_age" type="number" min={18} max={60} defaultValue={prefs?.max_age ?? 35} className={input} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min height (cm)">
              <input name="min_height_cm" type="number" min={120} max={220} defaultValue={prefs?.min_height_cm ?? ''} className={input} />
            </Field>
            <Field label="Max height (cm)">
              <input name="max_height_cm" type="number" min={120} max={220} defaultValue={prefs?.max_height_cm ?? ''} className={input} />
            </Field>
          </div>
          <Field label="Preferred cities" hint="Comma-separated.">
            <input name="preferred_cities" defaultValue={(prefs?.preferred_cities ?? []).join(', ')} className={input} />
          </Field>
          <Field label="Preferred sub-communities" hint="Comma-separated; unknown names are dropped by the database.">
            <input name="preferred_sub_communities" defaultValue={(prefs?.preferred_sub_communities ?? []).join(', ')} className={input} />
          </Field>
          <Field label="Preferred education">
            <OptionSelect name="preferred_education" value={prefs?.preferred_education} options={educationOptions} emptyLabel="Any" />
          </Field>
          <Field label="Preferred occupation">
            <OptionSelect name="preferred_occupation" value={prefs?.preferred_occupation} options={occupationOptions} emptyLabel="Any" />
          </Field>
          <Field label="Preferred income">
            <OptionSelect name="preferred_income" value={prefs?.preferred_income} options={incomeOptions} emptyLabel="Any" />
          </Field>
          <Field label="Preferred diet">
            <OptionSelect name="preferred_diet" value={prefs?.preferred_diet} options={dietOptions} emptyLabel="Any" />
          </Field>
          <Field label="Preferred marital status">
            <OptionSelect name="preferred_marital_status" value={prefs?.preferred_marital_status} options={maritalStatusOptions} emptyLabel="Any" />
          </Field>
          <Field label="Preferred family type">
            <OptionSelect name="preferred_family_type" value={prefs?.preferred_family_type} options={familyTypeOptions} emptyLabel="Any" />
          </Field>
          <Field label="Preferred native place">
            <input name="preferred_native_place" defaultValue={prefs?.preferred_native_place ?? ''} maxLength={80} className={input} />
          </Field>
          <label className="block text-xs font-semibold text-stone-500 sm:col-span-2">
            Preference note
            <textarea name="note" defaultValue={prefs?.note ?? ''} maxLength={500} rows={2} className={input} />
          </label>
        </Section>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-full bg-maroon px-6 py-2.5 text-sm font-bold text-white hover:bg-maroon-dark">
            <Save className="h-4 w-4" /> Save changes
          </button>
          <Link href={`/admin/members/${person.id}`} className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-bold text-stone-700 hover:border-maroon">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
