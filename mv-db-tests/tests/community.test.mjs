// Community / sub-community hierarchy — database-level assertions.
//
// Covers the 11 required checks of Step 3 (IDs authoritative, legacy text
// synchronised, cross-community combinations rejected, inactive rows not
// selectable for new edits, legacy text mapping, search + Daily 5 still
// working) plus the backfill/repair behaviour of the migration itself.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Checks,
  activatePackage,
  applyMigrations,
  asUser,
  completeProfile,
  expectError,
  freshDb,
  migrationFiles,
  migrationsDir,
  one,
  scalar,
  signUp,
} from '../lib/harness.mjs'

const MIGRATION = '20260919080000_community_hierarchy_integrity.sql'

let seq = 0
async function member(db, tag, { gender = 'male', pkgSlug = 'premium-6-month' } = {}) {
  seq += 1
  const id = await signUp(db, {
    email: `${tag}@example.com`,
    name: `Member ${tag}`,
    mobile: '9' + String(200000000 + seq).padStart(9, '0'),
  })
  await completeProfile(db, id, { gender })
  if (pkgSlug) await activatePackage(db, id, pkgSlug)
  return id
}

const row = (db, userId) =>
  one(
    db,
    `SELECT mp.community_id, mp.sub_community_id, mp.sub_community, c.name AS community_name, sc.name AS sub_name
     FROM public.matrimony_profiles mp
     LEFT JOIN public.communities c ON c.id = mp.community_id
     LEFT JOIN public.sub_communities sc ON sc.id = mp.sub_community_id
     WHERE mp.user_id = $1`,
    [userId]
  )

/** The wizard's write path: owner upsert through RLS as `authenticated`. */
const ownerUpdate = (db, userId, sets, params) =>
  asUser(db, userId, () =>
    db.query(`UPDATE public.matrimony_profiles SET ${sets} WHERE user_id = $1`, [userId, ...params])
  )

export default async function run(db) {
  const t = new Checks('community')

  // ── seed lookups ─────────────────────────────────────────────────────────
  const mali = await one(db, `SELECT id, name FROM public.communities WHERE slug = 'mali'`)
  const subs = (await db.query(
    `SELECT id, slug, name, is_active FROM public.sub_communities WHERE community_id = $1 ORDER BY sort_order`,
    [mali.id]
  )).rows
  const bySlug = Object.fromEntries(subs.map((s) => [s.slug, s]))
  t.check('Mali community seeded', !!mali)
  t.equal('Mali sub-communities seeded in sort order',
    subs.map((s) => s.name), ['Mali', 'Phul Mali', 'Maratha Mali', 'Lal Mali', 'Other'])

  // A SECOND community, to prove nothing is Mali-specific and to build the
  // cross-community rejection cases.
  const other = await one(db,
    `INSERT INTO public.communities (slug, name, sort_order) VALUES ('kunbi', 'Kunbi', 2) RETURNING id, name`)
  const otherSub = await one(db,
    `INSERT INTO public.sub_communities (community_id, slug, name, sort_order)
     VALUES ($1, 'tirole', 'Tirole', 1) RETURNING id, name`, [other.id])

  console.log(' [1] seeded profiles resolve to community_id')
  {
    const a = await member(db, 'seed-a')
    const b = await member(db, 'seed-b', { gender: 'female' })
    // Simulate pre-Step-3 rows: the 20260915010000 backfill gave every
    // existing profile community_id = Mali; new sign-ups get it here through
    // the same relationship once they pick a sub-community.
    await ownerUpdate(db, a, `sub_community_id = $2`, [bySlug['phul-mali'].id])
    await ownerUpdate(db, b, `sub_community = $2`, ['Maratha Mali'])
    const ra = await row(db, a)
    const rb = await row(db, b)
    t.equal('ID pick derives community_id = Mali', ra.community_id, mali.id)
    t.equal('legacy text pick derives community_id = Mali', rb.community_id, mali.id)
    const orphan = await scalar(db,
      `SELECT count(*)::int FROM public.matrimony_profiles WHERE sub_community_id IS NOT NULL AND community_id IS NULL`)
    t.equal('no profile has a sub-community without a community', orphan, 0)
  }

  console.log(' [2] existing valid sub-community rows resolve to sub_community_id')
  {
    for (const s of subs) {
      const u = await member(db, `sub-${s.slug}`)
      await ownerUpdate(db, u, `sub_community = $2`, [s.name])
      const r = await row(db, u)
      t.equal(`"${s.name}" (text) → sub_community_id`, r.sub_community_id, s.id)
    }
  }

  console.log(' [3] a profile cannot store a sub-community from another community')
  {
    const u = await member(db, 'mismatch')
    const msg = await expectError(() =>
      ownerUpdate(db, u, `community_id = $2, sub_community_id = $3`, [mali.id, otherSub.id]))
    t.check('Mali + Tirole (Kunbi) is rejected', /COMMUNITY_MISMATCH/.test(msg), msg)
    const msg2 = await expectError(() =>
      ownerUpdate(db, u, `community_id = $2, sub_community_id = $3`, [other.id, bySlug['phul-mali'].id]))
    t.check('Kunbi + Phul Mali (Mali) is rejected', /COMMUNITY_MISMATCH/.test(msg2), msg2)
    // Changing only the community underneath an existing sub-community
    await ownerUpdate(db, u, `community_id = $2, sub_community_id = $3`, [mali.id, bySlug['phul-mali'].id])
    const msg3 = await expectError(() => ownerUpdate(db, u, `community_id = $2`, [other.id]))
    t.check('re-pointing community_id alone under a Mali sub-community is rejected', /COMMUNITY_MISMATCH/.test(msg3), msg3)
    const r = await row(db, u)
    t.equal('row unchanged after rejected writes', [r.community_id, r.sub_community_id], [mali.id, bySlug['phul-mali'].id])
    // Unknown UUID
    const msg4 = await expectError(() =>
      ownerUpdate(db, u, `sub_community_id = $2`, ['00000000-0000-0000-0000-000000000001']))
    t.check('unknown sub_community_id is rejected', msg4 !== '', msg4)
  }

  console.log(' [4] a valid combination succeeds (both communities)')
  {
    const u = await member(db, 'valid-mali')
    await ownerUpdate(db, u, `community_id = $2, sub_community_id = $3`, [mali.id, bySlug['lal-mali'].id])
    const r = await row(db, u)
    t.equal('Mali + Lal Mali persisted', [r.community_name, r.sub_name], ['Mali', 'Lal Mali'])
    t.equal('legacy text synchronised from the row', r.sub_community, 'Lal Mali')

    const v = await member(db, 'valid-kunbi')
    await ownerUpdate(db, v, `community_id = $2, sub_community_id = $3`, [other.id, otherSub.id])
    const rv = await row(db, v)
    t.equal('Kunbi + Tirole persisted (no Mali hard-coding)', [rv.community_name, rv.sub_name, rv.sub_community],
      ['Kunbi', 'Tirole', 'Tirole'])

    // Sub-community only → community derived.
    const w = await member(db, 'valid-derive')
    await ownerUpdate(db, w, `sub_community_id = $2`, [otherSub.id])
    t.equal('community_id derived from sub-community', (await row(db, w)).community_id, other.id)
  }

  console.log(' [5] invalid combination fails (wizard-style upsert as the owner)')
  {
    const u = await member(db, 'invalid-upsert')
    const msg = await expectError(() =>
      asUser(db, u, () =>
        db.query(
          `INSERT INTO public.matrimony_profiles (user_id, community_id, sub_community_id, sub_community)
           VALUES ($1, $2, $3, 'Tirole')
           ON CONFLICT (user_id) DO UPDATE SET
             community_id = EXCLUDED.community_id,
             sub_community_id = EXCLUDED.sub_community_id,
             sub_community = EXCLUDED.sub_community`,
          [u, mali.id, otherSub.id]
        )))
    t.check('upsert with mismatched IDs is rejected', /COMMUNITY_MISMATCH/.test(msg), msg)
    // Text disagreeing with the ID cannot create drift: the ID wins.
    await asUser(db, u, () =>
      db.query(
        `INSERT INTO public.matrimony_profiles (user_id, community_id, sub_community_id, sub_community)
         VALUES ($1, $2, $3, 'Totally Wrong')
         ON CONFLICT (user_id) DO UPDATE SET
           community_id = EXCLUDED.community_id,
           sub_community_id = EXCLUDED.sub_community_id,
           sub_community = EXCLUDED.sub_community`,
        [u, mali.id, bySlug['maratha-mali'].id]
      ))
    t.equal('text is overwritten by the linked row name', (await row(db, u)).sub_community, 'Maratha Mali')
  }

  console.log(' [6] inactive community / sub-community cannot be newly selected')
  {
    const u = await member(db, 'inactive-a')
    await ownerUpdate(db, u, `sub_community_id = $2`, [bySlug['other'].id])
    await db.query(`UPDATE public.sub_communities SET is_active = FALSE WHERE id = $1`, [bySlug['other'].id])

    const v = await member(db, 'inactive-b')
    const msg = await expectError(() => ownerUpdate(db, v, `sub_community_id = $2`, [bySlug['other'].id]))
    t.check('picking an inactive sub-community by ID is rejected', /COMMUNITY_INACTIVE/.test(msg), msg)
    await ownerUpdate(db, v, `sub_community = $2`, ['Other'])
    const rv = await row(db, v)
    t.check('inactive sub-community is not resolved from text either', rv.sub_community_id === null && rv.sub_community === 'Other', rv)

    // Member already on the (now inactive) row can still edit unrelated fields.
    await ownerUpdate(db, u, `city = $2`, ['Nashik'])
    const ru = await row(db, u)
    t.equal('existing member keeps their now-inactive sub-community', ru.sub_community_id, bySlug['other'].id)

    // Inactive rows are hidden from the anon/authenticated lookups the wizard uses.
    const visible = await asUser(db, v, () =>
      scalar(db, `SELECT count(*)::int FROM public.sub_communities WHERE id = $1`, [bySlug['other'].id]))
    t.equal('inactive sub-community invisible through RLS', visible, 0)

    // Inactive COMMUNITY
    await db.query(`UPDATE public.communities SET is_active = FALSE WHERE id = $1`, [other.id])
    const w = await member(db, 'inactive-c')
    const msgC = await expectError(() => ownerUpdate(db, w, `community_id = $2`, [other.id]))
    t.check('picking an inactive community is rejected', /COMMUNITY_INACTIVE/.test(msgC), msgC)
    await db.query(`UPDATE public.communities SET is_active = TRUE WHERE id = $1`, [other.id])
    await db.query(`UPDATE public.sub_communities SET is_active = TRUE WHERE id = $1`, [bySlug['other'].id])
  }

  console.log(' [7] legacy text-only profile remains readable')
  {
    // Simulate a pre-hierarchy row: bypass the trigger by disabling it, the
    // way an old database looked before this migration ran.
    const u = await member(db, 'legacy-read')
    await db.exec(`ALTER TABLE public.matrimony_profiles DISABLE TRIGGER matrimony_profiles_community_hierarchy`)
    await db.query(
      `UPDATE public.matrimony_profiles SET sub_community = 'Phul Mali', sub_community_id = NULL, community_id = NULL WHERE user_id = $1`, [u])
    await db.exec(`ALTER TABLE public.matrimony_profiles ENABLE TRIGGER matrimony_profiles_community_hierarchy`)
    const r = await row(db, u)
    t.equal('legacy row has text only', [r.sub_community, r.sub_community_id], ['Phul Mali', null])
    const viewer = await member(db, 'legacy-viewer', { gender: 'female' })
    const card = await asUser(db, viewer, () => scalar(db, `SELECT public.get_public_profile($1) AS r`, [u]))
    t.equal('get_public_profile falls back to the legacy text', card?.sub_community, 'Phul Mali')
    t.equal('...and reports no community (none linked)', card?.community ?? null, null)

    console.log(' [8] legacy text maps to the proper DB row')
    // (a) the migration's backfill, re-applied idempotently
    await applyMigrations(db, 'multi', [MIGRATION])
    const r2 = await row(db, u)
    t.equal('backfill links legacy text to Phul Mali', [r2.sub_community_id, r2.community_id], [bySlug['phul-mali'].id, mali.id])
    // (b) resolution at write time (CASE B: community known, text present)
    const v = await member(db, 'legacy-caseb')
    await db.exec(`ALTER TABLE public.matrimony_profiles DISABLE TRIGGER matrimony_profiles_community_hierarchy`)
    await db.query(`UPDATE public.matrimony_profiles SET sub_community = 'lal mali', sub_community_id = NULL, community_id = $2 WHERE user_id = $1`, [v, mali.id])
    await db.exec(`ALTER TABLE public.matrimony_profiles ENABLE TRIGGER matrimony_profiles_community_hierarchy`)
    await ownerUpdate(db, v, `sub_community = sub_community`, [])
    const rv = await row(db, v)
    t.equal('case-insensitive text resolved within the known community', [rv.sub_community_id, rv.sub_community], [bySlug['lal-mali'].id, 'Lal Mali'])
    // (c) CASE D: unknown text is left alone, nothing crashes
    const w = await member(db, 'legacy-cased')
    await ownerUpdate(db, w, `sub_community = $2`, ['Unknown Clan'])
    const rw = await row(db, w)
    t.equal('unknown legacy text stays unresolved without error', [rw.sub_community, rw.sub_community_id], ['Unknown Clan', null])
    // (d) an ambiguous name across two communities is NOT guessed
    const dupe = await one(db,
      `INSERT INTO public.sub_communities (community_id, slug, name, sort_order) VALUES ($1, 'other', 'Other', 9) RETURNING id`, [other.id])
    const x = await member(db, 'legacy-ambiguous')
    await ownerUpdate(db, x, `sub_community = $2`, ['Other'])
    t.equal('ambiguous text (two communities) is not resolved blindly', (await row(db, x)).sub_community_id, null)
    await ownerUpdate(db, x, `community_id = $2, sub_community = $3`, [other.id, 'Other'])
    t.equal('...but resolves once the community is known', (await row(db, x)).sub_community_id, dupe.id)
  }

  console.log(' [9] IDs stay consistent after profile updates')
  {
    const u = await member(db, 'consistent')
    await ownerUpdate(db, u, `community_id = $2, sub_community_id = $3`, [mali.id, bySlug['mali'].id])
    await ownerUpdate(db, u, `sub_community_id = $2`, [bySlug['phul-mali'].id])
    let r = await row(db, u)
    t.equal('switching sub-community keeps community + syncs text', [r.community_id, r.sub_community], [mali.id, 'Phul Mali'])
    await ownerUpdate(db, u, `sub_community = $2`, ['garbage'])
    r = await row(db, u)
    t.equal('editing the text alone cannot desync it from the ID', [r.sub_community_id, r.sub_community], [bySlug['phul-mali'].id, 'Phul Mali'])
    await ownerUpdate(db, u, `sub_community_id = NULL, sub_community = NULL`, [])
    r = await row(db, u)
    t.equal('clearing the sub-community is allowed', r.sub_community_id, null)
    const drift = await scalar(db,
      `SELECT count(*)::int FROM public.matrimony_profiles mp JOIN public.sub_communities sc ON sc.id = mp.sub_community_id
       WHERE mp.sub_community IS DISTINCT FROM sc.name OR mp.community_id <> sc.community_id`)
    t.equal('zero rows with text/ID/community drift across the whole table', drift, 0)
  }

  console.log(' [10] search still returns valid matching profiles')
  {
    const searcher = await member(db, 'searcher', { gender: 'male', pkgSlug: 'premium-6-month' })
    const bride1 = await member(db, 'bride-phul', { gender: 'female' })
    const bride2 = await member(db, 'bride-lal', { gender: 'female' })
    const bride3 = await member(db, 'bride-legacy', { gender: 'female' })
    await ownerUpdate(db, bride1, `sub_community_id = $2`, [bySlug['phul-mali'].id])
    await ownerUpdate(db, bride2, `sub_community_id = $2`, [bySlug['lal-mali'].id])
    // legacy row: text only, no ID
    await db.exec(`ALTER TABLE public.matrimony_profiles DISABLE TRIGGER matrimony_profiles_community_hierarchy`)
    await db.query(`UPDATE public.matrimony_profiles SET sub_community = 'Phul Mali', sub_community_id = NULL WHERE user_id = $1`, [bride3])
    await db.exec(`ALTER TABLE public.matrimony_profiles ENABLE TRIGGER matrimony_profiles_community_hierarchy`)

    const search = (p) => asUser(db, searcher, () =>
      scalar(db, `SELECT public.search_matches(p_looking_for => 'female', p_sub_community => $1, p_limit => 50) AS r`, [p]))
    const all = await search(null)
    const ids = (r) => (r ?? []).map((c) => c.user_id)
    t.check('unfiltered search lists all brides', [bride1, bride2, bride3].every((b) => ids(all).includes(b)))
    const phul = await search('Phul Mali')
    t.check('text filter "Phul Mali" matches the ID-linked bride', ids(phul).includes(bride1))
    t.check('...and the legacy text-only bride (bookmark compatibility)', ids(phul).includes(bride3))
    t.check('...but not Lal Mali', !ids(phul).includes(bride2))
    const lower = await search('  phul mali ')
    t.equal('filter is case/whitespace tolerant (old URLs)', ids(lower).sort(), ids(phul).sort())
    const card = (phul ?? []).find((c) => c.user_id === bride1)
    t.equal('card carries community + sub-community names', [card?.community, card?.sub_community], ['Mali', 'Phul Mali'])
    const none = await search('Nonexistent')
    t.equal('unknown sub-community returns nothing (no hard-coded fallback)', ids(none), [])
    const freeViewer = await member(db, 'free-searcher', { gender: 'male', pkgSlug: null })
    const freeRes = await asUser(db, freeViewer, () =>
      scalar(db, `SELECT public.search_matches(p_looking_for => 'female', p_sub_community => 'Lal Mali', p_limit => 50) AS r`))
    t.check('sub-community filter stays advanced-only (free plan ignores it)', ids(freeRes).includes(bride1) && ids(freeRes).includes(bride2))
  }

  console.log(' [11] matching (Daily 5) works for legacy and new profiles')
  {
    const me = await member(db, 'daily-me', { gender: 'male', pkgSlug: 'premium-6-month' })
    await ownerUpdate(db, me, `sub_community_id = $2`, [bySlug['phul-mali'].id])
    await asUser(db, me, () =>
      db.query(
        `INSERT INTO public.partner_preferences (profile_id, preferred_gender, min_age, max_age, preferred_sub_communities)
         VALUES ($1, 'female', 18, 60, ARRAY['phul mali', 'Not A Real One'])
         ON CONFLICT (profile_id) DO UPDATE SET preferred_sub_communities = EXCLUDED.preferred_sub_communities, preferred_gender = 'female'`,
        [me]))
    const prefs = await one(db, `SELECT preferred_sub_communities FROM public.partner_preferences WHERE profile_id = $1`, [me])
    t.equal('preference values canonicalised to DB rows, unknown dropped', prefs.preferred_sub_communities, ['Phul Mali'])

    // The engine drops candidates under the admin-configured threshold (90%
    // by default); test profiles are sparse, so lower it to isolate the
    // community rule. This is admin config, not application code.
    await db.query(`UPDATE public.matching_config SET threshold = 0`)
    const daily = await asUser(db, me, () => scalar(db, `SELECT public.get_daily_matches(25) AS r`))
    const list = Array.isArray(daily) ? daily : (daily?.matches ?? [])
    t.check('Daily 5 returns candidates', list.length > 0, daily)
    // The engine only surfaces the first 4 reasons, so assert on the SCORE:
    // the community rule is worth 10 points. A Phul Mali candidate (ID-linked
    // or legacy text-only) must outscore an otherwise-identical Lal Mali one.
    const scoreOf = (uid) => Number(list.find((c) => c.user_id === uid)?.score ?? NaN)
    const phulLinked = await one(db, `SELECT user_id FROM public.matrimony_profiles WHERE sub_community_id = $1 AND gender = 'female' AND user_id <> $2 ORDER BY created_at LIMIT 1`, [bySlug['phul-mali'].id, me])
    const lalLinked = await one(db, `SELECT user_id FROM public.matrimony_profiles WHERE sub_community_id = $1 AND gender = 'female' LIMIT 1`, [bySlug['lal-mali'].id])
    const legacyBride = await one(db, `SELECT user_id FROM public.matrimony_profiles WHERE sub_community = 'Phul Mali' AND sub_community_id IS NULL AND gender = 'female' LIMIT 1`)
    t.check('all three candidates are present in the Daily list', [phulLinked, lalLinked, legacyBride].every((r) => r && Number.isFinite(scoreOf(r.user_id))),
      { phul: phulLinked && scoreOf(phulLinked.user_id), lal: lalLinked && scoreOf(lalLinked.user_id), legacy: legacyBride && scoreOf(legacyBride.user_id) })
    t.check('ID-linked preferred sub-community candidate scores +10 over a non-preferred one',
      scoreOf(phulLinked.user_id) - scoreOf(lalLinked.user_id) === 10, [scoreOf(phulLinked.user_id), scoreOf(lalLinked.user_id)])
    t.check('legacy text-only candidate scores the same as the ID-linked one',
      scoreOf(legacyBride.user_id) === scoreOf(phulLinked.user_id), [scoreOf(legacyBride.user_id), scoreOf(phulLinked.user_id)])
  }

  console.log(' [12] migration hygiene')
  {
    const sql = readFileSync(join(migrationsDir, MIGRATION), 'utf8')
    t.check('migration does not drop the legacy text column', !/DROP COLUMN/i.test(sql))
    t.check('migration creates no new table', !/CREATE TABLE/i.test(sql))
    t.check('older profile-model migration is untouched by this step', migrationFiles().includes('20260915010000_profile_model_family_photo.sql'))
    const rls = await one(db, `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.matrimony_profiles'::regclass`)
    t.check('RLS still enabled on matrimony_profiles', rls.relrowsecurity === true)
    const fresh = await freshDb()
    try {
      await applyMigrations(fresh, 'tx')
      t.check('full chain applies in transaction mode', true)
    } catch (err) {
      t.check('full chain applies in transaction mode', false, err.message)
    } finally {
      await fresh.close()
    }
  }

  return t
}
