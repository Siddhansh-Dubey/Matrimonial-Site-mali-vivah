// Featured profiles & boosted exposure — database + contract assertions
// (Step 8).
//
// Covers the featured/boost exposure rules end to end at the database level,
// using the same harness (real migrations in PGlite, real RLS/GRANTs, real
// SECURITY DEFINER boundaries) as the other suites:
//
//  FEATURED
//    1. admin (service role, exactly what setFeatured uses) can feature an
//       eligible profile            2. and unfeature it again
//    3. admin-defined position controls ordering (lower position first)
//    4. ordering is deterministic, incl. equal positions / equal created_at
//    5. hidden profile excluded     6. suspended excluded
//    7. expired / never-paid / admin-hold / incomplete excluded
//    8. featuring grants no membership / verification / boost
//    9. featured never bypasses is_profile_public()
//   10. non-admins cannot write featured_profiles (RLS + grants)
//  BOOST
//   11. active boost detected (has_active_boost + is_boosted card flag)
//   12. expired boost is not active and loses boost-first ranking
//   13. boost moves a profile above newer non-boosted profiles in
//       search_matches() — ORDER only
//   14. boost does not bypass visibility
//   15. boost does not bypass block rules
//   16. boost does not bypass gender / age / city / lifestyle filters
//   17. boost does not bypass membership authorization (paid-viewer fields
//       and the advanced_search plan gate stay as the plan dictates)
//   18. package / admin / purchased boost sources stay distinct
//   19. the configured duration is authoritative (3 days configured ⇒ 3-day
//       period — never a hard-coded 7)
//   20. migration 32 introduces no hard-coded boost duration
//  HOMEPAGE + COPY
//   21. get_featured_profiles() returns cards in admin order (anon + paid)
//   22. ineligible featured profiles are skipped (not leaked)
//   23. empty curation returns an honest [] (the section hides itself)
//   24. no private contact data in cards; names masked for anon viewers
//   25. no unsupported "triples your views" style claim remains in the copy
//  SECURITY
//   26. non-admins cannot mutate featured ordering
//   27. non-admins cannot mutate boost configuration / use service RPCs
//   28. public clients cannot force themselves into featured/boosted exposure
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Checks,
  activatePackage,
  asService,
  asUser,
  completeProfile,
  expectError,
  freshDb,
  one,
  repoRoot,
  scalar,
  signUp,
} from '../lib/harness.mjs'

const MIGRATION = '20260920000000_featured_boost_ordering.sql'
const repoFile = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const DAY = 86400

async function member(db, tag, { gender = 'male', pkg = 'smart-3-month' } = {}) {
  const id = await signUp(db, {
    email: `${tag}@example.com`,
    name: `Member ${tag}`,
    mobile: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
  })
  await completeProfile(db, id, { gender })
  if (pkg) await activatePackage(db, id, pkg)
  return id
}

/**
 * Exactly the write setFeatured performs. Runs as the table owner (the
 * harness's migration session): in a real Supabase project the service-role
 * client holds platform-granted table privileges, while the PGlite shim only
 * grants what the migrations spell out — so the owner session is the
 * faithful stand-in for the admin write path. The boundary that actually
 * matters (clients can never write this table) is asserted in [8].
 */
const feature = (db, userId, position, adminId) =>
  one(
    db,
    `INSERT INTO public.featured_profiles (profile_id, position, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (profile_id) DO UPDATE SET position = EXCLUDED.position, created_by = EXCLUDED.created_by
     RETURNING profile_id, position`,
    [userId, position, adminId]
  )
const unfeature = (db, userId) =>
  scalar(db, `DELETE FROM public.featured_profiles WHERE profile_id = $1 RETURNING profile_id`, [userId])
const featuredRow = (db, userId) => one(db, `SELECT * FROM public.featured_profiles WHERE profile_id = $1`, [userId])

/** get_featured_profiles() as the anonymous homepage. */
const featuredAnon = (db, limit = 8) => asAnon(db, () => scalar(db, `SELECT public.get_featured_profiles($1) AS r`, [limit]))
/** get_featured_profiles() as a signed-in viewer. */
const featuredAs = (db, viewerId, limit = 8) =>
  asUser(db, viewerId, () => scalar(db, `SELECT public.get_featured_profiles($1) AS r`, [limit]))

async function asAnon(db, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);
                 SELECT set_config('request.jwt.claim.role', 'anon', false);
                 SET ROLE anon;`)
  try {
    return await fn()
  } finally {
    try {
      await db.exec(`RESET ROLE;
                     SELECT set_config('request.jwt.claim.role', '', false);`)
    } catch { /* aborted transaction — same fallback as the harness */ }
  }
}

/** search_matches() as a signed-in viewer (no filters unless given). */
const searchAs = (db, viewerId, params = {}) =>
  asUser(db, viewerId, () =>
    scalar(db, `SELECT public.search_matches($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS r`,
      [params.lookingFor ?? null, params.minAge ?? null, params.maxAge ?? null, params.city ?? null,
       params.subCommunity ?? null, params.limit ?? 200, params.education ?? null, params.occupation ?? null,
       params.nativePlace ?? null, params.maritalStatus ?? null, params.diet ?? null, params.minIncome ?? null,
       params.minHeight ?? null, params.maxHeight ?? null, params.smoking ?? null, params.drinking ?? null])
  )
const searchAnon = (db, params = {}) =>
  asAnon(db, () =>
    scalar(db, `SELECT public.search_matches($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS r`,
      [params.lookingFor ?? null, params.minAge ?? null, params.maxAge ?? null, params.city ?? null,
       params.subCommunity ?? null, params.limit ?? 5, params.education ?? null, params.occupation ?? null,
       params.nativePlace ?? null, params.maritalStatus ?? null, params.diet ?? null, params.minIncome ?? null,
       params.minHeight ?? null, params.maxHeight ?? null, params.smoking ?? null, params.drinking ?? null])
  )

const ids = (cards) => (cards ?? []).map((c) => c.user_id)
const hasLive = (db, userId) => scalar(db, `SELECT public.has_live_membership($1) AS r`, [userId])
const isPublic = (db, userId) => scalar(db, `SELECT public.is_profile_public($1) AS r`, [userId])
const hasBoost = (db, userId) => scalar(db, `SELECT public.has_active_boost($1) AS r`, [userId])
const suspend = (db, userId, adminId) =>
  asService(db, () => scalar(db, `SELECT public.admin_set_profile_suspended($1, TRUE, $2, 'test') AS r`, [userId, adminId]))
const hold = (db, userId, adminId) =>
  asService(db, () => scalar(db, `SELECT public.admin_set_profile_hidden($1, TRUE, $2, 'test') AS r`, [userId, adminId]))
const packageBoost = (db, userId) =>
  asUser(db, userId, () => scalar(db, `SELECT public.boost_my_profile() AS r`))
const adminGrant = (db, userId, adminId) =>
  asService(db, () => scalar(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [userId, adminId]))
const createBoostPayment = (db, userId) =>
  one(db, `INSERT INTO public.payments (user_id, kind, amount_inr, status, metadata, razorpay_order_id)
           VALUES ($1, 'boost', 499, 'created', '{"item":"boost"}'::jsonb, 'order_' || gen_random_uuid()::text)
           RETURNING id`, [userId])
const activatePurchase = (db, paymentId) =>
  asService(db, () => scalar(db, `SELECT public.activate_boost_purchase($1) AS r`, [paymentId]))

/** Shift one member's boost clock into the past (PGlite cannot move now()). */
async function expireBoosts(db, userId) {
  await db.query(
    `UPDATE public.profile_boosts SET started_at = started_at - interval '30 days', expires_at = expires_at - interval '30 days' WHERE user_id = $1`,
    [userId]
  )
}

// ---------------------------------------------------------------------------
export default async function featuredBoostExposureSuite(db) {
  const t = new Checks('featured-boost-exposure')

  const admin = await signUp(db, { email: 'admin@example.com', name: 'Admin', mobile: '9000000001' })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])
  // A duration that is deliberately NOT the historical 7 days.
  await db.query(`UPDATE public.profile_boost_config SET duration_days = 3, price_inr = 499, is_active = TRUE WHERE id = 1`)

  // =========================================================================
  console.log(' [1] admin curation: feature, unfeature, reorder')
  // =========================================================================
  {
    const a = await member(db, 'ord-a')
    const b = await member(db, 'ord-b')
    const c = await member(db, 'ord-c')

    // 1 — feature an eligible (public) profile, the way setFeatured writes it
    const row = await feature(db, b, 30, admin)
    t.check('admin can feature an eligible profile', row?.profile_id === b && row?.position === 30, row)
    t.check('featured profile is returned by the public RPC', ids(await featuredAnon(db)).includes(b))

    // 2 — unfeature
    await unfeature(db, b)
    t.check('admin can unfeature (row removed)', (await featuredRow(db, b)) === null)
    t.check('unfeatured profile no longer returned', !ids(await featuredAnon(db)).includes(b))

    // 3 — position is authoritative: feature 30 / 10 / 20 → 10, 20, 30
    await feature(db, a, 30, admin)
    await feature(db, b, 10, admin)
    await feature(db, c, 20, admin)
    t.equal('admin-defined position controls order (lower first)', ids(await featuredAnon(db)), [b, c, a])

    // reorder without re-featuring (upsert path the Featured page uses)
    await feature(db, b, 40, admin)
    t.equal('reordering an already-featured profile works', ids(await featuredAnon(db)), [c, a, b])

    // p_limit takes the FIRST N by position
    t.equal('p_limit keeps the earliest positions', ids(await featuredAnon(db, 2)), [c, a])

    // 4 — deterministic, incl. equal positions and equal created_at
    await feature(db, a, 5, admin)
    await feature(db, b, 5, admin)
    await feature(db, c, 5, admin)
    // Force identical created_at so only position → created_at → profile_id can order.
    await db.query(`UPDATE public.featured_profiles SET created_at = '2026-01-01T00:00:00Z' WHERE position = 5`)
    const tieOrder = [a, b, c].sort() // profile_id ASC — the guaranteed total order
    let stable = true
    for (let i = 0; i < 3; i++) {
      const got = ids(await featuredAnon(db))
      if (JSON.stringify(got) !== JSON.stringify(tieOrder)) stable = false
    }
    t.check('equal position + equal created_at order by profile_id, deterministically', stable, tieOrder)

    // Featured row for a duplicate position survives and is not an error state
    t.equal('equal positions are a legal state (three rows kept)',
      await scalar(db, `SELECT count(*)::int AS n FROM public.featured_profiles WHERE position = 5`), 3)

    // paid viewer sees the same admin order
    const paidViewer = await member(db, 'ord-viewer', { pkg: 'premium-6-month' })
    t.equal('paid viewer sees the same admin-defined order', ids(await featuredAs(db, paidViewer)), tieOrder)

    await db.query(`DELETE FROM public.featured_profiles`)
  }

  // =========================================================================
  console.log(' [2] ineligible featured profiles are skipped, never leaked')
  // =========================================================================
  {
    const hidden = await member(db, 'st-hidden')
    const suspended = await member(db, 'st-susp')
    const expired = await member(db, 'st-exp')
    const neverPaid = await member(db, 'st-free', { pkg: null })
    const onHold = await member(db, 'st-hold')
    const incomplete = await member(db, 'st-inc')
    const ok = await member(db, 'st-ok')

    // hidden (APPROVED_FREE-style admin/user privacy state)
    await db.query(`UPDATE public.matrimony_profiles SET status = 'hidden' WHERE user_id = $1`, [hidden])
    // suspended through the real Step 7 RPC
    await suspend(db, suspended, admin)
    // lapsed membership: time-aware gate + sweep-style status
    await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = $1 AND status = 'active'`, [expired])
    await db.query(`UPDATE public.matrimony_profiles SET status = 'expired' WHERE user_id = $1`, [expired])
    // never-paid member "published" — the publish gate coerces to hidden
    await db.query(`UPDATE public.matrimony_profiles SET status = 'hidden' WHERE user_id = $1`, [neverPaid])
    // admin hold (status untouched)
    await hold(db, onHold, admin)
    // incomplete: family photo gone ⇒ publish checklist broken
    await db.query(`DELETE FROM public.profile_photos WHERE profile_id = $1 AND kind = 'family_photo'`, [incomplete])

    for (const [id, why] of [[hidden, 'hidden'], [suspended, 'suspended'], [expired, 'expired'],
      [neverPaid, 'never-paid'], [onHold, 'admin-hold'], [incomplete, 'incomplete']]) {
      t.check(`${why} profile is not public`, (await isPublic(db, id)) === false)
      await feature(db, id, 1, admin)
    }
    await feature(db, ok, 50, admin)

    const got = ids(await featuredAnon(db))
    t.equal('only the eligible featured profile is shown', got, [ok])
    t.equal('the six ineligible featured rows survive without manual removal',
      await scalar(db, `SELECT count(*)::int AS n FROM public.featured_profiles WHERE profile_id <> $1`, [ok]), 6)

    // recovery: lift the hold → the member is publicly featured again, no re-curation
    await asService(db, () => scalar(db, `SELECT public.admin_set_profile_hidden($1, FALSE, $2, NULL) AS r`, [onHold, admin]))
    t.check('un-hiding restores public exposure automatically', ids(await featuredAnon(db)).includes(onHold))

    // blocked pair: a viewer who blocked the featured member must not see them
    await asUser(db, ok, () =>
      db.query(`INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [ok, onHold]))
    t.check('blocked pair is hidden for that viewer', !ids(await featuredAs(db, ok)).includes(onHold))
    t.check('other viewers still see the featured member', ids(await featuredAnon(db)).includes(onHold))

    // empty state is honest: [] (the homepage section hides itself)
    await db.query(`DELETE FROM public.featured_profiles`)
    t.equal('empty curation returns an empty array', await featuredAnon(db), [])
  }

  // =========================================================================
  console.log(' [3] featured ≠ paid / verified / boosted (states stay distinct)')
  // =========================================================================
  {
    const m = await member(db, 'dist-feat')
    const subsBefore = await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1`, [m])
    const paymentsBefore = await scalar(db, `SELECT count(*)::int AS n FROM public.payments WHERE user_id = $1`, [m])
    await feature(db, m, 7, admin)
    t.check('featuring creates no membership', await hasLive(db, m) === true && subsBefore ===
      await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1`, [m]))
    t.check('featuring creates no payment', paymentsBefore ===
      await scalar(db, `SELECT count(*)::int AS n FROM public.payments WHERE user_id = $1`, [m]))
    const card = (await featuredAnon(db)).find((c) => c.user_id === m)
    t.check('featured card is not automatically boosted', card?.is_boosted === false)
    t.check('featuring does not verify the profile', card?.verified === false)

    // A boosted member is NOT auto-inserted into the homepage Featured section
    const boostedOnly = await member(db, 'dist-boost')
    await packageBoost(db, boostedOnly)
    t.check('boost alone does not put a member into Featured', !ids(await featuredAnon(db)).includes(boostedOnly))

    // A member can be both — and boost must NOT reorder the admin's section
    const both = await member(db, 'dist-both')
    await packageBoost(db, both)
    await feature(db, m, 1, admin)   // unboosted, position 1
    await feature(db, both, 2, admin) // boosted, position 2
    t.equal('boost never reorders the admin-curated Featured section',
      ids(await featuredAnon(db)), [m, both])
    const bothCard = (await featuredAnon(db)).find((c) => c.user_id === both)
    t.check('featured + boosted member carries the boost badge (display only)', bothCard?.is_boosted === true)
    await db.query(`DELETE FROM public.featured_profiles`)
  }

  // =========================================================================
  console.log(' [4] boost ordering in search (server-authoritative, deterministic)')
  // =========================================================================
  {
    const viewer = await member(db, 'srch-viewer', { gender: 'female' })
    const boosted = await member(db, 'srch-boosted')
    const newer = await member(db, 'srch-newer')
    const tie1 = await member(db, 'srch-tie1')
    const tie2 = await member(db, 'srch-tie2')

    // 11 — active boost is detected
    await packageBoost(db, boosted)
    t.check('has_active_boost() detects the active boost', (await hasBoost(db, boosted)) === true)
    let cards = await searchAs(db, viewer, { lookingFor: 'male' })
    t.check('boosted profile is flagged in search cards', cards.find((c) => c.user_id === boosted)?.is_boosted === true)
    t.check('non-boosted profile is not flagged', cards.find((c) => c.user_id === newer)?.is_boosted === false)

    // 13 — boost ranks ABOVE a newer non-boosted profile
    await db.query(`UPDATE public.matrimony_profiles SET city = city WHERE user_id = $1`, [newer]) // fresher updated_at
    cards = await searchAs(db, viewer, { lookingFor: 'male' })
    const order = ids(cards)
    t.check('boosted profile ranks above a newer non-boosted profile',
      order.indexOf(boosted) < order.indexOf(newer), order)

    // 4/13 — deterministic tie-break: identical (boosted, updated_at) → user_id
    await packageBoost(db, tie1)
    await packageBoost(db, tie2)
    // one transaction ⇒ both rows get the same transaction timestamp
    await db.exec(`BEGIN;
      UPDATE public.matrimony_profiles SET city = city WHERE user_id = '${tie1}';
      UPDATE public.matrimony_profiles SET city = city WHERE user_id = '${tie2}';
      COMMIT;`)
    const tieExpect = [tie1, tie2].sort()
    let tieStable = true
    for (let i = 0; i < 3; i++) {
      const got = ids(await searchAs(db, viewer, { lookingFor: 'male' }))
      if (got.indexOf(tieExpect[0]) >= got.indexOf(tieExpect[1])) tieStable = false
    }
    t.check('equal score rows keep a deterministic order (user_id tie-break)', tieStable)

    // 12 — an expired boost is not active and loses boost-first ranking
    await expireBoosts(db, boosted)
    t.check('expired boost is no longer active', (await hasBoost(db, boosted)) === false)
    cards = await searchAs(db, viewer, { lookingFor: 'male' })
    t.check('expired boost loses its card flag', cards.find((c) => c.user_id === boosted)?.is_boosted === false)
    t.check('expired boost loses boost-first ranking',
      ids(cards).indexOf(boosted) > ids(cards).indexOf(newer))
  }

  // =========================================================================
  console.log(' [5] boost changes ORDER only — it never bypasses a gate')
  // =========================================================================
  {
    const viewer = await member(db, 'gate-viewer', { gender: 'female', pkg: 'premium-6-month' })
    const bHidden = await member(db, 'gate-hidden')
    const bSuspended = await member(db, 'gate-susp')
    const bLapsed = await member(db, 'gate-lapsed')
    const bIncomplete = await member(db, 'gate-inc')
    const bBlocked = await member(db, 'gate-blocked')
    const bFiltered = await member(db, 'gate-filtered')
    const visible = await member(db, 'gate-visible')

    for (const id of [bHidden, bSuspended, bLapsed, bIncomplete, bBlocked, bFiltered, visible]) {
      await packageBoost(db, id)
      t.check(`${id.slice(0, 8)} is boosted before the gate test`, (await hasBoost(db, id)) === true)
    }

    await db.query(`UPDATE public.matrimony_profiles SET status = 'hidden' WHERE user_id = $1`, [bHidden])
    await suspend(db, bSuspended, admin)
    await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = $1 AND status = 'active'`, [bLapsed])
    await db.query(`DELETE FROM public.profile_photos WHERE profile_id = $1 AND kind = 'family_photo'`, [bIncomplete])

    let res = ids(await searchAs(db, viewer, { lookingFor: 'male' }))
    t.check('boost does not bypass hidden status', !res.includes(bHidden))
    t.check('boost does not bypass suspension', !res.includes(bSuspended))
    t.check('boost does not bypass membership expiry', !res.includes(bLapsed))
    t.check('boost does not bypass profile completeness', !res.includes(bIncomplete))
    t.check('the visible boosted profile is still found', res.includes(visible))

    // 15 — blocks
    await asUser(db, viewer, () =>
      db.query(`INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [viewer, bBlocked]))
    res = ids(await searchAs(db, viewer, { lookingFor: 'male' }))
    t.check('boost does not bypass block rules', !res.includes(bBlocked))

    // 16 — filters (gender / age / city / lifestyle-for-advanced-plans)
    res = ids(await searchAs(db, viewer, { lookingFor: 'female' }))
    t.check('boost does not bypass the gender filter', !res.includes(visible))
    res = ids(await searchAs(db, viewer, { lookingFor: 'male', minAge: 60 }))
    t.check('boost does not bypass the age filter', !res.includes(visible))
    res = ids(await searchAs(db, viewer, { lookingFor: 'male', city: 'Mumbai' }))
    t.check('boost does not bypass the city filter', !res.includes(visible))
    await db.query(`UPDATE public.matrimony_profiles SET diet = 'non_vegetarian' WHERE user_id = $1`, [bFiltered])
    res = ids(await searchAs(db, viewer, { lookingFor: 'male', diet: 'vegetarian' }))
    t.check('boost does not bypass the advanced lifestyle filter', !res.includes(bFiltered))
    t.check('the diet filter still admits matching profiles', res.includes(visible))

    // 17 — membership authorization of the VIEWER is untouched by boosts
    const freeViewer = await member(db, 'gate-freeviewer', { pkg: null })
    const freeCards = await searchAs(db, freeViewer, { lookingFor: 'male', diet: 'vegetarian' })
    const vc = freeCards.find((c) => c.user_id === visible)
    t.check('a free viewer still sees masked results despite a boosted candidate', vc?.name_full == null && vc?.city == null)
    t.check('advanced filters stay inert for a free viewer (diet ignored)',
      freeCards.some((c) => c.user_id === bFiltered))
  }

  // =========================================================================
  console.log(' [6] boost duration + sources (single source, distinct quotas)')
  // =========================================================================
  {
    // 19 — configured duration is authoritative on every path
    const u = await member(db, 'dur-pkg')
    const r = await packageBoost(db, u)
    t.check('package boost uses the configured duration (3 days, not 7)',
      r?.duration_days === 3 && Math.abs((new Date(r.expires_at) - Date.now()) / 1000 - 3 * DAY) < 120, r)

    const v = await member(db, 'dur-buy')
    const pay = await createBoostPayment(db, v)
    const buy = await activatePurchase(db, pay.id)
    t.check('purchased boost uses the configured duration too',
      buy?.duration_days === 3 && Math.abs((new Date(buy.expires_at) - Date.now()) / 1000 - 3 * DAY) < 120, buy)

    // 18 — sources stay distinct: the purchase consumed no package quota…
    const pkgEntitlements = (id) =>
      scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1 AND source = 'package'`, [id])
    t.equal('purchase wrote a purchase entitlement, not a package one', await pkgEntitlements(v), 0)
    const sources = await db.query(
      `SELECT DISTINCT source FROM public.profile_boost_entitlements WHERE user_id = ANY($1)`,
      [[u, v]])
    t.check('package and purchase entitlements keep their own sources',
      sources.rows.some((x) => x.source === 'package') && sources.rows.some((x) => x.source === 'purchase'))

    // …and an admin grant is refused while the visible period is live
    const e = await expectError(() => adminGrant(db, u, admin))
    t.check('admin grant refused while a boost is live (one visible period)', /BOOST_ALREADY_ACTIVE/.test(e), e)

    // the admin path itself works and is boosted in search
    const w = await member(db, 'dur-admin')
    const g = await adminGrant(db, w, admin)
    t.check('admin grant uses the configured duration', g?.duration_days === 3, g)
    const viewer = await member(db, 'dur-viewer', { gender: 'female' })
    t.check('admin-granted boost is visible in search',
      (await searchAs(db, viewer, { lookingFor: 'male' })).find((c) => c.user_id === w)?.is_boosted === true)

    // 20 — migration 32 itself adds no hard-coded duration
    const migration = repoFile(`supabase/migrations/${MIGRATION}`)
    t.check('migration 32 introduces no hard-coded boost duration',
      !/interval\s+'7 days'/.test(migration) && !/interval\s+'3 days'/.test(migration))
  }

  // =========================================================================
  console.log(' [7] homepage + marketing-copy contract')
  // =========================================================================
  {
    const a = await member(db, 'home-a')
    const b = await member(db, 'home-b')
    await feature(db, b, 2, admin)
    await feature(db, a, 1, admin)
    t.equal('homepage RPC returns the admin order', ids(await featuredAnon(db)), [a, b])

    // 24 — the card payload is contact-free and anon-safe
    const anonCards = await featuredAnon(db)
    const allowed = new Set(['user_id', 'name', 'name_full', 'age', 'gender', 'height_cm', 'sub_community',
      'marital_status', 'education', 'occupation', 'city', 'state', 'diet', 'photo', 'has_photo',
      'verified', 'is_boosted', 'viewer_is_paid'])
    t.check('featured cards expose only the safe fields',
      anonCards.every((c) => Object.keys(c).every((k) => allowed.has(k))),
      anonCards.flatMap((c) => Object.keys(c)).filter((k) => !allowed.has(k)))
    t.check('no phone / email / address in featured cards',
      anonCards.every((c) => !('mobile' in c) && !('email' in c) && !('contact_phone' in c) && !('address' in c)))
    t.check('anon name is masked', anonCards.every((c) => /^Member$|^[^ ]\*+$/.test(c.name)))
    t.check('anon cards carry no full name / age / city', anonCards.every((c) => c.name_full == null && c.age == null && c.city == null))

    const paid = await member(db, 'home-paid', { pkg: 'premium-6-month' })
    const paidCards = await featuredAs(db, paid)
    t.check('paid viewer gets the full name', paidCards.every((c) => typeof c.name_full === 'string'))
    await db.query(`DELETE FROM public.featured_profiles`)

    // 25 + homepage source contract
    const viewsPage = repoFile('src/app/profile/views/page.tsx')
    t.check('views page no longer claims a view multiplier',
      !/triples|three times|3x|300%/i.test(viewsPage))
    t.check('views page keeps honest boost copy', /increase its visibility in\s*search/.test(viewsPage))
    const boostCard = repoFile('src/components/profile/boost-card.tsx')
    t.check('boost card makes no quantitative performance claim',
      !/triples|three times|3x|300%/i.test(boostCard))
    const section = repoFile('src/components/home/featured-profiles-section.tsx')
    t.check('homepage section reads the authoritative RPC', /rpc\('get_featured_profiles'/.test(section))
    t.check('homepage section does not re-sort or shuffle the admin order', !/\.sort\(|\.reverse\(|shuffle/.test(section))
    t.check('homepage section has no hard-coded member data', !/user_id:\s*['"]/.test(section))
  }

  // =========================================================================
  console.log(' [8] security boundaries (RLS, grants, service-role-only RPCs)')
  // =========================================================================
  {
    const attacker = await member(db, 'sec-attacker')
    const victim = await member(db, 'sec-victim')

    // 26 — a non-admin member cannot mutate featured state or ordering
    const ins = await expectError(() => asUser(db, attacker, () =>
      db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 1)`, [attacker])))
    t.check('member cannot feature themselves', /permission denied|violates row-level/i.test(ins), ins)
    await feature(db, victim, 3, admin)
    const upd = await expectError(() => asUser(db, attacker, () =>
      db.query(`UPDATE public.featured_profiles SET position = 1`)))
    t.check('member cannot reorder featured profiles', /permission denied|violates row-level/i.test(upd), upd)
    const del = await expectError(() => asUser(db, attacker, () =>
      db.query(`DELETE FROM public.featured_profiles`)))
    t.check('member cannot unfeature profiles', /permission denied|violates row-level/i.test(del), del)

    // anon cannot either
    const anonIns = await expectError(() => asAnon(db, () =>
      db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 1)`, [victim])))
    t.check('anon cannot force itself into Featured', /permission denied|violates row-level/i.test(anonIns), anonIns)

    // 27/28 — no self-boosting, no config tampering, service-only RPCs
    const selfBoost = await expectError(() => asUser(db, attacker, () =>
      db.query(`INSERT INTO public.profile_boosts (user_id, status, started_at, expires_at, created_via)
                VALUES ($1, 'active', now(), now() + interval '30 days', 'purchase')`, [attacker])))
    t.check('member cannot insert a boost row for themselves', /permission denied|violates row-level/i.test(selfBoost), selfBoost)
    const cfg = await expectError(() => asUser(db, attacker, () =>
      db.query(`UPDATE public.profile_boost_config SET duration_days = 30 WHERE id = 1`)))
    t.check('member cannot mutate the boost configuration', /permission denied|violates row-level/i.test(cfg), cfg)
    const payRow = await createBoostPayment(db, attacker)
    for (const fn of ['admin_grant_boost', 'activate_boost_purchase', 'refund_membership']) {
      const args = fn === 'admin_grant_boost' ? `'${attacker}', NULL` : `'${payRow.id}'`
      const e = await expectError(() => asUser(db, attacker, () =>
        db.query(`SELECT public.${fn}(${args})`)))
      t.check(`member cannot execute ${fn}`, /permission denied/i.test(e), e)
      const eAnon = await expectError(() => asAnon(db, () =>
        db.query(`SELECT public.${fn}(${args})`)))
      t.check(`anon cannot execute ${fn}`, /permission denied/i.test(eAnon), eAnon)
    }
    const anonBoostSelf = await expectError(() => asAnon(db, () => db.query(`SELECT public.boost_my_profile()`)))
    t.check('anon cannot redeem a boost', /permission denied/i.test(anonBoostSelf), anonBoostSelf)

    // the victim's exposure is untouched by all the failed attempts
    t.equal('featured order survived the attacks', ids(await featuredAnon(db)), [victim])
    t.check('no boost appeared for the attacker', (await hasBoost(db, attacker)) === false)
    t.equal('boost duration configuration is unchanged',
      await scalar(db, `SELECT duration_days FROM public.profile_boost_config WHERE id = 1`), 3)

    // grant map: public exposure RPCs stay open, privileged ones stay closed
    const privs = (await db.query(`
      SELECT p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_ok
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_featured_profiles','search_matches','admin_grant_boost','activate_boost_purchase')`)).rows
    const byName = Object.fromEntries(privs.map((r) => [r.proname, r]))
    t.check('get_featured_profiles stays anon+authenticated',
      byName.get_featured_profiles?.anon_ok && byName.get_featured_profiles?.auth_ok)
    t.check('search_matches stays anon+authenticated',
      byName.search_matches?.anon_ok && byName.search_matches?.auth_ok)
    t.check('boost grant/activation stay service-role only',
      !byName.admin_grant_boost?.anon_ok && !byName.admin_grant_boost?.auth_ok
      && !byName.activate_boost_purchase?.anon_ok && !byName.activate_boost_purchase?.auth_ok
      && byName.admin_grant_boost?.svc_ok && byName.activate_boost_purchase?.svc_ok)

    // app-level contract: the admin action re-checks the caller + position
    const actions = repoFile('src/app/admin/actions.ts')
    t.check('setFeatured re-verifies the acting admin', /export async function setFeatured[\s\S]*?requireAdminAction\(\)/.test(actions))
    t.check('setFeatured validates the position server-side',
      /export async function setFeatured[\s\S]*?Number\.isInteger\(position\)/.test(actions))
    t.check('setFeatured blocks newly featuring a non-public profile',
      /export async function setFeatured[\s\S]*?Only publicly visible profiles can be featured/.test(actions))
    const dashboard = repoFile('src/app/admin/page.tsx')
    t.check("dashboard 'Active boosts' tile links to /admin/boosts",
      /label: 'Active boosts',[^\n]*href: '\/admin\/boosts'/.test(dashboard))
    t.check('dashboard no longer points the boosts tile at /admin/featured',
      !/label: 'Active boosts',[^\n]*href: '\/admin\/featured'/.test(dashboard))
  }

  return t
}
