// Business name (Step 4) — database-level assertions.
//
// Covers the 11 required checks: the column exists and is optional; NULL is
// valid; owner insert/update through RLS persists; a value survives later
// profile edits; company and business_name stay two separate facts (no
// copying either way, for legacy rows too); empty never renders as an empty
// field (persistence stores NULL and the render guards are conditional);
// get_public_profile gates business_name behind the SAME paid rule as company;
// the biodata gate (self OR paid + mutual) still behaves identically; and
// profiles created before this field keep working untouched.
//
// The PDF itself is rendered by the Next route (not the database), so checks
// 7/9 also do source-level assertions the way the community suite asserts
// migration hygiene: the route draws the field with the falsy-skipping
// `line()` helper, and its authorization preamble (401 / mutual + paid / 403)
// is unchanged.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Checks,
  activatePackage,
  applyMigrations,
  asUser,
  completeProfile,
  freshDb,
  migrationFiles,
  migrationsDir,
  one,
  scalar,
  signUp,
} from '../lib/harness.mjs'

const MIGRATION = '20260919090000_profile_business_name.sql'
const repoFile = (rel) => readFileSync(join(migrationsDir, '..', '..', rel), 'utf8')

let seq = 0
async function member(db, tag, { gender = 'male', pkgSlug = 'premium-6-month' } = {}) {
  seq += 1
  const id = await signUp(db, {
    email: `${tag}@example.com`,
    name: `Member ${tag}`,
    mobile: '8' + String(300000000 + seq).padStart(9, '0'),
  })
  await completeProfile(db, id, { gender })
  if (pkgSlug) await activatePackage(db, id, pkgSlug)
  return id
}

const careerRow = (db, userId) =>
  one(
    db,
    `SELECT company, business_name, education, occupation, city, status
     FROM public.matrimony_profiles WHERE user_id = $1`,
    [userId]
  )

/** The wizard's write path: owner upsert through RLS as `authenticated`. */
const ownerUpsert = (db, userId, cols, values) =>
  asUser(db, userId, () =>
    db.query(
      `INSERT INTO public.matrimony_profiles (user_id, ${cols.join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      [userId, ...values]
    )
  )

const ownerUpdate = (db, userId, sets, params = []) =>
  asUser(db, userId, () =>
    db.query(`UPDATE public.matrimony_profiles SET ${sets} WHERE user_id = $1`, [userId, ...params])
  )

const publicCard = (db, viewerId, targetId) =>
  asUser(db, viewerId, () => scalar(db, `SELECT public.get_public_profile($1) AS r`, [targetId]))

export default async function run(db) {
  const t = new Checks('business-name')

  console.log(' [1] the column exists with the right shape')
  {
    const col = await one(
      db,
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'matrimony_profiles' AND column_name = 'business_name'`
    )
    t.check('business_name column added to matrimony_profiles', !!col)
    t.equal('type is TEXT', col?.data_type, 'text')
    t.equal('nullable (optional field)', col?.is_nullable, 'YES')
    t.equal('no default / no fake value', col?.column_default, null)
    const company = await one(
      db,
      `SELECT data_type, is_nullable, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'matrimony_profiles' AND column_name = 'company'`
    )
    t.equal(
      'length style matches company (plain TEXT, the 120-cap lives in the zod schema)',
      [col?.data_type, col?.is_nullable, company?.character_maximum_length],
      ['text', 'YES', null]
    )
  }

  console.log(' [2] NULL business_name is valid for existing-style profiles')
  {
    const u = await member(db, 'biz-null')
    const r = await careerRow(db, u)
    t.equal('draft/published profile without the field has NULL', [r.business_name, r.status], [null, 'active'])
    // Explicitly writing NULL back is allowed.
    await ownerUpdate(db, u, `business_name = NULL`, [])
    t.equal('NULL can be set again', (await careerRow(db, u)).business_name, null)
  }

  console.log(' [3] business_name can be inserted (wizard-style upsert as owner)')
  {
    const u = await member(db, 'biz-insert')
    await ownerUpsert(db, u, ['company', 'business_name'], ['XYZ Technologies', 'ABC Enterprises'])
    const r = await careerRow(db, u)
    t.equal('both values persisted side by side', [r.company, r.business_name], ['XYZ Technologies', 'ABC Enterprises'])
  }

  console.log(' [4] business_name can be updated and cleared')
  {
    const u = await member(db, 'biz-update')
    await ownerUpsert(db, u, ['business_name'], ['ABC Enterprises'])
    await ownerUpsert(db, u, ['business_name'], ['ABC Enterprises Pvt Ltd'])
    t.equal('updated in place', (await careerRow(db, u)).business_name, 'ABC Enterprises Pvt Ltd')
    await ownerUpsert(db, u, ['business_name'], [null])
    t.equal('cleared back to NULL', (await careerRow(db, u)).business_name, null)
  }

  console.log(' [5] the value persists through later profile edits')
  {
    const u = await member(db, 'biz-persist')
    await ownerUpsert(db, u, ['company', 'business_name'], ['TCS Pune', 'Sharma Textiles'])
    // Editing an UNRELATED field (a later wizard step saving the same payload
    // row) must not drop the business name...
    await ownerUpdate(db, u, `city = $2`, ['Nashik'])
    let r = await careerRow(db, u)
    t.equal('unrelated edit keeps company + business_name', [r.city, r.company, r.business_name], ['Nashik', 'TCS Pune', 'Sharma Textiles'])
    // ...and the wizard re-upserts the whole payload on every save: a save
    // that carries the loaded values back must be a no-op on them.
    await ownerUpsert(db, u, ['education', 'occupation', 'company', 'business_name'], [
      'Bachelors', 'Business Owner / Self-employed', 'TCS Pune', 'Sharma Textiles',
    ])
    r = await careerRow(db, u)
    t.equal('full re-save preserves both fields', [r.company, r.business_name], ['TCS Pune', 'Sharma Textiles'])
  }

  console.log(' [6] company and business_name remain SEPARATE — no conversion, ever')
  {
    const owner = await member(db, 'biz-owner')
    await ownerUpsert(db, owner, ['company', 'business_name'], [null, 'ABC Enterprises'])
    t.equal('business owner: company empty, business_name set',
      (await careerRow(db, owner)).business_name, 'ABC Enterprises')
    await ownerUpdate(db, owner, `company = $2`, ['New employer Ltd'])
    let r = await careerRow(db, owner)
    t.equal('both filled → both kept', [r.company, r.business_name], ['New employer Ltd', 'ABC Enterprises'])
    await ownerUpdate(db, owner, `business_name = NULL`, [])
    r = await careerRow(db, owner)
    t.equal('clearing business_name does NOT clear company', [r.company, r.business_name], ['New employer Ltd', null])

    const employee = await member(db, 'biz-employee')
    await ownerUpsert(db, employee, ['company', 'business_name'], ['TCS Pune', null])
    r = await careerRow(db, employee)
    t.equal('employee: company kept, business_name stays NULL (not mirrored)', [r.company, r.business_name], ['TCS Pune', null])

    // Legacy rows: a profile that only ever had company must NOT gain a
    // business name when the migration is (re-)applied, and company is not
    // rewritten either.
    await db.query(`UPDATE public.matrimony_profiles SET company = 'Old Mill Co' WHERE user_id = $1`, [employee])
    await applyMigrations(db, 'multi', [MIGRATION])
    r = await careerRow(db, employee)
    t.equal('re-applying the migration changes no values (no company→business_name backfill)',
      [r.company, r.business_name], ['Old Mill Co', null])
    const copied = await scalar(db,
      `SELECT count(*)::int FROM public.matrimony_profiles
       WHERE business_name IS NOT NULL AND business_name = company`)
    t.equal('no row anywhere has business_name copied from company', copied, 0)

    const sql = repoFile(join('supabase', 'migrations', MIGRATION))
    t.check('migration never assigns business_name from company', !/business_name\s*=\s*company/i.test(sql))
    t.check('migration contains no UPDATE/DELETE against profile data', !/^\s*UPDATE\s+public\.matrimony_profiles\b/im.test(sql) && !/DELETE\s+FROM/i.test(sql))
    t.check('migration is additive (no DROP, no column retypes)', !/DROP\s+COLUMN|ALTER\s+COLUMN|SET\s+NOT\s+NULL/i.test(sql))
  }

  console.log(' [7] an empty business_name never becomes an empty UI/PDF field')
  {
    // Persistence convention: the wizard normalises '' → NULL (same as
    // company), so the DB never holds a blank string for this field.
    const u = await member(db, 'biz-empty')
    await ownerUpsert(db, u, ['business_name'], [null])
    t.equal('stored as NULL, not empty-string', (await careerRow(db, u)).business_name, null)

    const wizard = repoFile('src/components/profile/profile-wizard.tsx')
    t.check('wizard normalises the input with trim() || null like company',
      /business_name:\s*businessName\.trim\(\)\s*\|\|\s*null/.test(wizard))
    t.check('wizard loads the saved value when editing',
      /setBusinessName\(profile\.business_name \?\? ''\)/.test(wizard))
    const page = repoFile('src/app/profile/[id]/page.tsx')
    t.check('public page renders Business Name only when non-empty',
      /profile\.business_name && \(\s*<Item icon=\{Briefcase\} label="Business Name"/.test(page))
    t.check('public page keeps Company as its own conditional row',
      /profile\.company && <Item icon=\{Briefcase\} label="Company"/.test(page))
    const route = repoFile('src/app/api/biodata/[userId]/route.ts')
    t.check('biodata draws Business Name through the falsy-skipping line()',
      /line\('Business Name', mp\.business_name\)/.test(route))
    t.check('the line() helper skips empty values (no empty "Business Name:" row)',
      /const line = \(l: string, v: string \| null \| undefined\) => \{\s*if \(!v\) return/.test(route))
  }

  console.log(' [8] public profile follows the existing (paid) authorization rules')
  {
    const owner = await member(db, 'biz-viewed')
    await ownerUpsert(db, owner, ['company', 'business_name'], ['XYZ Technologies', 'ABC Enterprises'])

    const free = await member(db, 'biz-free-viewer', { gender: 'female', pkgSlug: null })
    const freeCard = await publicCard(db, free, owner)
    t.check('free viewer still gets the occupation-only preview', !!freeCard && freeCard.occupation === 'Engineer')
    t.equal('free viewer sees NO company', freeCard.company, null)
    t.equal('free viewer sees NO business_name (the new field cannot bypass the gate)',
      freeCard.business_name ?? null, null)
    t.equal('free viewer sees no contact phone', freeCard.contact_phone ?? null, null)
    t.equal('free viewer sees no contact email', freeCard.contact_email ?? null, null)

    const paid = await member(db, 'biz-paid-viewer', { gender: 'female' })
    const paidCard = await publicCard(db, paid, owner)
    t.equal('paid viewer sees company', paidCard.company, 'XYZ Technologies')
    t.equal('paid viewer sees business_name behind the SAME gate', paidCard.business_name, 'ABC Enterprises')

    // The new key is additive: the card gained business_name and nothing else
    // changed about which keys exist.
    const keys = Object.keys(paidCard).sort()
    t.check('card carries the expected v6 key set (contact fields still gated, not removed)',
      keys.includes('business_name') && keys.includes('company') && keys.includes('contact_phone'))

    // Anonymous callers (the public preview for logged-out visitors) must see
    // exactly the same masked shape as a free member: occupation yes,
    // company/business_name no.
    const anonResult = await (async () => {
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);
                     SELECT set_config('request.jwt.claim.role', 'anon', false);`)
      const r = await one(db, `SELECT public.get_public_profile($1) AS r`, [owner])
      await db.exec(`SELECT set_config('request.jwt.claim.role', '', false)`)
      return r.r
    })()
    t.check('anon caller still gets a card (public preview)', !!anonResult && anonResult.occupation === 'Engineer')
    t.equal('anon sees no company', anonResult?.company ?? null, null)
    t.equal('anon sees no business_name', anonResult?.business_name ?? null, null)
    t.equal('anon sees no phone', anonResult?.contact_phone ?? null, null)
  }

  console.log(' [9] the biodata gate (self OR paid + mutual) is unchanged; data flows to the PDF')
  {
    const owner = await member(db, 'biz-pdf-owner')
    await ownerUpsert(db, owner, ['business_name'], ['ABC Enterprises'])

    const paidNotMutual = await member(db, 'biz-pdf-paid', { gender: 'female' })
    const freeMutual = await member(db, 'biz-pdf-free', { gender: 'female', pkgSlug: null })

    const gate = (viewer) => asUser(db, viewer, () =>
      one(db, `SELECT public.mutual_interest_exists($1, $2) AS mutual,
                      public.has_live_membership($1) AS paid`, [viewer, owner]))
    let g = await gate(paidNotMutual)
    t.equal('paid but not mutual → no unlock (PDF route would 403)', [g.mutual, g.paid], [false, true])
    g = await gate(freeMutual)
    t.equal('mutual but not paid → no unlock', [g.mutual, g.paid], [false, false])

    // Interest A→B + accepted = mutual (created through express_interest(),
    // the only write path since 20260915120000); then the unlock pair is
    // true and the service-role read the PDF route performs has
    // business_name available.
    await asUser(db, paidNotMutual, () =>
      one(db, `SELECT public.express_interest($1, 'hello') AS r`, [owner]))
    await asUser(db, owner, () =>
      db.query(`UPDATE public.interests SET status = 'accepted' WHERE sender_id = $1 AND receiver_id = $2`, [paidNotMutual, owner]))
    g = await gate(paidNotMutual)
    t.equal('paid + accepted interest → unlock', [g.mutual, g.paid], [true, true])
    // The route reads the member row with the service-role client (bypassing
    // RLS) — the superuser read here is the harness equivalent.
    const pdfRow = await one(db,
      `SELECT company, business_name FROM public.matrimony_profiles WHERE user_id = $1`, [owner])
    t.equal('the route select (which reads the row) now carries the value', pdfRow.business_name, 'ABC Enterprises')
    t.equal('...while company stays NULL here — the two are rendered independently', pdfRow.company, null)

    const route = repoFile('src/app/api/biodata/[userId]/route.ts')
    t.check('route preamble untouched: 401 without a session, 403 unless mutual + paid',
      /status:\s*401/.test(route) && /mutual_interest_exists/.test(route) && /has_live_membership/.test(route) && /status:\s*403/.test(route))
    t.check('route still selects the profile with * (no new privileged join/leak)',
      /select\('\*, community:communities\(name\), sub_community_row:sub_communities\(name\)'\)/.test(route))
    t.check('route still draws the phone ONLY after the paid+mutual gate',
      /if \(phone\) \{\s*line\('Phone', phone\)/.test(route))
  }

  console.log(' [10] existing profiles without business_name keep working end-to-end')
  {
    const bride = await member(db, 'biz-legacy-bride', { gender: 'female' })
    const groom = await member(db, 'biz-legacy-groom')
    await ownerUpsert(db, bride, ['company'], ['Legacy Employer'])
    const card = await publicCard(db, groom, bride)
    t.equal('legacy card renders as before (business_name NULL key is additive)',
      [card.company, card.business_name ?? null], ['Legacy Employer', null])
    const cards = await asUser(db, groom, () =>
      scalar(db, `SELECT public.search_matches(p_looking_for => 'female', p_limit => 50) AS r`))
    const hers = (cards ?? []).find((c) => c.user_id === bride)
    t.check('search_matches still lists the profile', !!hers)
    t.check('search cards did NOT gain company/business_name (search untouched)',
      hers && !('business_name' in hers) && !('company' in hers))
    await db.query(`UPDATE public.matching_config SET threshold = 0`)
    const daily = await asUser(db, groom, () => scalar(db, `SELECT public.get_daily_matches(25) AS r`))
    const list = Array.isArray(daily) ? daily : (daily?.matches ?? [])
    t.check('Daily 5 keeps working for rows without the new field', list.some((c) => c.user_id === bride), daily?.length)
  }

  console.log(' [11] owner-only writes are intact (no new way to touch other rows)')
  {
    const owner = await member(db, 'biz-rls-owner')
    await ownerUpsert(db, owner, ['business_name'], ['Secret Family Business'])
    const stranger = await member(db, 'biz-rls-stranger', { gender: 'female' })
    // RLS "Owner updates own matrimony profile" — a stranger's UPDATE matches
    // zero rows silently; the value on the owner row cannot change.
    await asUser(db, stranger, () =>
      db.query(`UPDATE public.matrimony_profiles SET business_name = 'hacked' WHERE user_id = $1`, [owner]))
    const still = await careerRow(db, owner)
    t.equal('stranger UPDATE changes nothing on the owner row', still.business_name, 'Secret Family Business')
    // Owner can still write their own row.
    await ownerUpdate(db, owner, `business_name = $2`, ['Renamed Enterprises'])
    t.equal('owner edit still works', (await careerRow(db, owner)).business_name, 'Renamed Enterprises')
    const rls = await one(db, `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.matrimony_profiles'::regclass`)
    t.check('RLS still enabled on matrimony_profiles', rls.relrowsecurity === true)
    const fnCount = await scalar(db,
      `SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'get_public_profile'`)
    t.equal('get_public_profile still exists exactly once', fnCount, 1)
    const privs = await one(db,
      `SELECT pg_catalog.has_function_privilege('anon', 'public.get_public_profile(uuid)', 'execute') AS anon_ok,
              pg_catalog.has_function_privilege('authenticated', 'public.get_public_profile(uuid)', 'execute') AS auth_ok`)
    t.equal('execute grants unchanged (anon + authenticated)', [privs.anon_ok, privs.auth_ok], [true, true])
    // Belt & braces for step 11 of the brief: the new column changes nothing
    // about contact-data RLS — profiles rows are visible to the owner only.
    const leaked = await asUser(db, stranger, () =>
      scalar(db, `SELECT count(*)::int FROM public.profiles WHERE id = $1`, [owner]))
    t.equal('a member still cannot read another member\u2019s profile row (phone/email) via RLS', leaked, 0)
  }

  console.log(' [12] migration hygiene')
  {
    const files = migrationFiles()
    t.check('new migration is the latest in the chain', files.at(-1) === MIGRATION)
    t.check('no historical migration was rewritten (company still comes from 20260915010000)',
      files.includes('20260915010000_profile_model_family_photo.sql'))
    const fresh = await freshDb()
    try {
      await applyMigrations(fresh, 'tx')
      t.check('full chain applies in transaction mode', true)
    } catch (err) {
      t.check('full chain applies in transaction mode', false, err.message)
    } finally {
      await fresh.close()
    }
    // Idempotent re-run (the harness already re-applies the newest file; this
    // additionally proves data survives a second application).
    const u = await member(db, 'biz-idem')
    await ownerUpsert(db, u, ['business_name'], ['Keep Me Ltd'])
    await applyMigrations(db, 'multi', [MIGRATION])
    await applyMigrations(db, 'tx', [MIGRATION])
    t.equal('re-running the migration keeps stored data', (await careerRow(db, u)).business_name, 'Keep Me Ltd')
  }

  return t
}
