'use client'

import { CalendarDays, ChevronDown, HeartHandshake, MapPin, Search, ShieldCheck, Users } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

const AGES = Array.from({ length: 43 }, (_, i) => String(18 + i))

const CHIPS = [
  { Icon: ShieldCheck, key: 'home.search.chip1' },
  { Icon: Users, key: 'home.search.chip2' },
  { Icon: HeartHandshake, key: 'home.search.chip3' },
]

export function SearchMatchesSection() {
  const { t } = useI18n()

  return (
    <section className="relative overflow-hidden bg-cream">
      {/* decorative script, upper right */}
      <div aria-hidden className="pointer-events-none absolute right-8 top-6 hidden select-none xl:block">
        <p className="rotate-2 font-script text-4xl leading-[1.3] text-gold-600/30">
          {t('home.hero.script1')}
          <br />
          {t('home.hero.script2')}
        </p>
      </div>

      <div className="container-page relative py-20 sm:py-24">
        {/* heading */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
            {t('home.search.kicker')}
          </p>
          <h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            <span className="text-maroon-deep">{t('home.search.titleA')}</span>{' '}
            <span className="text-gold-600">{t('home.search.titleB')}</span>
          </h2>
        </div>

        {/* search band */}
        <form
          action="/search"
          method="get"
          className="relative mt-12 overflow-hidden rounded-[28px] bg-maroon-deep px-6 py-8 shadow-2xl shadow-maroon/30 sm:px-9 sm:py-9 lg:px-11"
        >
          {/* subtle gold shimmer lines */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(circle at 8% 0%, rgba(212,160,50,0.25) 0, transparent 30%), radial-gradient(circle at 96% 100%, rgba(212,160,50,0.18) 0, transparent 26%)',
            }}
          />

          <div className="relative">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="font-display text-xl font-bold text-white sm:text-2xl">
                {t('home.search.bandTitle')}
              </span>
              <span className="font-display text-sm italic text-gold-300/90 sm:text-base">
                {t('home.search.tagline')}
              </span>
            </div>

            <div className="mt-7 grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-[1.15fr_0.85fr_0.85fr_0.95fr_1.25fr_auto] lg:items-end">
              {/* Looking for */}
              <div>
                <span className="label-white">{t('home.search.lookingFor')}</span>
                <div className="mt-2 flex gap-2">
                  {(['bride', 'groom'] as const).map((value) => (
                    <label key={value} className="cursor-pointer">
                      <input
                        type="radio"
                        name="lookingFor"
                        value={value}
                        defaultChecked={value === 'bride'}
                        className="peer sr-only"
                      />
                      <span className="inline-flex items-center justify-center rounded-full border border-white/35 px-4 py-2 text-sm font-semibold text-white transition-colors peer-checked:border-white peer-checked:bg-white peer-checked:text-maroon-deep peer-hover:bg-white/10 peer-checked:hover:bg-white">
                        {t(value === 'bride' ? 'home.search.bride' : 'home.search.groom')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Age from */}
              <Field label={t('home.search.ageFrom')}>
                <Select name="ageFrom" placeholder={t('home.search.selectAge')} options={AGES} />
              </Field>

              {/* Age to */}
              <Field label={t('home.search.ageTo')}>
                <Select name="ageTo" placeholder={t('home.search.selectAge')} options={AGES} />
              </Field>

              {/* Location */}
              <Field label={t('home.search.location')}>
                <Select
                  name="location"
                  placeholder={t('home.search.selectCity')}
                  options={['Mumbai', 'Pune', 'Nashik', 'Nagpur', 'Thane', 'Aurangabad', 'Solapur', 'Other']}
                  icon={<MapPin className="h-4 w-4 text-maroon/60" aria-hidden />}
                />
              </Field>

              {/* Sub-community */}
              <Field label={t('home.search.subCommunity')}>
                <Select
                  name="subCommunity"
                  placeholder={t('home.search.selectSubCommunity')}
                  options={['Mali', 'Phul Mali', 'Maratha Mali', 'Lal Mali', 'Other']}
                />
              </Field>

              {/* Submit */}
              <button
                type="submit"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold-400 px-6 py-3 text-sm font-bold text-maroon-deep shadow-lg shadow-black/10 transition-all hover:bg-gold-300 active:scale-[0.98] sm:w-auto lg:mb-px"
              >
                <Search className="h-4 w-4" aria-hidden />
                {t('home.search.submit')}
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </button>
            </div>
          </div>
        </form>

        {/* trust chips */}
        <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {CHIPS.map(({ Icon, key }) => (
            <li key={key} className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm ring-1 ring-stone-200/70">
                <Icon className="h-4 w-4 text-maroon" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-stone-800">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
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

function Select({
  name,
  placeholder,
  options,
  icon,
}: {
  name: string
  placeholder: string
  options: string[]
  icon?: React.ReactNode
}) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{icon}</span>
      ) : (
        <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-maroon/60" aria-hidden />
      )}
      <select
        name={name}
        defaultValue=""
        className="w-full appearance-none rounded-full border border-white bg-white py-2.5 pl-10 pr-9 text-sm font-medium text-stone-800 outline-none transition-colors focus:ring-2 focus:ring-gold-400"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500"
        aria-hidden
      />
    </div>
  )
}
