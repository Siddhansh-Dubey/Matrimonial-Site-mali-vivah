import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronDown, MapPin, Search, SearchX } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { MatchCard } from '@/components/profile/match-card'
import { AGE_OPTIONS, cityOptions, subCommunityOptions } from '@/lib/profile/profile-schema'
import type { Gender, MatchCard as MatchCardType } from '@/lib/supabase/database.types'

export const metadata: Metadata = { title: 'Search profiles' }
export const dynamic = 'force-dynamic'

type Params = {
  lookingFor?: string
  ageFrom?: string
  ageTo?: string
  location?: string
  subCommunity?: string
}

export default async function SearchPage({ searchParams }: { searchParams?: Params }) {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const lookingFor = searchParams?.lookingFor === 'groom' ? 'male' : searchParams?.lookingFor === 'bride' ? 'female' : null
  const minAge = parseNum(searchParams?.ageFrom)
  const maxAge = parseNum(searchParams?.ageTo)
  const city = searchParams?.location
  const subCommunity = searchParams?.subCommunity

  const { data, error } = await supabase.rpc('search_matches', {
    p_looking_for: (lookingFor as Gender | null) ?? null,
    p_min_age: minAge,
    p_max_age: maxAge,
    p_city: city || null,
    p_sub_community: subCommunity || null,
    p_limit: 120,
  })

  const matches = (data ?? []) as MatchCardType[]

  return (
    <section className="bg-cream">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">Browse profiles</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-maroon sm:text-5xl">
            {lookingFor === 'male' ? 'Find a groom' : lookingFor === 'female' ? 'Find a bride' : 'Find your match'}
          </h1>
          <p className="mt-3 text-sm text-stone-600 sm:text-base">Verified Mali Samaj profiles, contact details kept private.</p>
        </div>

        {/* filter band */}
        <form
          action="/search"
          method="get"
          className="mx-auto mt-8 max-w-5xl rounded-[28px] bg-maroon-deep px-6 py-6 shadow-2xl shadow-maroon/30 sm:px-8"
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_0.8fr_1fr_1fr_auto] lg:items-end">
            <Field label="Looking for">
              <div className="flex gap-2">
                {(['bride', 'groom'] as const).map((v) => (
                  <label key={v} className="cursor-pointer">
                    <input type="radio" name="lookingFor" value={v} defaultChecked={lookingFor === (v === 'groom' ? 'male' : 'female')} className="peer sr-only" />
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
              <Select name="location" options={[...cityOptions]} defaultValue={searchParams?.location} icon={<MapPin className="h-4 w-4 text-maroon/60" />} />
            </Field>
            <Field label="Sub-community">
              <Select name="subCommunity" options={[...subCommunityOptions]} defaultValue={searchParams?.subCommunity} />
            </Field>
            <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold-400 px-6 py-2.5 text-sm font-bold text-maroon-deep shadow-lg hover:bg-gold-300 sm:w-auto">
              <Search className="h-4 w-4" /> Search
            </button>
          </div>
        </form>

        {/* results */}
        <p className="mt-10 text-sm text-stone-500">
          {matches.length} {matches.length === 1 ? 'profile' : 'profiles'} found
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
            Could not load matches: {error.message}
          </p>
        )}

        {!error && matches.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md text-center">
            <SearchX className="mx-auto h-12 w-12 text-stone-300" />
            <h2 className="mt-4 font-display text-xl font-bold text-maroon">No matches yet</h2>
            <p className="mt-2 text-sm text-stone-600">
              Try widening your filters, or come back soon — new verified profiles are added regularly.
            </p>
            <Link href="/search" className="btn-secondary mt-6">
              Clear filters
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {matches.map((m) => (
              <li key={m.user_id}>
                <MatchCard match={m} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function parseNum(v?: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
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
      <select name={name} defaultValue={defaultValue ?? ''} className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-10 pr-9 text-sm font-medium text-stone-800 outline-none focus:ring-2 focus:ring-gold-400">
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
