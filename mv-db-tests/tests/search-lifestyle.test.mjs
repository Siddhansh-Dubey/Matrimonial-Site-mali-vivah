// Advanced Search lifestyle filters (Step 5) — database-level assertions.
//
// Exercises the real search_matches() SECURITY DEFINER RPC with PostgREST-like
// authenticated roles. The suite covers the lifestyle predicates, their
// Premium/VIP benefit gate, enum validation, AND/NULL semantics, the existing
// advanced filters, and the existing discovery/visibility exclusions.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Checks,
  activatePackage,
  asUser,
  completeProfile,
  expectError,
  migrationsDir,
  one,
  scalar,
  signUp,
} from '../lib/harness.mjs'

const MIGRATION = '20260919100000_search_lifestyle_filters.sql'
const repoFile = (rel) => readFileSync(join(migrationsDir, '..', '..', rel), 'utf8')

let seq = 0
async function member(db, tag, { gender = 'male', pkgSlug = null } = {}) {
  seq += 1
  const id = await signUp(db, {
    email: `${tag}@example.com`,
    name: `Member ${tag}`,
    mobile: '7' + String(400000000 + seq).padStart(9, '0'),
  })
  await completeProfile(db, id, { gender })
  if (pkgSlug) await activatePackage(db, id, pkgSlug)
  return id
}

async function candidate(db, tag, {
  dateOfBirth = '1998-01-01',
  city = 'Pune',
  education = 'Masters',
  occupation = 'Engineer',
  subCommunityId,
  diet = 'vegetarian',
  smoking = 'never',
  drinking = 'never',
  height = 165,
  pkgSlug = 'smart-3-month',
} = {}) {
  const id = await member(db, tag, { gender: 'female' })
  await db.query(
    `UPDATE public.matrimony_profiles
     SET date_of_birth = $2::date,
         city = $3,
         education = $4,
         occupation = $5,
         sub_community_id = $6,
         diet = $7::public.diet,
         smoking = $8::public.lifestyle_choice,
         drinking = $9::public.lifestyle_choice,
         height_cm = $10
     WHERE user_id = $1`,
    [id, dateOfBirth, city, education, occupation, subCommunityId ?? null, diet, smoking, drinking, height]
  )
  if (pkgSlug) await activatePackage(db, id, pkgSlug)
  return id
}

const defaults = {
  lookingFor: 'female',
  minAge: null,
  maxAge: null,
  city: null,
  subCommunity: null,
  education: null,
  occupation: null,
  nativePlace: null,
  maritalStatus: null,
  diet: null,
  minIncome: null,
  minHeight: null,
  maxHeight: null,
  smoking: null,
  drinking: null,
}

/** Call every parameter by name, matching the Supabase RPC contract. */
const search = (db, viewerId, filters = {}) => {
  const p = { ...defaults, ...filters }
  return asUser(db, viewerId, () =>
    scalar(
      db,
      `SELECT public.search_matches(
         p_looking_for => $1::public.gender,
         p_min_age => $2::integer,
         p_max_age => $3::integer,
         p_city => $4::text,
         p_sub_community => $5::text,
         p_limit => 200,
         p_education => $6::text,
         p_occupation => $7::text,
         p_native_place => $8::text,
         p_marital_status => $9::public.marital_status,
         p_diet => $10::public.diet,
         p_min_income => $11::text,
         p_min_height => $12::integer,
         p_max_height => $13::integer,
         p_smoking => $14::public.lifestyle_choice,
         p_drinking => $15::public.lifestyle_choice
       ) AS r`,
      [
        p.lookingFor, p.minAge, p.maxAge, p.city, p.subCommunity,
        p.education, p.occupation, p.nativePlace, p.maritalStatus, p.diet,
        p.minIncome, p.minHeight, p.maxHeight, p.smoking, p.drinking,
      ]
    )
  )
}

const ids = (result) => (result ?? []).map((card) => card.user_id)
const containsAll = (result, expected) => expected.every((id) => ids(result).includes(id))

export default async function run(db) {
  const t = new Checks('search-lifestyle')

  // ── callers and authoritative community rows ──────────────────────────────
  const premium = await member(db, 'life-premium', { pkgSlug: 'premium-6-month' })
  const vip = await member(db, 'life-vip', { pkgSlug: 'vip-12-month' })
  const free = await member(db, 'life-free')
  const phul = await one(db, `SELECT id, name FROM public.sub_communities WHERE slug = 'phul-mali'`)
  const lal = await one(db, `SELECT id, name FROM public.sub_communities WHERE slug = 'lal-mali'`)
  const mali = await one(db, `SELECT id, name FROM public.sub_communities WHERE slug = 'mali'`)

  // Public candidates deliberately vary one or more lifestyle/basic fields.
  const a = await candidate(db, 'life-a', {
    dateOfBirth: '1998-01-01', city: 'Pune', education: 'Masters', occupation: 'Engineer',
    subCommunityId: phul.id, diet: 'vegetarian', smoking: 'never', drinking: 'never', height: 165,
  })
  const b = await candidate(db, 'life-b', {
    dateOfBirth: '1991-01-01', city: 'Mumbai', education: 'Bachelors', occupation: 'Teacher / Academic',
    subCommunityId: lal.id, diet: 'vegan', smoking: 'occasionally', drinking: 'never', height: 158,
  })
  const c = await candidate(db, 'life-c', {
    dateOfBirth: '1986-01-01', city: 'Pune', education: 'Masters', occupation: 'Engineer',
    subCommunityId: phul.id, diet: 'vegetarian', smoking: 'never', drinking: 'regularly', height: 170,
  })
  const d = await candidate(db, 'life-d', {
    dateOfBirth: '2000-01-01', city: 'Nashik', education: 'Doctorate', occupation: 'Doctor / Medical',
    subCommunityId: mali.id, diet: 'eggetarian', smoking: 'regularly', drinking: 'occasionally', height: 160,
  })
  const nullLifestyle = await candidate(db, 'life-null', {
    dateOfBirth: '1997-01-01', city: 'Pune', education: 'Diploma', occupation: 'Working Professional',
    subCommunityId: mali.id, diet: 'jain', smoking: 'occasionally', drinking: 'occasionally', height: 162,
  })

  // Current production columns are NOT NULL. Relax them only inside this
  // throw-away test database to prove the SQL predicates remain safe for a
  // legacy/imported missing value if the model ever permits one.
  await db.exec(`ALTER TABLE public.matrimony_profiles
                   ALTER COLUMN diet DROP NOT NULL,
                   ALTER COLUMN smoking DROP NOT NULL,
                   ALTER COLUMN drinking DROP NOT NULL`)
  await db.query(
    `UPDATE public.matrimony_profiles SET diet = NULL, smoking = NULL, drinking = NULL WHERE user_id = $1`,
    [nullLifestyle]
  )

  // Profiles that look like matches but must remain undiscoverable.
  const blocked = await candidate(db, 'life-blocked', {
    subCommunityId: phul.id, diet: 'vegetarian', smoking: 'never', drinking: 'never',
  })
  await asUser(db, premium, () =>
    db.query(`INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [premium, blocked]))

  const hidden = await candidate(db, 'life-hidden', {
    subCommunityId: phul.id, diet: 'vegetarian', smoking: 'never', drinking: 'never',
  })
  await db.query(`UPDATE public.matrimony_profiles SET status = 'hidden' WHERE user_id = $1`, [hidden])

  const expired = await candidate(db, 'life-expired', {
    subCommunityId: phul.id, diet: 'vegetarian', smoking: 'never', drinking: 'never',
  })
  await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [expired])

  const freeCandidate = await candidate(db, 'life-free-candidate', {
    subCommunityId: phul.id, diet: 'vegetarian', smoking: 'never', drinking: 'never', pkgSlug: null,
  })

  const eligible = [a, b, c, d, nullLifestyle]

  console.log(' [1] no lifestyle filters / neutral filters preserve existing search')
  {
    const unfiltered = await search(db, premium)
    t.check('advanced search without lifestyle filters still returns all eligible candidates',
      containsAll(unfiltered, eligible), ids(unfiltered))
    const neutral = await search(db, premium, { diet: null, smoking: null, drinking: null })
    t.equal('explicit neutral NULL filters return the same candidate ids',
      ids(neutral).sort(), ids(unfiltered).sort())
    t.check('neutral lifestyle filters keep a candidate whose lifestyle values are NULL',
      ids(neutral).includes(nullLifestyle), ids(neutral))
  }

  console.log(' [2] each lifestyle field filters with the profile-model enum')
  {
    const diet = await search(db, premium, { diet: 'vegan' })
    t.check('Diet = vegan includes the vegan candidate', ids(diet).includes(b), ids(diet))
    t.check('Diet = vegan excludes non-vegan and NULL candidates',
      !ids(diet).includes(a) && !ids(diet).includes(nullLifestyle), ids(diet))

    const smoking = await search(db, premium, { smoking: 'never' })
    t.check('Smoking = never includes both never-smoking candidates', containsAll(smoking, [a, c]), ids(smoking))
    t.check('Smoking = never excludes occasional, regular and NULL candidates',
      [b, d, nullLifestyle].every((id) => !ids(smoking).includes(id)), ids(smoking))

    const drinking = await search(db, premium, { drinking: 'never' })
    t.check('Drinking = never includes both non-drinking candidates', containsAll(drinking, [a, b]), ids(drinking))
    t.check('Drinking = never excludes regular, occasional and NULL candidates',
      [c, d, nullLifestyle].every((id) => !ids(drinking).includes(id)), ids(drinking))
  }

  console.log(' [3] lifestyle predicates combine with AND semantics')
  {
    const combined = await search(db, premium, {
      diet: 'vegetarian', smoking: 'never', drinking: 'never',
    })
    t.check('the candidate satisfying all three selected values remains', ids(combined).includes(a), ids(combined))
    t.check('a candidate failing only drinking is excluded', !ids(combined).includes(c), ids(combined))
    t.check('every eligible returned row satisfies the full intersection',
      ids(combined).filter((id) => eligible.includes(id)).every((id) => id === a), ids(combined))
  }

  console.log(' [4] Premium/VIP benefit gate is enforced inside the RPC')
  {
    t.equal('free caller does not have advanced_search',
      await asUser(db, free, () => scalar(db, `SELECT public.has_benefit('advanced_search') AS r`)), false)
    t.equal('Premium caller has advanced_search',
      await asUser(db, premium, () => scalar(db, `SELECT public.has_benefit('advanced_search') AS r`)), true)
    t.equal('VIP caller has advanced_search',
      await asUser(db, vip, () => scalar(db, `SELECT public.has_benefit('advanced_search') AS r`)), true)

    // A direct RPC call with restrictive advanced parameters must be inert for
    // FREE, not a hidden UI-only gate. Seeing A (not vegan / not occasional)
    // proves that the supplied values did not filter server results.
    const bypass = await search(db, free, { diet: 'vegan', smoking: 'occasionally' })
    t.check('free direct caller cannot activate lifestyle filtering',
      ids(bypass).includes(a) && ids(bypass).includes(b), ids(bypass))

    const premiumFiltered = await search(db, premium, { smoking: 'regularly' })
    t.check('Premium can use a lifestyle filter', ids(premiumFiltered).includes(d), ids(premiumFiltered))
    t.check('Premium filtering actually excludes a non-match', !ids(premiumFiltered).includes(a), ids(premiumFiltered))

    const vipFiltered = await search(db, vip, { diet: 'eggetarian', drinking: 'occasionally' })
    t.check('VIP can combine lifestyle filters', ids(vipFiltered).includes(d), ids(vipFiltered))
    t.check('VIP combined filter excludes a non-match', !ids(vipFiltered).includes(b), ids(vipFiltered))
  }

  console.log(' [5] existing advanced/basic filters keep their previous semantics')
  {
    const subCommunity = await search(db, premium, { subCommunity: 'Phul Mali' })
    t.check('existing sub-community advanced filter still includes Phul Mali rows',
      containsAll(subCommunity, [a, c]), ids(subCommunity))
    t.check('existing sub-community advanced filter still excludes Lal Mali',
      !ids(subCommunity).includes(b), ids(subCommunity))

    const existing = await search(db, premium, {
      city: 'Pune', minAge: 27, maxAge: 30,
      education: 'Masters', occupation: 'Engineer', subCommunity: 'Phul Mali',
    })
    t.check('age + location + education + occupation + sub-community still find the expected row',
      ids(existing).includes(a), ids(existing))
    t.check('age/basic constraints still exclude otherwise similar rows',
      !ids(existing).includes(c) && !ids(existing).includes(b), ids(existing))

    const withLifestyle = await search(db, premium, {
      city: 'Pune', minAge: 27, maxAge: 30,
      education: 'Masters', occupation: 'Engineer', subCommunity: 'Phul Mali',
      diet: 'vegetarian', smoking: 'never', drinking: 'never',
    })
    t.check('existing and lifestyle filters combine in one database query',
      ids(withLifestyle).includes(a), ids(withLifestyle))
  }

  console.log(' [6] visibility and safety predicates cannot be bypassed')
  {
    const broad = await search(db, premium)
    t.check('blocked profile remains excluded', !ids(broad).includes(blocked), ids(broad))
    t.check('hidden/non-public profile remains excluded', !ids(broad).includes(hidden), ids(broad))
    t.check('expired profile remains excluded', !ids(broad).includes(expired), ids(broad))
    t.check('free/unactivated profile remains excluded', !ids(broad).includes(freeCandidate), ids(broad))

    const restrictive = await search(db, premium, {
      diet: 'vegetarian', smoking: 'never', drinking: 'never', subCommunity: 'Phul Mali',
    })
    t.check('lifestyle filters do not reintroduce a blocked profile', !ids(restrictive).includes(blocked), ids(restrictive))
    t.check('lifestyle filters do not reintroduce hidden/expired/free profiles',
      [hidden, expired, freeCandidate].every((id) => !ids(restrictive).includes(id)), ids(restrictive))
  }

  console.log(' [7] invalid values are rejected by typed RPC parameters')
  {
    const badSmoking = await expectError(() => asUser(db, premium, () =>
      scalar(db, `SELECT public.search_matches(p_smoking => 'sometimes'::public.lifestyle_choice) AS r`)))
    t.check('invalid smoking enum is rejected before it can affect results',
      /invalid input value for enum lifestyle_choice/i.test(badSmoking), badSmoking)

    const badDiet = await expectError(() => asUser(db, premium, () =>
      scalar(db, `SELECT public.search_matches(p_diet => 'anything'::public.diet) AS r`)))
    t.check('invalid diet enum is rejected before it can affect results',
      /invalid input value for enum diet/i.test(badDiet), badDiet)
  }

  console.log(' [8] migration/UI contract hygiene')
  {
    const signature = await one(
      db,
      `SELECT count(*) FILTER (WHERE p.pronargs = 16)::int AS current_count,
              count(*) FILTER (WHERE p.pronargs = 14)::int AS old_count
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'search_matches'`
    )
    t.equal('exactly one 16-argument RPC exists and the obsolete overload is gone',
      [signature.current_count, signature.old_count], [1, 0])

    const migration = repoFile(`supabase/migrations/${MIGRATION}`)
    t.check('migration uses typed optional smoking/drinking parameters',
      /p_smoking\s+public\.lifestyle_choice DEFAULT NULL/.test(migration)
      && /p_drinking\s+public\.lifestyle_choice DEFAULT NULL/.test(migration))
    t.check('each lifestyle predicate is protected by v_advanced',
      ['p_diet', 'p_smoking', 'p_drinking'].every((p) =>
        new RegExp(`NOT v_advanced OR ${p} IS NULL OR mp\\.`).test(migration)))

    const page = repoFile('src/app/search/page.tsx')
    t.check('URL inputs are allow-listed against the model options before the RPC call',
      /dietOptions[\s\S]*includes\(searchParams\?\.diet/.test(page)
      && /lifestyleOptions[\s\S]*includes\(searchParams\?\.smoking/.test(page)
      && /lifestyleOptions[\s\S]*includes\(searchParams\?\.drinking/.test(page))
    t.check('frontend sends all lifestyle values only through the existing advanced gate',
      /p_diet: advancedSearch \? adv\.diet : null/.test(page)
      && /p_smoking: advancedSearch \? adv\.smoking : null/.test(page)
      && /p_drinking: advancedSearch \? adv\.drinking : null/.test(page))

    const daily5Definitions = await scalar(
      db,
      `SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'get_daily_matches'`
    )
    t.equal('Daily 5 function remains present and untouched by this migration', daily5Definitions, 1)
  }

  return t
}
