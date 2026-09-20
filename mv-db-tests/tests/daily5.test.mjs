// Daily 5 matching engine — database + contract assertions (Step 9).
//
// Covers the rule-based Daily 5 engine end to end at the database level,
// using the same harness (real migrations in PGlite, real RLS/GRANTs, real
// SECURITY DEFINER boundaries) as the other suites:
//
//  THE STEP 9 DEFECT (candidate limiting)
//    1. matching_config.daily_count = 5 returns AT MOST 5 matches even when
//       8 candidates qualify (the pre-Step-9 code applied `LIMIT v_count`
//       AFTER jsonb_agg(), which limits the aggregate's single output row —
//       i.e. nothing — and returned every threshold-passing candidate)
//    2. the 5 returned are exactly the top-5 under the unchanged ranking
//       (score DESC → boost DESC → md5(user_id ‖ current_date) ASC)
//    3. LIMIT demonstrably happens BEFORE aggregation (tests 1/3/5 fail on
//       the old implementation, which returned all qualifying rows)
//  NO PADDING
//    4. 4 qualifying → exactly 4        5. 1 qualifying → exactly 1
//    6. 0 qualifying → []               7. below-threshold never appear
//    8. 8 candidates, only 3 qualify → exactly 3
//    9. no duplicate user_id values    10. no placeholder/fake profiles
//  CONFIGURATION IS DATA
//   11. daily_count=3 → at most 3      12. daily_count=10 → up to 10
//   13. daily_count=1/5 also honoured  14. changing the count never changes
//       the score or the threshold
//   15. threshold is authoritative (95 empties a 93.5 pool; 90 restores it)
//   16. invalid config rejected by the existing CHECK constraints
//       (daily_count 0/26, threshold 150/-5)
//   17. matching_settings() returns the configured values
//   18. p_limit RPC argument may only LOWER the count — never exceed
//       matching_config.daily_count
//  SCORE / REASONS UNCHANGED
//   19. a fully aligned pair scores exactly 93.5 under the PRD weights
//   20. reasons are the unchanged strings, capped at the first 4
//  VISIBILITY / SAFETY (all through the existing gates)
//   21. suspended excluded             22. admin-hidden excluded
//   23. expired excluded               24. free/hidden excluded
//   25. incomplete excluded            26. blocked excluded (either side)
//   27. wrong-gender excluded          28. boosted below threshold excluded
//  BOOST = ORDERING ONLY
//   29. boosted above-threshold candidate wins the tie among equal scores
//   30. two boosted equal-score candidates order by the deterministic md5
//  FREE VS PAID
//   31. free viewer can call Daily 5 and receives the compatibility score
//   32. free viewer card masks the name and nulls the paid-only fields
//   33. no private contact details in any card
//   34. paid viewer keeps the richer permitted fields
//  DETERMINISM
//   35. same viewer + same day → identical list on every call
//  SECURITY / BOUNDARIES
//   36. anonymous caller still refused
//   37. members cannot read or write matching_config (RLS + grants intact)
//   38. the RPC takes no viewer parameter (cannot impersonate another member)
//   39. exactly one get_daily_matches(integer) exists (no accidental overload)
//   40. EXECUTE grants unchanged (anon revoked, authenticated granted)
import { createHash } from 'node:crypto'
import {
  Checks,
  activatePackage,
  asService,
  asUser,
  completeProfile,
  expectError,
  one,
  scalar,
  signUp,
} from '../lib/harness.mjs'

/* ------------------------------------------------------------------------ */
/* helpers                                                                   */
/* ------------------------------------------------------------------------ */

const md5 = (s) => createHash('md5').update(s).digest('hex')

async function person(db, tag, { gender = 'male', pkg = 'premium-6-month', complete = true } = {}) {
  const id = await signUp(db, {
    email: `${tag}@daily5.example.com`,
    name: `${tag[0].toUpperCase()}${tag.slice(1)} Member`,
    mobile: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
  })
  if (complete) await completeProfile(db, id, { gender })
  if (pkg) await activatePackage(db, id, pkg)
  return id
}

/**
 * A candidate aligned with the viewer on every scoring component:
 * age 28 (in [18,60]), city Pune, education B.E., occupation Engineer,
 * income band set (0.8 neutral-high), sub-community Phul Mali, no detailed
 * diet/marital wishes (0.7 neutral-high), same smoking/drinking, recent
 * login → 15+15+10+10+8+10+10.5+10+5 = 93.5 ≥ 90 (qualifies).
 * `smoking: 'occasionally'` breaks lifestyle alignment → 88.5 (excluded).
 */
async function candidate(db, tag, { gender = 'female', pkg = 'premium-6-month', smoking = 'never', complete = true } = {}) {
  const id = await person(db, tag, { gender, pkg, complete })
  await db.query(
    `UPDATE public.matrimony_profiles
     SET city = 'Pune', education = 'B.E.', occupation = 'Engineer',
         sub_community = 'Phul Mali', annual_income = '5 - 10 lpa',
         height_cm = 165,
         smoking = $2::public.lifestyle_choice, drinking = 'never'
     WHERE user_id = $1`,
    [id, smoking]
  )
  await db.query(`UPDATE public.profiles SET last_login_at = now() WHERE id = $1`, [id])
  return id
}

/** Viewer profile aligned with `candidate` (so aligned pairs score 93.5). */
async function configureViewer(db, viewerId) {
  await db.query(
    `UPDATE public.matrimony_profiles
     SET city = 'Pune', education = 'B.E.', occupation = 'Engineer',
         sub_community = 'Phul Mali', smoking = 'never', drinking = 'never'
     WHERE user_id = $1`,
    [viewerId]
  )
  await db.query(
    `UPDATE public.partner_preferences SET min_age = 18, max_age = 60 WHERE profile_id = $1`,
    [viewerId]
  )
  await db.query(`UPDATE public.profiles SET last_login_at = now() WHERE id = $1`, [viewerId])
}

const cfg = (db, threshold, dailyCount) =>
  db.query(`UPDATE public.matching_config SET threshold = $1, daily_count = $2`, [threshold, dailyCount])

/** get_daily_matches() as a signed-in viewer (no argument = UI behaviour). */
const daily = (db, viewerId) =>
  asUser(db, viewerId, () => scalar(db, `SELECT public.get_daily_matches() AS r`))
/** get_daily_matches(p_limit) with an explicit argument. */
const dailyWithLimit = (db, viewerId, limit) =>
  asUser(db, viewerId, () => scalar(db, `SELECT public.get_daily_matches($1) AS r`, [limit]))

const ids = (cards) => (cards ?? []).map((c) => c.user_id)
const uniqueIds = (cards) => [...new Set(ids(cards))]

/** Block a pair exactly as a member would through the RLS'd blocks table. */
const block = (db, blockerId, blockedId) =>
  asUser(db, blockerId, () =>
    db.query(
      `INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId]
    )
  )

const suspend = (db, userId, adminId) =>
  asService(db, () => scalar(db, `SELECT public.admin_set_profile_suspended($1, TRUE, $2, 'test') AS r`, [userId, adminId]))
const hide = (db, userId, adminId) =>
  asService(db, () => scalar(db, `SELECT public.admin_set_profile_hidden($1, TRUE, $2, 'test') AS r`, [userId, adminId]))
const grantBoost = (db, userId, adminId) =>
  asService(db, () => scalar(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [userId, adminId]))

async function expireMembership(db, id) {
  await db.query(
    `UPDATE public.subscriptions SET started_at = now() - interval '200 days', expires_at = now() - interval '1 day' WHERE user_id = $1`,
    [id]
  )
  await asService(db, () => db.query(`SELECT public.sweep_expired_memberships()`))
}

/** Replicate the unchanged ranking: score DESC → boost DESC → md5(user ‖ date) ASC. */
function expectedOrder(poolCards, today) {
  return [...poolCards].sort((a, b) =>
    b.score - a.score ||
    (b.is_boosted === true) - (a.is_boosted === true) ||
    (md5(a.user_id + today) < md5(b.user_id + today) ? -1 : md5(a.user_id + today) > md5(b.user_id + today) ? 1 : 0)
  )
}
const mask = (full) =>
  full.length > 1 ? full[0] + '*'.repeat(full.length - 1) : 'Member'

const PAID_KEYS = ['name_full', 'age', 'height_cm', 'sub_community', 'marital_status', 'education', 'city', 'state', 'diet']
const CONTACT_KEYS = ['phone', 'email', 'mobile', 'contact_phone', 'whatsapp', 'whatsapp_number']

/* ------------------------------------------------------------------------ */
/* suite                                                                     */
/* ------------------------------------------------------------------------ */

export default async function daily5Suite(db) {
  const t = new Checks('daily5')

  // Deterministic configuration baseline (the defaults, set explicitly).
  await cfg(db, 90, 5)
  const today = await scalar(db, `SELECT current_date::text AS d`)

  // Admin is female + FREE → is_profile_public() is false → never a candidate.
  const admin = await person(db, 'adminx', { gender: 'female', pkg: null })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])

  // V — the paid male viewer used by sections 1–9. V2 — a free male viewer
  // used to prove Daily 5 + scores are not paywalled. Every female created
  // below is retired (blocked for BOTH viewers) at the end of its section, so
  // each section's pool is exactly the members it creates.
  const V = await person(db, 'viewer', { gender: 'male' })
  await configureViewer(db, V)
  const V2 = await person(db, 'freeviewer', { gender: 'male', pkg: null })
  await configureViewer(db, V2)
  // Sequential on purpose: PGlite is one connection — concurrent asUser()
  // blocks would interleave SET ROLE / claim state between the two members.
  const retire = async (x) => {
    await block(db, V, x)
    await block(db, V2, x)
  }

  // =========================================================================
  console.log(' [1] the configured daily_count caps the candidate ROWS before jsonb_agg')
  // =========================================================================
  // Eight genuinely qualifying candidates; configured count is 5.
  const c = {}
  for (const tag of ['cand1', 'cand2', 'cand3', 'cand4', 'cand5', 'cand6', 'cand7', 'cand8']) {
    c[tag] = await candidate(db, tag)
  }
  const pool8 = Object.values(c)

  const r5 = await daily(db, V)
  t.equal('daily_count=5 returns AT MOST 5 of 8 qualifying candidates (old bug returned all 8)', r5.length, 5)
  t.equal('no duplicate user_id values (aggregation cannot duplicate)', uniqueIds(r5).length, 5)
  t.check('every returned id is a real candidate — no placeholders/fakes', ids(r5).every((id) => pool8.includes(id)), ids(r5))
  t.check('every returned score meets the 90 threshold', r5.every((m) => Number(m.score) >= 90), r5.map((m) => m.score))

  // The 5 must be exactly the top-5 under the unchanged ranking — the LIMIT
  // demonstrably selected candidate ROWS before aggregation.
  const expectedCards = pool8.map((id) => ({ user_id: id, score: 93.5, is_boosted: false }))
  const expected5 = expectedOrder(expectedCards, today).slice(0, 5).map((x) => x.user_id)
  t.equal('returned set = top-5 by (score DESC, boost DESC, md5 ASC) — LIMIT ran before jsonb_agg',
    uniqueIds(r5).sort(), [...new Set(expected5)].sort())
  t.equal('returned ORDER follows the unchanged ranking', ids(r5), expected5)

  // Score + reasons are exactly what the unchanged components produce.
  const first = r5[0]
  t.equal('score calculation unchanged (fully aligned pair = 93.5)', Number(first.score), 93.5)
  t.equal('reason strings unchanged (first 4 kept)',
    first.reasons,
    ['Age within your preferred range', 'Lives in your city', 'Same education level', 'Similar occupation'])

  // =========================================================================
  console.log(' [2] no padding — the count is a maximum, never filled up')
  // =========================================================================
  for (const tag of ['cand1', 'cand2', 'cand3', 'cand4']) await block(db, V, c[tag])
  t.equal('8 qualifying → 4 blocked → exactly 4 returned', (await daily(db, V)).length, 4)
  for (const tag of ['cand5', 'cand6', 'cand7']) await block(db, V, c[tag])
  const oneLeft = await daily(db, V)
  t.equal('8 qualifying → 7 blocked → exactly 1 returned', oneLeft.length, 1)
  t.equal('the survivor is the genuinely qualifying candidate', ids(oneLeft), [c.cand8])
  await block(db, V, c.cand8)
  t.equal('0 qualifying → [] (never padded, never fabricated)', ids(await daily(db, V)), [])
  for (const tag of Object.keys(c)) await retire(c[tag])

  // =========================================================================
  console.log(' [3] threshold semantics — below-threshold candidates never appear')
  // =========================================================================
  const q1 = await candidate(db, 'qual1')
  const q2 = await candidate(db, 'qual2')
  const q3 = await candidate(db, 'qual3')
  const s = []
  for (const tag of ['sub1', 'sub2', 'sub3', 'sub4', 'sub5']) {
    s.push(await candidate(db, tag, { smoking: 'occasionally' })) // 88.5 < 90
  }
  const mixed = await daily(db, V)
  t.equal('8 candidates where only 3 meet the threshold → exactly 3 returned', mixed.length, 3)
  t.check('no below-threshold candidate appears', ids(mixed).every((id) => ![...s].includes(id)), ids(mixed))
  t.check('the 3 returned are the qualifying ones', ids(mixed).sort().join() === [q1, q2, q3].sort().join(), ids(mixed))
  // Pure below-threshold pool → honest empty list.
  for (const x of [q1, q2, q3]) await retire(x)
  t.equal('only below-threshold candidates remain → []', ids(await daily(db, V)), [])

  // =========================================================================
  console.log(' [4] matching_config.daily_count is authoritative and data-driven')
  // =========================================================================
  const d = {}
  for (const tag of ['dc1', 'dc2', 'dc3', 'dc4', 'dc5', 'dc6', 'dc7', 'dc8']) d[tag] = await candidate(db, tag)
  const dpool = Object.values(d)

  await cfg(db, 90, 3)
  const rAt3 = await daily(db, V)
  t.equal('daily_count=3 → at most 3 (old bug returned all 8)', rAt3.length, 3)
  await cfg(db, 90, 10)
  const rAt10 = await daily(db, V)
  t.equal('daily_count=10 → up to 10 (8 qualifying → all 8)', rAt10.length, 8)
  const scoreOf = (cards, id) => Number(cards.find((m) => m.user_id === id)?.score)
  t.check('raising the count keeps the SAME members + SAME scores (count never re-scores)',
    ids(rAt3).every((id) => rAt10.some((m) => m.user_id === id && scoreOf(rAt10, id) === scoreOf(rAt3, id))))
  await cfg(db, 90, 1)
  t.equal('daily_count=1 → exactly 1', (await daily(db, V)).length, 1)
  await cfg(db, 90, 5)
  t.equal('daily_count=5 → exactly 5 again', (await daily(db, V)).length, 5)

  await cfg(db, 95, 5)
  t.equal('threshold=95 (all scores 93.5) → [] — the configured threshold rules, not a hard-coded 90',
    ids(await daily(db, V)), [])
  await cfg(db, 90, 5)
  t.equal('threshold restored to 90 → 5 again', (await daily(db, V)).length, 5)

  for (const x of dpool) await retire(x)

  // =========================================================================
  console.log(' [5] configuration validation + matching_settings() + RLS')
  // =========================================================================
  t.check('daily_count=0 rejected by the existing CHECK', /daily_count/.test(await expectError(() => db.query(`UPDATE public.matching_config SET daily_count = 0`))))
  t.check('daily_count=26 rejected by the existing CHECK', /daily_count/.test(await expectError(() => db.query(`UPDATE public.matching_config SET daily_count = 26`))))
  t.check('threshold=150 rejected by the existing CHECK', /threshold/.test(await expectError(() => db.query(`UPDATE public.matching_config SET threshold = 150`))))
  t.check('threshold=-1 rejected by the existing CHECK', /threshold/.test(await expectError(() => db.query(`UPDATE public.matching_config SET threshold = -1`))))
  const settings = await one(db, `SELECT public.matching_settings() AS s`)
  t.equal('matching_settings() returns the configured threshold', settings.s.threshold, 90)
  t.equal('matching_settings() returns the configured daily_count', settings.s.daily_count, 5)
  t.check('matching_settings() returns the 9 PRD weights', Object.keys(settings.s.weights ?? {}).length === 9, settings.s.weights)
  const cfgRead = await asUser(db, V, () => expectError(() => db.query(`SELECT count(*)::int AS n FROM public.matching_config`)))
  t.check('members cannot READ matching_config (no grants, RLS)', /permission denied/.test(cfgRead), cfgRead)
  const cfgWrite = await asUser(db, V, () => expectError(() => db.query(`UPDATE public.matching_config SET daily_count = 25`)))
  t.check('members cannot WRITE matching_config (no grants)', /permission denied/.test(cfgWrite), cfgWrite)

  // =========================================================================
  console.log(' [6] the p_limit RPC argument may only lower the configured count')
  // =========================================================================
  const p = {}
  for (const tag of ['pl1', 'pl2', 'pl3', 'pl4', 'pl5', 'pl6']) p[tag] = await candidate(db, tag)
  const ppool = Object.values(p)
  t.equal('no argument → configured 5', (await daily(db, V)).length, 5)
  t.equal('p_limit=25 is clamped to the configured daily_count=5 (old bug returned all 6)',
    (await dailyWithLimit(db, V, 25)).length, 5)
  t.equal('p_limit may still ask for FEWER: p_limit=2 → 2', (await dailyWithLimit(db, V, 2)).length, 2)
  for (const x of ppool) await retire(x)

  // =========================================================================
  console.log(' [7] visibility / safety gates — each exclusion still holds')
  // =========================================================================
  const control = await candidate(db, 'controlx') // qualifies → the only survivor
  const suspCand = await candidate(db, 'suspdx')
  await suspend(db, suspCand, admin)
  const hidCand = await candidate(db, 'hiddx')
  await hide(db, hidCand, admin)
  const expCand = await candidate(db, 'expppx')
  await expireMembership(db, expCand)
  const freeCand = await candidate(db, 'freexx', { pkg: null }) // free ⇒ hidden ⇒ never public
  const incCand = await candidate(db, 'incflx', { complete: false }) // no photos ⇒ incomplete
  const blkCand = await candidate(db, 'blkedx')
  await block(db, V, blkCand) // viewer blocked the candidate
  const revCand = await candidate(db, 'revblk')
  await block(db, revCand, V) // candidate blocked the viewer (is_blocked is symmetric)
  const maleCand = await candidate(db, 'malecx', { gender: 'male' }) // wrong gender for the viewer
  const bstSub = await candidate(db, 'bstsub', { smoking: 'occasionally' }) // 88.5
  await grantBoost(db, bstSub, admin) // …then boosted — still below the threshold

  const gated = await daily(db, V)
  t.equal('exactly the single qualifying control candidate is returned', ids(gated), [control])
  t.check('suspended candidate excluded', !ids(gated).includes(suspCand))
  t.check('admin-hidden candidate excluded', !ids(gated).includes(hidCand))
  t.check('expired candidate excluded', !ids(gated).includes(expCand))
  t.check('free/hidden candidate excluded', !ids(gated).includes(freeCand))
  t.check('incomplete candidate excluded', !ids(gated).includes(incCand))
  t.check('viewer-blocked candidate excluded', !ids(gated).includes(blkCand))
  t.check('candidate-who-blocked-viewer excluded', !ids(gated).includes(revCand))
  t.check('wrong-gender candidate excluded', !ids(gated).includes(maleCand))
  t.check('boosted below-threshold candidate still excluded (boost is not compatibility)', !ids(gated).includes(bstSub))
  await retire(control)
  await retire(blkCand)
  await retire(revCand)

  // =========================================================================
  console.log(' [8] boost remains an ordering tie-break between qualifying candidates')
  // =========================================================================
  const b1 = await candidate(db, 'boostx')
  const b2 = await candidate(db, 'noboot')
  await grantBoost(db, b1, admin)
  const rb = await daily(db, V)
  t.equal('boosted candidate above threshold ranks first among equal scores', ids(rb), [b1, b2])
  t.equal('card exposes is_boosted for the boosted candidate', rb[0].is_boosted, true)
  t.equal('non-boosted card stays is_boosted=false', rb[1].is_boosted, false)
  await grantBoost(db, b2, admin)
  const rb2 = await daily(db, V)
  t.equal('two boosted equal-score candidates order by the deterministic md5 tie-break',
    ids(rb2), expectedOrder([
      { user_id: b1, score: 93.5, is_boosted: true },
      { user_id: b2, score: 93.5, is_boosted: true },
    ], today).map((x) => x.user_id))
  t.check('same viewer + same day → deterministic ordering on every call',
    JSON.stringify(await daily(db, V)) === JSON.stringify(rb2))
  await retire(b1)
  await retire(b2)

  // =========================================================================
  console.log(' [9] free viewer: Daily 5 + score stay visible; paid-only fields do not leak')
  // =========================================================================
  const f1 = await candidate(db, 'fionaa')
  const f2 = await candidate(db, 'floraa')
  // V2 is free and has NO blocks, but every other female is retired or
  // state-excluded — exactly f1 + f2 qualify.
  const freeList = await daily(db, V2)
  t.equal('free viewer can call Daily 5', freeList.length, 2)
  const freeCard = freeList.find((m) => m.user_id === f1)
  t.check('free viewer receives the compatibility score', Number(freeCard?.score) === 93.5, freeCard?.score)
  t.equal('viewer_is_paid=false on the free card', freeCard.viewer_is_paid, false)
  t.equal('name is masked for the free viewer', freeCard.name, mask('Fionaa Member'))
  for (const key of PAID_KEYS) {
    t.equal(`free card hides paid-only field: ${key}`, freeCard[key] ?? null, null)
  }
  t.check('free card carries no private contact details',
    CONTACT_KEYS.every((k) => !(k in freeCard)), Object.keys(freeCard))

  const paidList = await daily(db, V)
  const paidCard = paidList.find((m) => m.user_id === f1)
  t.check('paid viewer keeps the richer permitted fields',
    paidCard?.name_full === 'Fionaa Member' && paidCard?.age === 28 &&
    paidCard?.height_cm === 165 && paidCard?.sub_community === 'Phul Mali' &&
    paidCard?.marital_status === 'never_married' && paidCard?.education === 'B.E.' &&
    paidCard?.city === 'Pune' && paidCard?.state === 'Maharashtra' &&
    paidCard?.diet === 'vegetarian', paidCard)
  t.check('paid card also carries no private contact details',
    CONTACT_KEYS.every((k) => !(k in paidCard)), Object.keys(paidCard))
  t.equal('same score for both viewers (score is not paywalled)', Number(paidCard.score), Number(freeCard.score))
  await retire(f1)
  await retire(f2)

  // =========================================================================
  console.log(' [10] security + contract hygiene')
  // =========================================================================
  const anonErr = await expectError(() => scalar(db, `SELECT public.get_daily_matches() AS r`))
  t.check('anonymous caller still refused (unchanged)', /not authenticated/.test(anonErr), anonErr)

  const fn = await one(db, `SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname = 'get_daily_matches'`)
  t.check('single integer p_limit argument only — no viewer id parameter to impersonate with',
    fn?.args === 'p_limit integer', fn?.args)
  const overloads = await scalar(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'get_daily_matches'`)
  t.equal('exactly one get_daily_matches exists (no accidental overload)', overloads, 1)

  t.equal('EXECUTE revoked from anon', await scalar(db, `SELECT has_function_privilege('anon', 'public.get_daily_matches(integer)', 'EXECUTE') AS p`), false)
  t.equal('EXECUTE granted to authenticated', await scalar(db, `SELECT has_function_privilege('authenticated', 'public.get_daily_matches(integer)', 'EXECUTE') AS p`), true)

  const cfgStill = await one(db, `SELECT threshold, daily_count FROM public.matching_config WHERE id = 1`)
  t.equal('config survived the suite unchanged at the end', [Number(cfgStill.threshold), cfgStill.daily_count], [90, 5])

  return t
}
