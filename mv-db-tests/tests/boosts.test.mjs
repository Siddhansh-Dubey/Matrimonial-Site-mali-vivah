// Profile Boost system — database-level assertions.
//
// Covers the 18 required checks of the boost correction (duration source,
// quota isolation, entitlement identity, refund safety/idempotency, stacking,
// expiry wording, no hard-coded 7 days) plus RLS / grant boundaries, the
// account-deletion cascade and the legacy-data backfill of the migration.
//
// Time travel: PGlite cannot move now(), so `advanceClock()` shifts EVERY
// timestamp of one member (subscriptions, boost periods, entitlements) into
// the past by N days — relative order is preserved, so quota accounting and
// expiry behave exactly as if N days had elapsed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Checks,
  activatePackage,
  applyMigrations,
  asService,
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

const DAY = 86400
// The boost-entitlement migration under test. Pinned by name: later migrations
// (e.g. the profile-view access model) are appended to the chain over time, so
// "the newest file" is no longer this suite's subject.
const BOOST_MIGRATION = '20260919060000_boost_entitlements.sql'
const DURATION = 5 // deliberately NOT 7 — proves every path reads the config

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function setBoostConfig(db, { durationDays, isActive, priceInr }) {
  const sets = []
  const params = []
  if (durationDays !== undefined) { params.push(durationDays); sets.push(`duration_days = $${params.length}`) }
  if (isActive !== undefined) { params.push(isActive); sets.push(`is_active = $${params.length}`) }
  if (priceInr !== undefined) { params.push(priceInr); sets.push(`price_inr = $${params.length}`) }
  await db.query(`UPDATE public.profile_boost_config SET ${sets.join(', ')} WHERE id = 1`, params)
}

async function member(db, tag, pkgSlug) {
  const id = await signUp(db, {
    email: `${tag}@example.com`,
    name: `Member ${tag}`,
    mobile: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
  })
  await completeProfile(db, id)
  if (pkgSlug) await activatePackage(db, id, pkgSlug)
  return id
}

/** Server-side order creation as /api/payments/order does it (kind='boost'). */
async function createBoostPayment(db, userId) {
  const cfg = await one(db, `SELECT price_inr, duration_days FROM public.profile_boost_config WHERE id = 1`)
  const row = await one(
    db,
    `INSERT INTO public.payments (user_id, kind, amount_inr, status, metadata, razorpay_order_id)
     VALUES ($1, 'boost', $2, 'created', $3::jsonb, 'order_' || gen_random_uuid()::text)
     RETURNING id`,
    [userId, cfg.price_inr, JSON.stringify({ item: 'boost', duration_days: cfg.duration_days })]
  )
  return row.id
}

const activatePurchase = (db, paymentId) =>
  asService(db, () => scalar(db, `SELECT public.activate_boost_purchase($1) AS r`, [paymentId]))
const refund = (db, paymentId) =>
  asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [paymentId]))
const adminGrant = (db, userId, adminId = null) =>
  asService(db, () => scalar(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [userId, adminId]))
const packageBoost = (db, userId) =>
  asUser(db, userId, () => scalar(db, `SELECT public.boost_my_profile() AS r`))
const sweep = (db) => asService(db, () => scalar(db, `SELECT public.sweep_expired_memberships() AS r`))
const hasActiveBoost = (db, userId) => scalar(db, `SELECT public.has_active_boost($1) AS r`, [userId])

async function advanceClock(db, userId, days) {
  const iv = `${days} days`
  await db.query(
    `UPDATE public.subscriptions SET started_at = started_at - $2::interval, expires_at = expires_at - $2::interval WHERE user_id = $1`,
    [userId, iv]
  )
  await db.query(
    `UPDATE public.profile_boosts SET started_at = started_at - $2::interval, expires_at = expires_at - $2::interval, created_at = created_at - $2::interval WHERE user_id = $1`,
    [userId, iv]
  )
  await db.query(
    `UPDATE public.profile_boost_entitlements
     SET starts_at = starts_at - $2::interval, ends_at = ends_at - $2::interval,
         created_at = created_at - $2::interval, revoked_at = revoked_at - $2::interval
     WHERE user_id = $1`,
    [userId, iv]
  )
}

const period = (db, id) => one(db, `SELECT * FROM public.profile_boosts WHERE id = $1`, [id])
const entByPayment = (db, paymentId) =>
  one(db, `SELECT * FROM public.profile_boost_entitlements WHERE payment_id = $1`, [paymentId])
const ent = (db, id) => one(db, `SELECT * FROM public.profile_boost_entitlements WHERE id = $1`, [id])
const livePeriods = (db, userId) =>
  scalar(db, `SELECT count(*)::int AS n FROM public.profile_boosts WHERE user_id = $1 AND status = 'active' AND expires_at > now()`, [userId])
const notifications = (db, userId, title) =>
  db.query(`SELECT title, message, metadata FROM public.notifications WHERE user_id = $1 AND ($2::text IS NULL OR title = $2) ORDER BY id`, [userId, title ?? null]).then((r) => r.rows)
const paymentStatus = (db, id) => scalar(db, `SELECT status::text AS s FROM public.payments WHERE id = $1`, [id])

const secondsBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000
const approxDays = (a, b, days, tolSec = 120) => Math.abs(secondsBetween(a, b) - days * DAY) <= tolSec
const secondsFromNow = (ts) => (new Date(ts).getTime() - Date.now()) / 1000
const sameTime = (a, b) => new Date(a).getTime() === new Date(b).getTime()

// ---------------------------------------------------------------------------
export default async function boostsSuite(db) {
  const t = new Checks('boosts')
  const admin = await signUp(db, { email: 'admin@example.com', name: 'Admin', mobile: '9000000001' })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])

  await setBoostConfig(db, { durationDays: DURATION, isActive: true, priceInr: 499 })

  // =========================================================================
  // 1. configured boost duration is used (single source, fail-safe)
  // =========================================================================
  console.log(' [1] configured boost duration is the single source')
  t.equal('boost_duration_days() returns the configured value', await scalar(db, `SELECT public.boost_duration_days() AS d`), DURATION)
  await setBoostConfig(db, { durationDays: 12 })
  t.equal('boost_duration_days() follows a config change', await scalar(db, `SELECT public.boost_duration_days() AS d`), 12)
  await setBoostConfig(db, { durationDays: DURATION })

  {
    // Missing configuration → every activation path fails loudly, nothing is
    // granted (no silent 7-day fallback).
    const u = await member(db, 'cfgmissing', 'premium-6-month')
    const pay = await createBoostPayment(db, u)
    const saved = await one(db, `SELECT price_inr, duration_days, is_active FROM public.profile_boost_config WHERE id = 1`)
    await db.query(`DELETE FROM public.profile_boost_config WHERE id = 1`)
    const e1 = await expectError(() => packageBoost(db, u))
    const e2 = await expectError(() => adminGrant(db, u, admin))
    const e3 = await expectError(() => activatePurchase(db, pay))
    t.check('package boost fails safely without config', e1.includes('BOOST_CONFIG_MISSING'), e1)
    t.check('admin grant fails safely without config', e2.includes('BOOST_CONFIG_MISSING'), e2)
    t.check('purchase activation fails safely without config', e3.includes('BOOST_CONFIG_MISSING'), e3)
    t.equal('nothing was granted while config was missing', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boosts WHERE user_id = $1`, [u]), 0)
    t.equal('no entitlement was written while config was missing', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1`, [u]), 0)
    t.equal('the payment was not captured while config was missing', await paymentStatus(db, pay), 'created')
    await db.query(`INSERT INTO public.profile_boost_config (id, price_inr, duration_days, is_active) VALUES (1, $1, $2, $3)`, [saved.price_inr, saved.duration_days, saved.is_active])
    t.equal('config row restored', await scalar(db, `SELECT duration_days FROM public.profile_boost_config WHERE id = 1`), DURATION)
    const late = await activatePurchase(db, pay)
    t.equal('the same payment activates normally once config is back', late.status, 'activated')
  }

  // =========================================================================
  // 2. admin boost uses configured duration
  // =========================================================================
  console.log(' [2] admin-granted boost')
  {
    const u = await member(db, 'adminboost', null) // free member: admin grant needs no plan
    const r = await adminGrant(db, u, admin)
    t.equal('admin grant status', r.status, 'granted')
    t.equal('admin grant reports configured duration', r.duration_days, DURATION)
    const p = await period(db, r.boost_id)
    t.check('admin period is exactly the configured length', approxDays(p.started_at, p.expires_at, DURATION), { started_at: p.started_at, expires_at: p.expires_at })
    t.equal('admin period created_via', p.created_via, 'admin')
    t.equal('admin period carries no payment', p.payment_id, null)
    const e = await ent(db, r.entitlement_id)
    t.equal('admin entitlement source', e.source, 'admin')
    t.equal('admin entitlement has no payment_id', e.payment_id, null)
    t.equal('admin entitlement duration_days', e.duration_days, DURATION)
    t.equal('admin entitlement records the granting admin', e.granted_by, admin)
    const n = await notifications(db, u, 'Profile boost activated')
    t.check('admin notification states the real duration', n.length === 1 && n[0].message.includes(`${DURATION}-day`) && !n[0].message.includes('7-day'), n[0]?.message)
    const act = await one(db, `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = 'boost_granted'`, [u])
    t.check('boost_granted activity carries the real duration', act?.metadata?.duration_days === DURATION && act?.metadata?.source === 'admin', act?.metadata)
    const again = await expectError(() => adminGrant(db, u, admin))
    t.check('second admin grant while live is refused', again.includes('BOOST_ALREADY_ACTIVE'), again)
    t.equal('still exactly one live period', await livePeriods(db, u), 1)
  }

  // =========================================================================
  // 3. package boost uses configured duration
  // =========================================================================
  console.log(' [3] package-included boost')
  {
    const u = await member(db, 'pkgboost', 'smart-3-month')
    const r = await packageBoost(db, u)
    t.equal('package boost status', r.status, 'active')
    t.equal('package boost reports configured duration', r.duration_days, DURATION)
    const p = await period(db, r.boost_id)
    t.check('package period is exactly the configured length', approxDays(p.started_at, p.expires_at, DURATION), p)
    t.equal('package period created_via', p.created_via, 'package')
    const e = await ent(db, r.entitlement_id)
    t.check('package entitlement: source=package, no payment, configured days', e.source === 'package' && e.payment_id === null && e.duration_days === DURATION, e)
    const again = await packageBoost(db, u)
    t.check('package boost is idempotent while live', again.status === 'already_active' && again.boost_id === r.boost_id, again)
    t.equal('idempotent call did not add an entitlement', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1`, [u]), 1)
    const act = await one(db, `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = 'profile_boosted'`, [u])
    t.check('profile_boosted activity logged with duration', act?.metadata?.duration_days === DURATION, act?.metadata)

    const free = await member(db, 'freeboost', null)
    const eFree = await expectError(() => packageBoost(db, free))
    t.check('free member cannot redeem a package boost', eFree.includes('BOOSTS_NOT_INCLUDED'), eFree)
  }

  // =========================================================================
  // 4. purchased boost uses configured duration
  // =========================================================================
  console.log(' [4] purchased boost')
  {
    const u = await member(db, 'buyboost', 'smart-3-month')
    const pay = await createBoostPayment(db, u)
    const r = await activatePurchase(db, pay)
    t.equal('purchase activation status', r.status, 'activated')
    t.equal('purchase reports configured duration', r.duration_days, DURATION)
    const p = await period(db, r.boost_id)
    t.check('purchased period is exactly the configured length', approxDays(p.started_at, p.expires_at, DURATION), p)
    t.equal('purchased period created_via', p.created_via, 'purchase')
    t.equal('payment captured by activation', await paymentStatus(db, pay), 'captured')
    const e = await entByPayment(db, pay)
    t.check('purchase entitlement: source=purchase, linked to its payment', e && e.source === 'purchase' && e.boost_id === r.boost_id && e.duration_days === DURATION, e)
    const n = await notifications(db, u, 'Profile Boost activated')
    t.check('purchase notification states the real duration', n.length === 1 && n[0].message.includes(`${DURATION} days`) && !n[0].message.includes('7 days'), n[0]?.message)
    const again = await activatePurchase(db, pay)
    t.check('re-activating the same payment is idempotent', again.status === 'already_activated' && again.entitlement_id === r.entitlement_id, again)
    t.equal('idempotent re-activation added no entitlement', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1`, [u]), 1)
    t.equal('exactly one live period after re-activation', await livePeriods(db, u), 1)

    const pkgPay = await one(db, `INSERT INTO public.payments (user_id, kind, amount_inr, status, package_slug) VALUES ($1, 'package', 999, 'created', 'smart-3-month') RETURNING id`, [u])
    const wrongKind = await expectError(() => activatePurchase(db, pkgPay.id))
    t.check('a package payment cannot activate a boost', wrongKind.includes('not a boost purchase'), wrongKind)
  }

  // =========================================================================
  // 5/6/7. quota counts ONLY package boosts
  // =========================================================================
  console.log(' [5-7] included-boost quota isolation')
  {
    // Smart includes 1 boost.
    const u = await member(db, 'quota-smart', 'smart-3-month')
    const pay = await createBoostPayment(db, u)
    await activatePurchase(db, pay)
    let r = await packageBoost(db, u)
    t.equal('package boost while purchase is live → already_active (no quota used)', r.status, 'already_active')
    await advanceClock(db, u, DURATION + 1)
    await sweep(db)
    t.equal('purchased period expired by the sweep', await hasActiveBoost(db, u), false)

    r = await packageBoost(db, u)
    t.equal('[6] included boost still redeemable after a standalone purchase', r.status, 'active')
    await advanceClock(db, u, DURATION + 1)
    await sweep(db)

    const limit = await expectError(() => packageBoost(db, u))
    t.check('[5] second package boost hits the plan quota (1 included)', limit.includes('BOOST_LIMIT_REACHED'), limit)

    const g = await adminGrant(db, u, admin)
    t.equal('[7] admin grant is not blocked by an exhausted package quota', g.status, 'granted')
    await advanceClock(db, u, DURATION + 1)
    await sweep(db)

    const counts = await db.query(`SELECT source, count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1 GROUP BY source ORDER BY source`, [u])
    t.equal('ledger holds one entitlement per source', counts.rows, [{ source: 'admin', n: 1 }, { source: 'package', n: 1 }, { source: 'purchase', n: 1 }])
    const stillLimited = await expectError(() => packageBoost(db, u))
    t.check('quota unchanged by purchase + admin grant (still 1/1 used)', stillLimited.includes('BOOST_LIMIT_REACHED'), stillLimited)
  }
  {
    // Premium includes 3 boosts: an admin grant + a purchase first, then all 3
    // package boosts must still be available.
    const u = await member(db, 'quota-premium', 'premium-6-month')
    await adminGrant(db, u, admin)
    await advanceClock(db, u, DURATION + 1); await sweep(db)
    const pay = await createBoostPayment(db, u)
    await activatePurchase(db, pay)
    await advanceClock(db, u, DURATION + 1); await sweep(db)
    let ok = 0
    for (let i = 0; i < 3; i++) {
      const r = await packageBoost(db, u)
      if (r.status === 'active') ok += 1
      await advanceClock(db, u, DURATION + 1); await sweep(db)
    }
    t.equal('[7] all 3 included boosts redeemable after admin grant + purchase', ok, 3)
    const fourth = await expectError(() => packageBoost(db, u))
    t.check('4th package boost refused (3 included)', fourth.includes('BOOST_LIMIT_REACHED'), fourth)
    t.equal('package entitlements counted = 3', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1 AND source = 'package'`, [u]), 3)
  }

  // =========================================================================
  // 8/9/14. purchase identity + stacking
  // =========================================================================
  console.log(' [8/9/14] purchase entitlement identity under stacking')
  {
    const u = await member(db, 'stack', 'smart-3-month')
    const payA = await createBoostPayment(db, u)
    const payB = await createBoostPayment(db, u)
    const rA = await activatePurchase(db, payA)
    const rB = await activatePurchase(db, payB)
    t.equal('A opened the period', rA.status, 'activated')
    t.equal('B stacked onto the running period', rB.status, 'stacked')
    t.equal('A and B feed the SAME visible period', rB.boost_id, rA.boost_id)
    t.equal('[14] exactly one live period (no duplicate active rows)', await livePeriods(db, u), 1)

    const eA = await entByPayment(db, payA)
    const eB = await entByPayment(db, payB)
    t.check('[8] entitlement A is linked only to payment A', eA && eA.payment_id === payA && eA.id === rA.entitlement_id, eA)
    t.check('[9] entitlement B is linked only to payment B (A was not overwritten)', eB && eB.payment_id === payB && eB.id === rB.entitlement_id && eB.id !== eA.id, eB)
    t.equal('one entitlement per payment (A)', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE payment_id = $1`, [payA]), 1)
    t.equal('one entitlement per payment (B)', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE payment_id = $1`, [payB]), 1)

    const p = await period(db, rA.boost_id)
    t.check('[14] stacking extended the visible period by one more duration', approxDays(p.started_at, p.expires_at, 2 * DURATION), p)
    t.check('B\'s slice starts exactly where A\'s ends (contiguous)', new Date(eB.starts_at).getTime() === new Date(eA.ends_at).getTime(), { aEnds: eA.ends_at, bStarts: eB.starts_at })
    t.check('period expires when B\'s slice ends', new Date(p.expires_at).getTime() === new Date(eB.ends_at).getTime(), { period: p.expires_at, bEnds: eB.ends_at })
    t.equal('period row no longer overloads payment_id', p.payment_id, null)
    const stackedNote = await notifications(db, u, 'Profile Boost activated')
    t.check('stacked notification mentions the added duration', stackedNote.length === 2 && stackedNote[1].message.includes(`${DURATION}-day boost has been added`), stackedNote[1]?.message)

    // 10. refund A → B survives with its full duration
    console.log(' [10] refund A does not revoke B')
    const rr = await refund(db, payA)
    t.equal('refund reports the boost kind', rr.kind, 'boost')
    t.equal('refund revoked entitlement A only', rr.entitlement_id, eA.id)
    t.equal('payment A refunded', await paymentStatus(db, payA), 'refunded')
    t.equal('payment B untouched', await paymentStatus(db, payB), 'captured')
    const eA2 = await ent(db, eA.id)
    const eB2 = await ent(db, eB.id)
    t.check('A is revoked', eA2.status === 'revoked' && eA2.revoked_at !== null, eA2)
    t.check('B is still granted', eB2.status === 'granted' && eB2.revoked_at === null, eB2)
    const p2 = await period(db, rA.boost_id)
    t.equal('[16] visible boost still active after refunding A', await hasActiveBoost(db, u), true)
    t.check('period now ends after exactly B\'s duration from now', Math.abs(secondsFromNow(p2.expires_at) - DURATION * DAY) < 120, { expires_at: p2.expires_at })
    t.check('B\'s slice slid earlier to start now', Math.abs(secondsFromNow(eB2.starts_at)) < 120 && approxDays(eB2.starts_at, eB2.ends_at, DURATION), eB2)
    t.check('period end == B slice end', new Date(p2.expires_at).getTime() === new Date(eB2.ends_at).getTime(), { p: p2.expires_at, b: eB2.ends_at })

    // 13. idempotent refund
    console.log(' [13] refund idempotency')
    const before = await notifications(db, u, 'Boost purchase refunded')
    const rr2 = await refund(db, payA)
    t.equal('second refund of A is a no-op', rr2.status, 'already_refunded')
    const after = await notifications(db, u, 'Boost purchase refunded')
    t.equal('no second refund notification', after.length, before.length)
    const p3 = await period(db, rA.boost_id)
    t.check('second refund changed nothing on the period', sameTime(p3.expires_at, p2.expires_at) && p3.status === 'active', { p2: p2.expires_at, p3: p3.expires_at })
    t.check('B still granted after the duplicate refund', (await ent(db, eB.id)).status === 'granted')
    t.equal('B still boosts the profile', await hasActiveBoost(db, u), true)

    // 16. refund the remaining purchase → boost state goes away cleanly
    const rr3 = await refund(db, payB)
    t.equal('refund B reports its own entitlement', rr3.entitlement_id, eB.id)
    t.equal('[16] no visible boost left after refunding every entitlement', await hasActiveBoost(db, u), false)
    const p4 = await period(db, rA.boost_id)
    t.check('period cancelled (not expired) when its last slice is refunded', p4.status === 'cancelled' && secondsFromNow(p4.expires_at) <= 1, p4)
    t.equal('no live periods remain', await livePeriods(db, u), 0)
    const rf = await one(db, `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = 'boost_refunded' ORDER BY id LIMIT 1`, [u])
    t.check('boost_refunded activity names the payment + entitlement', rf?.metadata?.payment_id === payA && rf?.metadata?.entitlement_id === eA.id, rf?.metadata)
  }

  // Partial consumption: B running for 2 days, C stacked, refund B → C keeps
  // its FULL duration and starts immediately.
  console.log(' [10b] refund of a partially consumed slice')
  {
    const u = await member(db, 'partial', 'smart-3-month')
    const payB = await createBoostPayment(db, u)
    const rB = await activatePurchase(db, payB)
    await advanceClock(db, u, 2)
    const payC = await createBoostPayment(db, u)
    const rC = await activatePurchase(db, payC)
    t.equal('C stacked onto B\'s period', rC.status, 'stacked')
    const rr = await refund(db, payB)
    t.check('refund removed only B\'s unconsumed remainder (~3 days)', Math.abs(Number(rr.revoked_seconds) - (DURATION - 2) * DAY) < 120, rr)
    const eC = await entByPayment(db, payC)
    const p = await period(db, rB.boost_id)
    t.check('C now starts immediately', Math.abs(secondsFromNow(eC.starts_at)) < 120, eC)
    t.check('C keeps its full duration', approxDays(eC.starts_at, eC.ends_at, DURATION), eC)
    t.check('period ends with C', new Date(p.expires_at).getTime() === new Date(eC.ends_at).getTime() && p.status === 'active', p)
    t.equal('member stays boosted throughout', await hasActiveBoost(db, u), true)
  }

  // =========================================================================
  // 12. refund A does not revoke a package boost (CASE A)
  // =========================================================================
  console.log(' [12] CASE A — package boost survives a purchase refund')
  {
    const u = await member(db, 'caseA', 'smart-3-month')
    const rPkg = await packageBoost(db, u)
    const payB = await createBoostPayment(db, u)
    const rB = await activatePurchase(db, payB)
    t.equal('purchase stacked onto the package period', rB.status, 'stacked')
    t.equal('same visible period', rB.boost_id, rPkg.boost_id)
    await refund(db, payB)
    const ePkg = await ent(db, rPkg.entitlement_id)
    t.check('package entitlement untouched', ePkg.status === 'granted' && ePkg.source === 'package', ePkg)
    const p = await period(db, rPkg.boost_id)
    t.check('period back to the package boost\'s own window', p.status === 'active' && new Date(p.expires_at).getTime() === new Date(ePkg.ends_at).getTime(), { p, ePkg })
    t.equal('member still boosted by the package boost', await hasActiveBoost(db, u), true)
    t.check('purchase entitlement revoked', (await entByPayment(db, payB)).status === 'revoked')
    const quota = await packageBoost(db, u)
    t.equal('package boost still counted as live (already_active), quota intact', quota.status, 'already_active')
  }

  // =========================================================================
  // 11. refund A does not revoke an admin boost (CASE C)
  // =========================================================================
  console.log(' [11] CASE C — admin boost survives a purchase refund')
  {
    const u = await member(db, 'caseC', 'smart-3-month')
    const rAdm = await adminGrant(db, u, admin)
    const payB = await createBoostPayment(db, u)
    const rB = await activatePurchase(db, payB)
    t.equal('purchase stacked onto the admin period', rB.boost_id, rAdm.boost_id)
    await refund(db, payB)
    const eAdm = await ent(db, rAdm.entitlement_id)
    t.check('admin entitlement untouched', eAdm.status === 'granted' && eAdm.source === 'admin', eAdm)
    const p = await period(db, rAdm.boost_id)
    t.check('period back to the admin boost\'s own window', p.status === 'active' && new Date(p.expires_at).getTime() === new Date(eAdm.ends_at).getTime(), { p, eAdm })
    t.equal('member still boosted by the admin boost', await hasActiveBoost(db, u), true)
  }

  // =========================================================================
  // 15. an expired entitlement cannot affect a newer one (CASE E)
  // =========================================================================
  console.log(' [15] CASE E — expired purchase vs newer entitlement')
  {
    const u = await member(db, 'caseE', 'smart-3-month')
    const payOld = await createBoostPayment(db, u)
    const rOld = await activatePurchase(db, payOld)
    await advanceClock(db, u, DURATION + 1)
    const sw = await sweep(db)
    t.check('sweep expired the old period', sw.expired_boosts >= 1, sw)
    t.equal('old period status expired', (await period(db, rOld.boost_id)).status, 'expired')
    const ended = await notifications(db, u, 'Your Profile Boost has ended')
    t.check('[9/18] expiry notification states the real length, not 7 days', ended.length === 1 && ended[0].message.includes(`${DURATION}-day`) && !ended[0].message.includes('7-day'), ended[0]?.message)

    const rNew = await packageBoost(db, u)
    t.equal('newer package boost opened a new period', rNew.status, 'active')
    const pNewBefore = await period(db, rNew.boost_id)
    const pOldBefore = await period(db, rOld.boost_id)

    const rr = await refund(db, payOld)
    t.equal('refund of the expired purchase revokes 0 seconds', Number(rr.revoked_seconds), 0)
    const pNewAfter = await period(db, rNew.boost_id)
    const pOldAfter = await period(db, rOld.boost_id)
    t.check('newer period untouched', sameTime(pNewAfter.expires_at, pNewBefore.expires_at) && pNewAfter.status === 'active', { before: pNewBefore, after: pNewAfter })
    t.check('old (expired) period keeps its history', sameTime(pOldAfter.expires_at, pOldBefore.expires_at) && pOldAfter.status === 'expired', { before: pOldBefore, after: pOldAfter })
    t.equal('member still boosted by the newer entitlement', await hasActiveBoost(db, u), true)
    t.check('old entitlement marked revoked for the books', (await entByPayment(db, payOld)).status === 'revoked')
    t.check('newer package entitlement still granted', (await ent(db, rNew.entitlement_id)).status === 'granted')
  }

  // A stacked period that runs out naturally reports its combined length.
  {
    const u = await member(db, 'stackexpire', 'smart-3-month')
    const p1 = await createBoostPayment(db, u); await activatePurchase(db, p1)
    const p2 = await createBoostPayment(db, u); await activatePurchase(db, p2)
    await advanceClock(db, u, 2 * DURATION + 1)
    await sweep(db)
    const ended = await notifications(db, u, 'Your Profile Boost has ended')
    t.check('stacked expiry notification reports the combined length', ended.length === 1 && ended[0].message.includes(`${2 * DURATION}-day`), ended[0]?.message)
  }

  // Refund of a boost payment with NO entitlement (never activated) revokes nothing.
  {
    const u = await member(db, 'noent', 'smart-3-month')
    const rPkg = await packageBoost(db, u)
    const pay = await createBoostPayment(db, u) // created, never captured/activated
    const rr = await refund(db, pay)
    t.check('refund without entitlement revokes nothing', rr.status === 'refunded' && rr.revoked === 'none', rr)
    t.equal('payment marked refunded', await paymentStatus(db, pay), 'refunded')
    t.check('unrelated live package boost untouched', (await period(db, rPkg.boost_id)).status === 'active' && (await hasActiveBoost(db, u)) === true)
    const rr2 = await refund(db, pay)
    t.equal('…and is idempotent', rr2.status, 'already_refunded')
    const eRefunded = await expectError(() => activatePurchase(db, pay))
    t.check('a refunded payment can no longer activate a boost', eRefunded.includes('was refunded'), eRefunded)
  }

  // =========================================================================
  // 17. add-on disabled still allows package + admin boosts
  // =========================================================================
  console.log(' [17] standalone add-on disabled')
  {
    await setBoostConfig(db, { isActive: false })
    const u = await member(db, 'addonoff', 'premium-6-month')
    const r = await packageBoost(db, u)
    t.check('package boost redeemable while purchases are disabled', r.status === 'active' && r.duration_days === DURATION, r)
    const u2 = await member(db, 'addonoff2', null)
    const g = await adminGrant(db, u2, admin)
    t.equal('admin grant works while purchases are disabled', g.status, 'granted')
    // A payment captured before the switch is still honoured.
    const u3 = await member(db, 'addonoff3', 'smart-3-month')
    const pay = await createBoostPayment(db, u3)
    const a = await activatePurchase(db, pay)
    t.equal('already-paid boost still activates (is_active gates selling, not honouring)', a.status, 'activated')
    await setBoostConfig(db, { isActive: true })
  }

  // =========================================================================
  // 18. no hard-coded 7-day boost activation remains
  // =========================================================================
  console.log(' [18] no hard-coded 7 days')
  {
    const def = await scalar(db, `SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profile_boosts' AND column_name = 'expires_at'`)
    t.equal('profile_boosts.expires_at has no default any more', def, null)
    const bare = await expectError(() => db.query(`INSERT INTO public.profile_boosts (user_id) VALUES ($1)`, [admin]))
    t.check('an INSERT without expires_at is rejected', bare.includes('expires_at') && bare.includes('null'), bare)
    const fns = ['boost_my_profile', 'activate_boost_purchase', 'admin_grant_boost', 'refund_membership', 'sweep_expired_memberships', 'boost_duration_days']
    for (const fn of fns) {
      const src = await scalar(db, `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`, [fn])
      t.check(`${fn}() body has no 7-day literal`, src && !/7 days|7-day|interval '7/i.test(src))
    }
    const sevenDayWindows = await scalar(
      db,
      `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE abs(extract(epoch FROM (ends_at - starts_at)) - 7 * 86400) < 60`
    )
    t.equal('no entitlement created in this run is 7 days long', sevenDayWindows, 0)
  }

  // =========================================================================
  // Security boundaries
  // =========================================================================
  console.log(' [sec] RLS + grants')
  {
    const u = await member(db, 'rls-a', 'smart-3-month')
    const v = await member(db, 'rls-b', 'smart-3-month')
    await packageBoost(db, u)
    const payV = await createBoostPayment(db, v)
    await activatePurchase(db, payV)

    const mine = await asUser(db, u, () => db.query(`SELECT user_id FROM public.profile_boost_entitlements`))
    t.check('member reads only their own entitlements', mine.rows.length === 1 && mine.rows[0].user_id === u, mine.rows)
    const ins = await asUser(db, u, () => expectError(() => db.query(`INSERT INTO public.profile_boost_entitlements (user_id, boost_id, source, duration_days, starts_at, ends_at) SELECT $1, id, 'admin', 5, now(), now() + interval '5 days' FROM public.profile_boosts WHERE user_id = $1`, [u])))
    t.check('member cannot insert an entitlement', /permission denied/i.test(ins), ins)
    const upd = await asUser(db, u, () => expectError(() => db.query(`UPDATE public.profile_boost_entitlements SET status = 'revoked', revoked_at = now() WHERE user_id = $1`, [u])))
    t.check('member cannot update an entitlement', /permission denied/i.test(upd), upd)
    const e1 = await asUser(db, u, () => expectError(() => db.query(`SELECT public.activate_boost_purchase($1)`, [payV])))
    t.check('member cannot call activate_boost_purchase()', /permission denied/i.test(e1), e1)
    const e2 = await asUser(db, u, () => expectError(() => db.query(`SELECT public.admin_grant_boost($1, $1)`, [u])))
    t.check('member cannot call admin_grant_boost()', /permission denied/i.test(e2), e2)
    const e3 = await asUser(db, u, () => expectError(() => db.query(`SELECT public.refund_membership($1)`, [payV])))
    t.check('member cannot call refund_membership()', /permission denied/i.test(e3), e3)
    const e4 = await asUser(db, u, () => expectError(() => db.query(`SELECT * FROM public.profile_boost_config`)))
    t.check('member cannot read profile_boost_config', /permission denied/i.test(e4), e4)
    const d = await asUser(db, u, () => scalar(db, `SELECT public.boost_duration_days() AS d`))
    t.equal('member may read the configured duration via boost_duration_days()', d, DURATION)
    const anonBoost = await expectError(() => db.exec(`SET ROLE anon; SELECT public.boost_my_profile();`))
    await db.exec(`RESET ROLE;`)
    t.check('anon cannot call boost_my_profile()', /permission denied/i.test(anonBoost), anonBoost)
  }

  // Account deletion cascades through the ledger (payment FK is NO ACTION).
  {
    const u = await member(db, 'delete-me', 'smart-3-month')
    const pay = await createBoostPayment(db, u)
    await activatePurchase(db, pay)
    await packageBoost(db, u)
    const del = await expectError(() => db.query(`DELETE FROM auth.users WHERE id = $1`, [u]))
    t.equal('deleting the auth user cascades through boosts + entitlements + payments', del, '')
    t.equal('no entitlement rows survive the account deletion', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1`, [u]), 0)
    t.equal('no boost rows survive the account deletion', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boosts WHERE user_id = $1`, [u]), 0)
  }

  // =========================================================================
  // Legacy data: the migration's backfill on a database that already had
  // boosts (period rows only) — run on a second database migrated up to the
  // file BEFORE the entitlement migration.
  // =========================================================================
  console.log(' [migration] backfill of pre-existing boost rows')
  {
    const files = migrationFiles()
    const latest = BOOST_MIGRATION
    const older = files.slice(0, files.indexOf(latest))
    const db2 = await freshDb()
    try {
      await applyMigrations(db2, 'multi', older)
      const u = await signUp(db2, { email: 'legacy@example.com', name: 'Legacy Member', mobile: '9111111111' })
      // Old-world rows: a package boost (7-day default), an admin boost, a
      // purchase with its payment link, a purchase whose link was lost by the
      // old stacking bug, and a cancelled package boost.
      const payKeep = await one(db2, `INSERT INTO public.payments (user_id, kind, amount_inr, status) VALUES ($1, 'boost', 499, 'captured') RETURNING id`, [u])
      await db2.query(`INSERT INTO public.profile_boosts (user_id, created_via, created_at, started_at, expires_at) VALUES ($1, 'package', now() - interval '40 days', now() - interval '40 days', now() - interval '33 days')`, [u])
      await db2.query(`INSERT INTO public.profile_boosts (user_id, created_via) VALUES ($1, 'admin')`, [u]) // relies on the OLD 7-day default
      await db2.query(`INSERT INTO public.profile_boosts (user_id, created_via, payment_id, started_at, expires_at) VALUES ($1, 'purchase', $2, now() - interval '20 days', now() - interval '13 days')`, [u, payKeep.id])
      await db2.query(`INSERT INTO public.profile_boosts (user_id, created_via, payment_id, started_at, expires_at, status) VALUES ($1, 'purchase', NULL, now() - interval '60 days', now() - interval '53 days', 'expired')`, [u])
      await db2.query(`INSERT INTO public.profile_boosts (user_id, created_via, status, started_at, expires_at) VALUES ($1, 'package', 'cancelled', now() - interval '10 days', now() - interval '3 days')`, [u])
      const beforeRows = await scalar(db2, `SELECT count(*)::int AS n FROM public.profile_boosts`)

      await applyMigrations(db2, 'multi', [latest])

      t.equal('backfill preserved every legacy boost row', await scalar(db2, `SELECT count(*)::int AS n FROM public.profile_boosts`), beforeRows)
      const ents = await db2.query(`SELECT e.source, e.payment_id, e.status, e.duration_days, b.created_via FROM public.profile_boost_entitlements e JOIN public.profile_boosts b ON b.id = e.boost_id WHERE e.user_id = $1 ORDER BY e.boost_id`, [u])
      t.equal('one entitlement per legacy row except the link-less purchase', ents.rows.length, 4)
      t.equal('legacy sources mapped', ents.rows.map((r) => r.source), ['package', 'admin', 'purchase', 'package'])
      t.check('legacy purchase keeps its payment link', ents.rows[2].payment_id === payKeep.id)
      t.equal('legacy cancelled boost recorded as revoked', ents.rows[3].status, 'revoked')
      t.equal('legacy 7-day rows carry duration_days = 7 as history', ents.rows.map((r) => r.duration_days), [7, 7, 7, 7])
      t.equal('legacy package boosts count toward the quota window', await scalar(db2, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1 AND source = 'package' AND created_at < now() - interval '30 days'`, [u]), 1)
      // Second run of the same file: nothing duplicated.
      await applyMigrations(db2, 'multi', [latest])
      t.equal('re-running the migration does not duplicate entitlements', await scalar(db2, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements WHERE user_id = $1`, [u]), 4)
      // Refunding the legacy purchase only revokes its own (already elapsed) slice.
      const rr = await asService(db2, () => scalar(db2, `SELECT public.refund_membership($1) AS r`, [payKeep.id]))
      t.check('legacy purchase refund revokes nothing still running', rr.status === 'refunded' && Number(rr.revoked_seconds) === 0, rr)
      t.equal('legacy admin boost still active after that refund', await scalar(db2, `SELECT status::text AS s FROM public.profile_boosts WHERE user_id = $1 AND created_via = 'admin'`, [u]), 'active')
    } finally {
      await db2.close()
    }
  }

  // Sanity: the migration guard refuses to run when file 20 is missing.
  {
    const files = migrationFiles()
    const idx20 = files.findIndex((f) => f.startsWith('20260919010000'))
    const db3 = await freshDb()
    try {
      await applyMigrations(db3, 'multi', files.slice(0, idx20))
      const latest = BOOST_MIGRATION
      const err = await expectError(() => applyMigrations(db3, 'multi', [latest]))
      t.check('migration refuses to run without its prerequisite', err.includes('prerequisite migration 20260919010000_boost_purchases.sql'), err)
      t.equal('…and created nothing', await scalar(db3, `SELECT to_regclass('public.profile_boost_entitlements')::text AS r`), null)
    } finally {
      await db3.close()
    }
  }

  // Keep the harness honest about which files it exercised.
  t.check('suite ran against the full migration chain', readFileSync(join(migrationsDir, BOOST_MIGRATION), 'utf8').includes('profile_boost_entitlements'))

  return t
}
