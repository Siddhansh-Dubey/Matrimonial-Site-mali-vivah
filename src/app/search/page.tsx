import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronDown, Crown, MapPin, Search, SlidersHorizontal } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { BrowseGrid } from '@/components/profile/browse-grid'
import { hasActiveSubscription } from '@/lib/profile/subscription'
import {
  AGE_OPTIONS,
  cityOptions,
  dietOptions,
  educationOptions,
  incomeOptions,
  maritalStatusOptions,
  occupationOptions,
  subCommunityOptions,
} from '@/lib/profile/profile-schema'
import type { Diet, Gender, MaritalStatus, MatchCard as MatchCardType } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Search profiles' }
export const dynamic = 'force-dynamic'

type Params = {
  lookingFor?: string
  ageFrom?: string
  ageTo?: string
  location?: string
  subCommunity?: string
  // advanced (server gated — inert unless the plan includes advanced_search)
  education?: string
  occupation?: string
  nativePlace?: string
  maritalStatus?: string
  diet?: string
  minIncome?: string
  minHeight?: string
  maxHeight?: string
  advanced?: string
}

export default async function SearchPage({ searchParams }: { searchParams?: Params }) {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [advRes, sub, subsRes] = await Promise.all([
    supabase.rpc('has_benefit', { p_key: 'advanced_search' }),
    hasActiveSubscription(supabase, user.id),
    // Community values come from the database (seeded: Mali + sub-communities).
    supabase
      .from('sub_communities')
      .select('name')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])
  const advancedSearch = advRes.data === true
  const isPaid = sub
  const dbSubCommunities = ((subsRes.data ?? []) as { name: string }[]).map((r) => r.name)
  const subOptions = dbSubCommunities.length > 0 ? dbSubCommunities : [...subCommunityOptions]

  const lookingFor =
    searchParams?.lookingFor === 'groom' ? 'male' : searchParams?.lookingFor === 'bride' ? 'female' : null
  const minAge = parseNum(searchParams?.ageFrom)
  const maxAge = parseNum(searchParams?.ageTo)
  const city = searchParams?.location
  const subCommunity = searchParams?.subCommunity

  // Advanced filters — UI is only rendered for eligible plans, and the RPC
  // ignores these for everyone else (double-gated).
  const adv = {
    education: searchParams?.education || null,
    occupation: searchParams?.occupation || null,
    nativePlace: searchParams?.nativePlace || null,
    maritalStatus: (maritalStatusOptions as readonly string[]).includes(searchParams?.maritalStatus ?? '')
      ? (searchParams!.maritalStatus as MaritalStatus)
      : null,
    diet: (dietOptions as readonly string[]).includes(searchParams?.diet ?? '')
      ? (searchParams!.diet as Diet)
      : null,
    minIncome: searchParams?.minIncome || null,
    minHeight: parseNum(searchParams?.minHeight),
    maxHeight: parseNum(searchParams?.maxHeight),
  }

  const { data, error } = await supabase.rpc('search_matches', {
    p_looking_for: (lookingFor as Gender | null) ?? null,
    p_min_age: minAge,
    p_max_age: maxAge,
    p_city: city || null,
    // Sub-community is an advanced (Premium/VIP) filter — ignored otherwise.
    p_sub_community: advancedSearch ? subCommunity || null : null,
    p_limit: 120,
    p_education: advancedSearch ? adv.education : null,
    p_occupation: advancedSearch ? adv.occupation : null,
    p_native_place: advancedSearch ? adv.nativePlace : null,
    p_marital_status: advancedSearch ? adv.maritalStatus : null,
    p_diet: advancedSearch ? adv.diet : null,
    p_min_income: advancedSearch ? adv.minIncome : null,
    p_min_height: advancedSearch ? adv.minHeight : null,
    p_max_height: advancedSearch ? adv.maxHeight : null,
  })

  const matches = ((data ?? []) as MatchCardType[]) ?? []

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            Browse profiles
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            {lookingFor === 'male'
              ? 'Find a groom'
              : lookingFor === 'female'
                ? 'Find a bride'
                : 'Find your match'}
          </h1>
          <p className="mt-3 text-sm text-stone-600 sm:text-base">
            Verified Mali Samaj profiles, contact details kept private.
          </p>
        </div>

        {/* filter band */}
        <form
          action="/search"
          method="get"
          className="mx-auto mt-8 max-w-5xl rounded-[28px] bg-maroon-deep px-6 py-6 shadow-2xl shadow-maroon/30 sm:px-8"
        >
          {/* Basic search: bride/groom, age, location — available to everyone.
              The sub-community filter is an ADVANCED filter (server-gated). */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_0.8fr_1fr_auto] lg:items-end">
            <Field label="Looking for">
              <div className="flex gap-2">
                {(['bride', 'groom'] as const).map((v) => (
                  <label key={v} className="cursor-pointer">
                    <input
                      type="radio"
                      name="lookingFor"
                      value={v}
                      defaultChecked={lookingFor === (v === 'groom' ? 'male' : 'female')}
                      className="peer sr-only"
                    />
                    <span className="inline-flex items-center justify-center rounded-full border border-white/35 px-4 py-2 text-sm font-semibold text-white transition-colors peer-checked:border-white peer-checked:bg-white peer-checked:text-maroon-deep peer-hover:bg-white/10">
                      {v === 'bride' ? 'Bride' : 'Groom'}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Age from">
              <Select name="ageFrom" options={AGE_OPTIONS.map(String)} defaultValue={searchParams?.ageFrom} />
            </Field>
            <Field label="Age to">
              <Select name="ageTo" options={AGE_OPTIONS.map(String)} defaultValue={searchParams?.ageTo} />
            </Field>
            <Field label="Location">
              <Select
                name="location"
                options={[...cityOptions]}
                defaultValue={searchParams?.location}
                icon={<MapPin className="h-4 w-4 text-maroon/60" />}
              />
            </Field>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep shadow-lg hover:bg-gold-300 sm:w-auto"
            >
              <Search className="h-4 w-4" /> Search
            </button>
          </div>

          {/* Advanced filters — Premium & VIP plans only. The block is visible
              for everyone with context: paid members filter live; free members
              see exactly what the upgrade unlocks. The server re-checks. */}
          <details className="mt-5 border-t border-white/15 pt-4" open={searchParams?.advanced === '1'}>
            <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-white/80 hover:text-white">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" /> Advanced filters
                {!advancedSearch && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold-400/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-maroon-deep">
                    <Crown className="h-3 w-3" /> Premium · VIP
                  </span>
                )}
              </span>
              <ChevronDown className="h-4 w-4" />
            </summary>
            {advancedSearch ? (
              <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Sub-community">
                  <select name="subCommunity" defaultValue={searchParams?.subCommunity ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Any</option>
                    {subOptions.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Education">
                  <select name="education" defaultValue={searchParams?.education ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Any</option>
                    {educationOptions.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Occupation">
                  <select name="occupation" defaultValue={searchParams?.occupation ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Any</option>
                    {occupationOptions.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Marital status">
                  <select name="maritalStatus" defaultValue={searchParams?.maritalStatus ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Any</option>
                    {maritalStatusOptions.map((o) => (
                      <option key={o} value={o}>{titleCase(o)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Diet">
                  <select name="diet" defaultValue={searchParams?.diet ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Any</option>
                    {dietOptions.map((o) => (
                      <option key={o} value={o}>{titleCase(o)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Min. income">
                  <select name="minIncome" defaultValue={searchParams?.minIncome ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
                    <option value="">Any</option>
                    {incomeOptions.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Min height (cm)">
                  <input name="minHeight" type="number" min="120" max="220" defaultValue={searchParams?.minHeight ?? ''} placeholder="e.g. 150" className="w-full rounded-full border border-white bg-white px-4 py-2.5 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400" />
                </Field>
                <Field label="Max height (cm)">
                  <input name="maxHeight" type="number" min="120" max="220" defaultValue={searchParams?.maxHeight ?? ''} placeholder="e.g. 175" className="w-full rounded-full border border-white bg-white px-4 py-2.5 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400" />
                </Field>
                <Field label="Native place">
                  <input name="nativePlace" type="text" defaultValue={searchParams?.nativePlace ?? ''} placeholder="e.g. Satara" className="w-full rounded-full border border-white bg-white px-4 py-2.5 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400" />
                </Field>
                <input type="hidden" name="advanced" value="1" />
              </div>
            ) : (
              <p className="mt-3 max-w-2xl text-sm text-white/70">
                Filter by sub-community, education, occupation, marital status, diet, income,
                height and native place.{' '}
                <Link href="/packages" className="font-bold text-gold-300 underline underline-offset-2">
                  Upgrade to Premium or VIP
                </Link>{' '}
                to use them.
              </p>
            )}
          </details>
        </form>

        {/* results */}
        {error && (
          <p className="mt-10 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
            Could not load matches: {error.message}
          </p>
        )}

        {!error && <BrowseGrid matches={matches} isPaid={isPaid} clearHref="/search" />}
      </div>
    </section>
  )
}

function parseNum(v?: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function titleCase(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label-white">{label}</span>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Select({
  name,
  options,
  defaultValue,
  icon,
}: {
  name: string
  options: string[]
  defaultValue?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{icon}</span>
      ) : (
        <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-maroon/60" />
      )}
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-10 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
    </div>
  )
}
