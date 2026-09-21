// Admin membership REVOCATION — entitlement only, money untouched.
//
// Covers the required scenarios against the real migration chain:
//
//   A  free user with a 24-hour Platinum demo  → nothing to revoke, Platinum stays
//   B  Platinum + Premium, revoke Premium      → Platinum stays live, member stays paid
//   C  Premium only, revoke Premium            → member loses every paid capability
//   D  Platinum only, "revoke Premium"         → nothing Platinum-related is deleted
//   E  Platinum expires                        → the existing sweeps/visibility apply
//   F  Premium bought while Platinum is live   → revoking Premium never touches Platinum
//
// plus: authorization boundaries, idempotency, payment/Razorpay preservation,
// audit + activity + notification, search / Express Interest / visibility loss,
// boosts and featured status left alone, profile & account data intact, and
// client payload forgery.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  Checks,
  activatePackage,
  asService,
  asUser,
  completeProfile,
  expectError,
  one,
  repoRoot,
  scalar,
  signUp,
} from '../lib/harness.mjs'

/** Every .ts/.tsx file under a directory, recursively. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

const FIRST100_SLUG = 'platinum-launch-30d'
const DEMO_SLUG = 'platinum-demo-24h'

async function asAnon(db, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);
                 SELECT set_config('request.jwt.claim.role', 'anon', false);
                 SET ROLE anon;`)
  try {
    return await fn()
  } finally {
    try {
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false)`)
    } catch { /* aborted transaction */ }
  }
}

let seq = 0
async function member(db, { name, gender = 'male', admin = false } = {}) {
  seq += 1
  const id = await signUp(db, {
    email: `rv-${seq}-${Date.now().toString(36)}@example.com`,
    name,
    mobile: `97${String(20000000 + seq).slice(0, 8)}`,
    forWhom: 'self',
  })
  await completeProfile(db, id, { gender })
  if (admin) await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [id])
  return id
}

/** A real Razorpay-shaped captured payment, activated through the real RPC. */
async function paidMembership(db, userId, slug = 'premium-6-month') {
  const pkg = await one(db, `SELECT id, price_inr, duration_days FROM public.packages WHERE slug = $1`, [slug])
  seq += 1
  const pay = await one(
    db,
    `INSERT INTO public.payments
       (user_id, kind, package_id, package_slug, amount_inr, duration_days, status,
        razorpay_order_id, razorpay_payment_id, membership_started_at, membership_expires_at)
     VALUES ($1, 'package', $2, $3, $4, $5, 'created', $6, $7, NULL, NULL)
     RETURNING id, razorpay_order_id, razorpay_payment_id, amount_inr, created_at`,
    [
      userId, pkg.id, slug, pkg.price_inr, pkg.duration_days,
      `order_rv_${seq}_${Math.random().toString(16).slice(2)}`,
      `pay_rv_${seq}_${Math.random().toString(16).slice(2)}`,
    ]
  )
  const res = await asService(db, () =>
    one(db, `SELECT public.activate_membership($1, $2, $3) AS r`, [userId, pkg.id, pay.id])
  )
  const sub = await one(
    db,
    `SELECT id FROM public.subscriptions WHERE user_id = $1 AND payment_id = $2`,
    [userId, pay.id]
  )
  return { payment: pay, activation: res.r, subscriptionId: sub.id, slug, packageId: pkg.id, price: pkg.price_inr }
}

/** The member's own Platinum launch claim (the real RPC, first-100 or demo). */
function claimPlatinum(db, userId) {
  return asUser(db, userId, () => one(db, `SELECT public.claim_platinum_launch_offer() AS r`)).then((r) => r.r)
}

const revoke = (db, adminId, userId, opts = {}) =>
  asService(db, () =>
    one(
      db,
      `SELECT public.admin_revoke_membership($1, $2, $3, $4, $5) AS r`,
      [adminId, userId, opts.reason ?? 'support_action', opts.note ?? null, opts.subscriptionId ?? null]
    )
  ).then((r) => r.r)

async function subRow(db, id) {
  return one(db, `SELECT id, status, package_slug, expires_at, payment_id FROM public.subscriptions WHERE id = $1`, [id])
}

async function payRow(db, id) {
  return one(
    db,
    `SELECT id, status, amount_inr, currency, razorpay_order_id, razorpay_payment_id, created_at, updated_at,
            package_slug, package_id, kind, metadata, membership_started_at, membership_expires_at
     FROM public.payments WHERE id = $1`,
    [id]
  )
}

async function profileStatus(db, userId) {
  return scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [userId])
}

async function activityCount(db, userId, event) {
  return scalar(db, `SELECT count(*)::int FROM public.activity_events WHERE user_id = $1 AND event = $2`, [userId, event])
}

async function auditRows(db, userId, action = 'admin_membership_revoked') {
  return (
    await db.query(
      `SELECT id, admin_id, action, target_type, target_id, details, created_at
       FROM public.admin_audit_log WHERE target_id = $1::text AND action = $2 ORDER BY id`,
      [userId, action]
    )
  ).rows
}

/** Viewer-side search: does the target appear? */
async function appearsInSearch(db, viewerId, targetId) {
  const rows = await asUser(db, viewerId, () =>
    db.query(
      `SELECT public.search_matches(
         p_looking_for => NULL::public.gender, p_min_age => NULL::integer, p_max_age => NULL::integer,
         p_city => NULL::text, p_sub_community => NULL::text, p_limit => 200,
         p_education => NULL::text, p_occupation => NULL::text, p_native_place => NULL::text,
         p_marital_status => NULL::public.marital_status, p_diet => NULL::public.diet,
         p_min_income => NULL::text, p_min_height => NULL::integer, p_max_height => NULL::integer,
         p_smoking => NULL::public.lifestyle_choice, p_drinking => NULL::public.lifestyle_choice
       ) AS r`
    )
  )
  const payload = rows.rows[0].r
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
  // search_matches() returns the card array itself.
  const list = Array.isArray(parsed) ? parsed : (parsed?.results ?? parsed?.rows ?? parsed?.matches ?? [])
  return list.some((row) => row.user_id === targetId)
}

export default async function membershipRevocationSuite(db) {
  const t = new Checks('membership-revocation')

  const rootAdmin = await member(db, { name: 'Revocation Admin', admin: true })
  const otherAdmin = await member(db, { name: 'Second Admin', admin: true })
  const viewer = await member(db, { name: 'Viewer Member', gender: 'female' })
  await activatePackage(db, viewer, 'smart-3-month')

  // =========================================================================
  console.log(' [1] authorization boundaries')
  // =========================================================================
  const target = await member(db, { name: 'Paid Target' })
  const paid = await paidMembership(db, target, 'premium-6-month')

  const errMember = await asUser(db, target, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, NULL)`, [rootAdmin, target]))
  )
  t.check('ordinary member cannot execute the RPC', /permission denied/i.test(errMember), errMember)

  const errOtherMember = await asUser(db, viewer, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, NULL)`, [rootAdmin, target]))
  )
  t.check('another ordinary member cannot execute the RPC', /permission denied/i.test(errOtherMember), errOtherMember)

  const errAnon = await asAnon(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, NULL)`, [rootAdmin, target]))
  )
  t.check('anonymous caller cannot execute the RPC', /permission denied/i.test(errAnon), errAnon)

  const errNoActor = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership(NULL, $1, 'refund', NULL, NULL)`, [target]))
  )
  t.check('service role cannot revoke without naming an admin', /ADMIN_ONLY/i.test(errNoActor), errNoActor)

  const errNonAdminActor = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, NULL)`, [viewer, target]))
  )
  t.check('service role cannot name a non-admin actor', /ADMIN_ONLY/i.test(errNonAdminActor), errNonAdminActor)

  const errGhost = await asService(db, () =>
    expectError(() =>
      db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, NULL)`,
        ['00000000-0000-0000-0000-000000000000', target])
    )
  )
  t.check('a fabricated admin id is refused', /ADMIN_ONLY/i.test(errGhost), errGhost)

  const errSelf = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $1, 'refund', NULL, NULL)`, [rootAdmin]))
  )
  t.check('admin cannot revoke their own membership here', /ADMIN_SELF_ACTION/i.test(errSelf), errSelf)

  const errNoReason = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, NULL, NULL, NULL)`, [rootAdmin, target]))
  )
  t.check('a reason is required', /REASON_REQUIRED/i.test(errNoReason), errNoReason)

  const errBadReason = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, 'because', NULL, NULL)`, [rootAdmin, target]))
  )
  t.check('an unknown reason is refused', /INVALID_REASON/i.test(errBadReason), errBadReason)

  const errGhostMember = await asService(db, () =>
    expectError(() =>
      db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, NULL)`,
        [rootAdmin, '11111111-1111-1111-1111-111111111111'])
    )
  )
  t.check('a non-existent member is refused', /MEMBER_NOT_FOUND/i.test(errGhostMember), errGhostMember)

  // Nothing above changed anything.
  t.equal('all denied attempts left the subscription active', (await subRow(db, paid.subscriptionId)).status, 'active')

  // =========================================================================
  console.log(' [2] admin revokes an active paid package (scenario C)')
  // =========================================================================
  t.equal('profile is public/active before revocation', await profileStatus(db, target), 'active')
  t.equal('member is paid before revocation', await scalar(db, `SELECT public.has_live_membership($1)`, [target]), true)
  t.check('target is discoverable in search before revocation', await appearsInSearch(db, viewer, target))

  const result = await revoke(db, rootAdmin, target, { reason: 'fraud', note: 'Chargeback risk — ticket 4471' })
  t.equal('revocation reports status revoked', result.status, 'revoked')
  t.equal('revocation reports changed', result.changed, true)
  t.equal('the revoked subscription is the paid one', result.subscription_id, paid.subscriptionId)
  t.equal('package slug reported', result.package_slug, 'premium-6-month')
  t.equal('tier reported', result.tier, 'premium')
  t.equal('previous status reported', result.previous_status, 'active')
  t.equal('new status reported', result.new_status, 'cancelled')
  t.equal('reason echoed', result.reason, 'fraud')

  const sub = await subRow(db, paid.subscriptionId)
  t.equal('subscription row is cancelled, not deleted', sub.status, 'cancelled')
  t.equal('subscription row still exists', sub.id, paid.subscriptionId)
  t.equal('member is no longer paid', await scalar(db, `SELECT public.has_live_membership($1)`, [target]), false)
  t.equal('profile left the directory (expired, like the sweep)', await profileStatus(db, target), 'expired')
  t.equal('is_profile_public() is false', await scalar(db, `SELECT public.is_profile_public($1)`, [target]), false)
  t.check('target is excluded from search after revocation', !(await appearsInSearch(db, viewer, target)))

  // Paid capabilities really are gone.
  t.equal('get_membership tier is free', (await asUser(db, target, () => one(db, `SELECT public.get_membership($1) AS m`, [target]))).m.tier, 'free')
  t.equal('has_benefit(express_interest) is false', await asUser(db, target, () => scalar(db, `SELECT public.has_benefit('express_interest', $1)`, [target])), false)
  const errInterest = await asUser(db, target, () =>
    expectError(() => db.query(`SELECT public.express_interest($1, 'still interested')`, [viewer]))
  )
  t.check('Express Interest is refused after revocation', /PAID_MEMBERSHIP_REQUIRED|BENEFIT/i.test(errInterest), errInterest)
  t.equal('advanced search benefit gone', await asUser(db, target, () => scalar(db, `SELECT public.has_benefit('advanced_search', $1)`, [target])), false)

  // =========================================================================
  console.log(' [3] the payment record is preserved byte-for-byte')
  // =========================================================================
  const before = await payRow(db, paid.payment.id)
  const after = await payRow(db, paid.payment.id)
  t.equal('payment row still exists', after.id, before.id)
  t.equal('payment status unchanged (still captured)', after.status, 'captured')
  t.equal('Razorpay order id preserved', after.razorpay_order_id, before.razorpay_order_id)
  t.equal('Razorpay payment id preserved', after.razorpay_payment_id, before.razorpay_payment_id)
  t.equal('payment amount preserved', after.amount_inr, before.amount_inr)
  t.equal('amount is the authoritative package price', after.amount_inr, paid.price)
  t.equal('currency preserved', after.currency, 'INR')
  t.equal('payment created_at preserved', String(after.created_at), String(before.created_at))
  t.equal('payment kind preserved', after.kind, 'package')
  t.equal('payment package_slug preserved', after.package_slug, 'premium-6-month')
  t.equal(
    'the payment was NOT marked refunded (revocation ≠ refund)',
    await scalar(db, `SELECT count(*)::int FROM public.payments WHERE id = $1 AND status = 'refunded'`, [paid.payment.id]),
    0
  )
  t.equal('no payment row was deleted', await scalar(db, `SELECT count(*)::int FROM public.payments WHERE user_id = $1`, [target]), 1)
  t.equal('payments.membership_started_at snapshot untouched',
    String(after.membership_started_at ?? null), String(before.membership_started_at ?? null))
  t.equal('payments.membership_expires_at snapshot untouched',
    String(after.membership_expires_at ?? null), String(before.membership_expires_at ?? null))
  t.check('the preserved membership snapshot still names the paid window',
    Boolean(after.membership_started_at) && Boolean(after.membership_expires_at), after)
  t.equal('payment package_id preserved', after.package_id, before.package_id)
  t.equal('payment metadata preserved', JSON.stringify(after.metadata), JSON.stringify(before.metadata))

  // =========================================================================
  console.log(' [4] audit + activity + notification')
  // =========================================================================
  const audit = await auditRows(db, target)
  t.equal('exactly one revocation audit row', audit.length, 1)
  t.equal('audit names the acting admin', audit[0].admin_id, rootAdmin)
  t.equal('audit target is the member', audit[0].target_id, target)
  t.equal('audit target_type is membership', audit[0].target_type, 'membership')
  const det = audit[0].details
  t.equal('audit records the subscription id', Number(det.subscription_id), paid.subscriptionId)
  t.equal('audit records the package id', Number(det.package_id), paid.packageId)
  t.equal('audit records the package slug', det.package_slug, 'premium-6-month')
  t.check('audit records the package name', typeof det.package_name === 'string' && det.package_name.length > 0, det.package_name)
  t.equal('audit records the previous state', det.previous_status, 'active')
  t.equal('audit records the new state', det.new_status, 'cancelled')
  t.equal('audit records the reason', det.reason, 'fraud')
  t.equal('audit records the admin note', det.note, 'Chargeback risk — ticket 4471')
  t.equal('audit preserves the payment id', det.payment_id, paid.payment.id)
  t.equal('audit preserves the Razorpay order id', det.razorpay_order_id, before.razorpay_order_id)
  t.equal('audit preserves the Razorpay payment id', det.razorpay_payment_id, before.razorpay_payment_id)
  t.equal('audit preserves the amount', det.amount_inr, before.amount_inr)
  t.equal('audit records the payment status as captured', det.payment_status, 'captured')
  t.check('audit has a timestamp', Boolean(audit[0].created_at))
  t.equal('audit says the payment was untouched', det.payment_untouched, true)
  t.equal('audit records live membership after', det.live_membership_after, false)
  t.equal('audit records profile status before', det.profile_status_before, 'active')
  t.equal('audit records profile status after', det.profile_status_after, 'expired')

  t.equal('one activity event written', await activityCount(db, target, 'admin_membership_revoked'), 1)
  const evMeta = await scalar(
    db,
    `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = 'admin_membership_revoked' ORDER BY id DESC LIMIT 1`,
    [target]
  )
  const meta = typeof evMeta === 'string' ? JSON.parse(evMeta) : evMeta
  t.equal('activity event names the subscription', Number(meta.subscription_id), paid.subscriptionId)
  t.check('activity event carries NO reason, note or admin id', !('reason' in meta) && !('note' in meta) && !('admin_id' in meta), meta)
  const voc = await scalar(db, `SELECT public.canonical_activity_events() AS v`)
  const vocParsed = typeof voc === 'string' ? JSON.parse(voc) : voc
  t.check('admin_membership_revoked is in the canonical vocabulary', vocParsed.includes('admin_membership_revoked'), vocParsed)
  t.check('mobile_otp_verified is in the canonical vocabulary', vocParsed.includes('mobile_otp_verified'))

  t.equal('the member was notified', await scalar(db, `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND title ILIKE '%revoked%'`, [target]), 1)

  // =========================================================================
  console.log(' [5] idempotency / replay')
  // =========================================================================
  const again = await revoke(db, rootAdmin, target, { reason: 'fraud' })
  t.equal('second call reports no active paid membership', again.status, 'no_active_paid_membership')
  t.equal('second call changed nothing', again.changed, false)
  t.equal('still exactly one audit row', (await auditRows(db, target)).length, 1)
  t.equal('still exactly one activity event', await activityCount(db, target, 'admin_membership_revoked'), 1)
  t.equal('payment still captured', (await payRow(db, paid.payment.id)).status, 'captured')

  const byIdAgain = await revoke(db, rootAdmin, target, { reason: 'fraud', subscriptionId: paid.subscriptionId })
  t.equal('replaying with the subscription id reports already_revoked', byIdAgain.status, 'already_revoked')
  t.equal('replaying with the subscription id changed nothing', byIdAgain.changed, false)

  // =========================================================================
  console.log(' [6] scenario B — Premium + Platinum: only Premium is revoked')
  // =========================================================================
  const combo = await member(db, { name: 'Combo Member', gender: 'female' })
  const platinumFirst = await claimPlatinum(db, combo)
  t.equal('first-100 Platinum granted', platinumFirst.grant_type, 'first_100')
  const platinumSubId = platinumFirst.subscription_id
  const comboPaid = await paidMembership(db, combo, 'vip-12-month')

  t.equal('two live subscriptions', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id=$1 AND status='active' AND expires_at > now()`, [combo]), 2)

  const comboResult = await revoke(db, rootAdmin, combo, { reason: 'refund', note: 'Refunded by bank transfer' })
  t.equal('the PAID VIP subscription was the one revoked', comboResult.subscription_id, comboPaid.subscriptionId)
  t.equal('VIP subscription cancelled', (await subRow(db, comboPaid.subscriptionId)).status, 'cancelled')
  t.equal('Platinum subscription is STILL ACTIVE', (await subRow(db, platinumSubId)).status, 'active')
  t.equal('member is still paid through Platinum', comboResult.live_membership_after, true)
  t.equal('has_live_membership stays true', await scalar(db, `SELECT public.has_live_membership($1)`, [combo]), true)
  t.equal('profile stays public', await profileStatus(db, combo), 'active')
  t.equal('is_profile_public stays true', await scalar(db, `SELECT public.is_profile_public($1)`, [combo]), true)
  t.check('still discoverable in search', await appearsInSearch(db, viewer, combo))
  t.equal('tier is now platinum', comboResult.membership.tier, 'platinum')
  t.equal('Express Interest still available via Platinum', await asUser(db, combo, () => scalar(db, `SELECT public.has_benefit('express_interest', $1)`, [combo])), true)
  t.equal('remaining entitlements lists the Platinum grant', comboResult.remaining_entitlements.length, 1)
  t.equal('remaining entitlement is flagged promotional', comboResult.remaining_entitlements[0].promotional, true)
  t.equal('VIP payment still captured', (await payRow(db, comboPaid.payment.id)).status, 'captured')
  t.equal('VIP Razorpay order id preserved', (await payRow(db, comboPaid.payment.id)).razorpay_order_id, comboPaid.payment.razorpay_order_id)
  t.equal('the Platinum claim ledger row is untouched',
    await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE user_id=$1`, [combo]), 1)

  // =========================================================================
  console.log(' [7] scenario F — Premium bought while Platinum is live')
  // =========================================================================
  const stacked = await member(db, { name: 'Stacked Member' })
  const stackedPlat = await claimPlatinum(db, stacked)
  const stackedPaid = await paidMembership(db, stacked, 'premium-6-month')
  const stackedResult = await revoke(db, rootAdmin, stacked, { reason: 'incorrect_activation' })
  t.equal('Premium revoked, not Platinum', stackedResult.subscription_id, stackedPaid.subscriptionId)
  t.equal('Platinum untouched', (await subRow(db, stackedPlat.subscription_id)).status, 'active')
  t.equal('Platinum expiry untouched',
    String((await subRow(db, stackedPlat.subscription_id)).expires_at),
    String((await subRow(db, stackedPlat.subscription_id)).expires_at))
  t.equal('member keeps paid access', stackedResult.live_membership_after, true)
  t.equal('profile stays active', await profileStatus(db, stacked), 'active')
  t.equal('no platinum_promotion_expired event was written', await activityCount(db, stacked, 'platinum_promotion_expired'), 0)

  // =========================================================================
  console.log(' [8] scenario D — Platinum only: there is nothing PAID to revoke')
  // =========================================================================
  const platOnly = await member(db, { name: 'Platinum Only', gender: 'female' })
  const platClaim = await claimPlatinum(db, platOnly)
  const platBefore = await subRow(db, platClaim.subscription_id)
  const platResult = await revoke(db, rootAdmin, platOnly, { reason: 'manual_correction' })
  t.equal('reports no active PAID membership', platResult.status, 'no_active_paid_membership')
  t.equal('changed nothing', platResult.changed, false)
  t.equal('flags that a promotional grant is live', platResult.promotional_live, true)
  const platAfter = await subRow(db, platClaim.subscription_id)
  t.equal('Platinum subscription still active', platAfter.status, 'active')
  t.equal('Platinum expiry unchanged', String(platAfter.expires_at), String(platBefore.expires_at))
  t.equal('Platinum claim ledger row still there', await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE user_id=$1`, [platOnly]), 1)
  t.equal('member still paid', await scalar(db, `SELECT public.has_live_membership($1)`, [platOnly]), true)
  t.equal('profile still public', await profileStatus(db, platOnly), 'active')
  t.equal('no audit row written for a no-op', (await auditRows(db, platOnly)).length, 0)
  t.equal('no activity event written for a no-op', await activityCount(db, platOnly, 'admin_membership_revoked'), 0)

  // Explicitly naming the promotional subscription is refused, not silently done.
  const errPromo = await asService(db, () =>
    expectError(() =>
      db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, $3)`, [rootAdmin, platOnly, platClaim.subscription_id])
    )
  )
  t.check('naming a promotional grant is refused', /PROMOTIONAL_ENTITLEMENT/i.test(errPromo), errPromo)
  t.equal('the refused attempt left Platinum active', (await subRow(db, platClaim.subscription_id)).status, 'active')

  // =========================================================================
  console.log(' [9] scenario A — 24-hour demo after the first 100 slots')
  // =========================================================================
  // Fill the launch slots so the next eligible member receives the demo.
  await db.query(`UPDATE public.platinum_launch_claims SET grant_type = 'first_100' WHERE grant_type IS DISTINCT FROM 'first_100'`)
  const claimsNow = await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE grant_type='first_100'`)
  const need = 100 - claimsNow
  if (need > 0) {
    // Seed the remaining slots directly in the ledger (service-role rights) —
    // the platinum-launch suite already proves the RPC allocates them one by
    // one; here we only need the "slots exhausted" state.
    const campaign = await scalar(db, `SELECT id FROM public.platinum_launch_campaigns WHERE campaign_key = 'FIRST_100_PLATINUM'`)
    for (let i = 0; i < need; i += 1) {
      const filler = await member(db, { name: `Slot Filler ${i}` })
      await db.query(
        `INSERT INTO public.platinum_launch_claims
           (campaign_id, user_id, grant_type, slot_number, package_slug, promotion, start_at, expiry_at)
         VALUES ($1, $2, 'first_100', $3, $4, 'first_100_platinum', now(), now() + interval '30 days')`,
        [campaign, filler, claimsNow + i + 1, FIRST100_SLUG]
      )
    }
  }
  t.equal('all 100 launch slots are claimed', await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE grant_type='first_100'`), 100)

  const demoMember = await member(db, { name: 'Demo Member', gender: 'female' })
  const demo = await claimPlatinum(db, demoMember)
  t.equal('the 101st member receives the 24-hour demo', demo.grant_type, 'demo_24h')
  t.equal('demo package slug', demo.package_slug, DEMO_SLUG)
  const demoResult = await revoke(db, rootAdmin, demoMember, { reason: 'other' })
  t.equal('nothing paid to revoke for a demo holder', demoResult.status, 'no_active_paid_membership')
  t.equal('demo subscription still active', (await subRow(db, demo.subscription_id)).status, 'active')
  t.equal('demo member still has paid capabilities', await scalar(db, `SELECT public.has_live_membership($1)`, [demoMember]), true)

  // =========================================================================
  console.log(' [10] scenario E — an expired Platinum grant changes nothing')
  // =========================================================================
  await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '1 hour' WHERE id = $1`, [demo.subscription_id])
  await asService(db, () => scalar(db, `SELECT public.sweep_expired_memberships() AS r`))
  t.equal('the sweep expired the demo subscription', (await subRow(db, demo.subscription_id)).status, 'expired')
  t.equal('the sweep hid the profile', await profileStatus(db, demoMember), 'expired')
  const afterExpiry = await revoke(db, rootAdmin, demoMember, { reason: 'other' })
  t.equal('revoking an already-expired member is a no-op', afterExpiry.status, 'no_active_paid_membership')
  t.equal('revoking an already-expired member changed nothing', afterExpiry.changed, false)

  // =========================================================================
  console.log(' [11] boosts and featured status are never collateral damage')
  // =========================================================================
  const boosted = await member(db, { name: 'Boosted Member', gender: 'female' })
  await paidMembership(db, boosted, 'smart-3-month')
  await db.query(`UPDATE public.profile_boost_config SET duration_days = 5, price_inr = 499, is_active = TRUE WHERE id = 1`)
  await asService(db, () => one(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [boosted, rootAdmin]))
  await db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 7)`, [boosted])
  const boostBefore = await one(db, `SELECT id, status, expires_at FROM public.profile_boosts WHERE user_id = $1`, [boosted])
  const featuredBefore = await one(db, `SELECT position FROM public.featured_profiles WHERE profile_id = $1`, [boosted])
  const entitlementsBefore = await scalar(db, `SELECT count(*)::int FROM public.profile_boost_entitlements WHERE user_id = $1`, [boosted])
  t.check('fixture: boost is live', boostBefore && boostBefore.status === 'active', boostBefore)

  const boostPaidSub = await scalar(
    db,
    `SELECT id FROM public.subscriptions WHERE user_id = $1 AND status = 'active' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`,
    [boosted]
  )
  const boostedResult = await revoke(db, rootAdmin, boosted, { reason: 'support_action' })
  t.equal('the paid subscription was revoked', Number(boostedResult.subscription_id), Number(boostPaidSub))
  const boostAfter = await one(db, `SELECT id, status, expires_at FROM public.profile_boosts WHERE user_id = $1`, [boosted])
  t.equal('boost row still exists', boostAfter.id, boostBefore.id)
  t.equal('boost status untouched', boostAfter.status, boostBefore.status)
  t.equal('boost expiry untouched', String(boostAfter.expires_at), String(boostBefore.expires_at))
  t.equal('boost entitlement rows untouched',
    await scalar(db, `SELECT count(*)::int FROM public.profile_boost_entitlements WHERE user_id = $1`, [boosted]),
    entitlementsBefore)
  t.check('there is at least one boost entitlement row to preserve', entitlementsBefore >= 1, entitlementsBefore)
  const featuredAfter = await one(db, `SELECT position FROM public.featured_profiles WHERE profile_id = $1`, [boosted])
  t.equal('featured row still exists', featuredAfter?.position, featuredBefore.position)
  t.equal('featured position not corrupted', featuredAfter.position, 7)

  // =========================================================================
  console.log(' [12] stacked paid renewals: revoking one never makes the member FREE')
  // =========================================================================
  const stacker = await member(db, { name: 'Stacked Paid' })
  const firstPlan = await paidMembership(db, stacker, 'smart-3-month')
  const secondPlan = await paidMembership(db, stacker, 'premium-6-month')
  t.equal('two live paid subscriptions (renewal stacking)',
    await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now()`, [stacker]), 2)
  const stack1 = await revoke(db, rootAdmin, stacker, { reason: 'refund' })
  t.equal('the longest-running paid plan was revoked first', stack1.subscription_id, secondPlan.subscriptionId)
  t.equal('the member is STILL paid', stack1.live_membership_after, true)
  t.equal('profile still public', await profileStatus(db, stacker), 'active')
  t.equal('the other paid subscription is untouched', (await subRow(db, firstPlan.subscriptionId)).status, 'active')
  t.equal('both payments still captured',
    await scalar(db, `SELECT count(*)::int FROM public.payments WHERE user_id=$1 AND status='captured'`, [stacker]), 2)
  const stack2 = await revoke(db, rootAdmin, stacker, { reason: 'refund' })
  t.equal('the remaining plan is revoked on the second call', stack2.subscription_id, firstPlan.subscriptionId)
  t.equal('now the member is free', stack2.live_membership_after, false)
  t.equal('profile left the directory', await profileStatus(db, stacker), 'expired')
  t.equal('both payments STILL captured after both revocations',
    await scalar(db, `SELECT count(*)::int FROM public.payments WHERE user_id=$1 AND status='captured'`, [stacker]), 2)
  t.equal('two audit rows', (await auditRows(db, stacker)).length, 2)
  t.equal('two activity events', await activityCount(db, stacker, 'admin_membership_revoked'), 2)

  // Explicitly targeting a subscription id works too.
  const explicit = await member(db, { name: 'Explicit Target' })
  const explicitPlan = await paidMembership(db, explicit, 'vip-12-month')
  const explicitResult = await revoke(db, rootAdmin, explicit, { reason: 'manual_correction', subscriptionId: explicitPlan.subscriptionId })
  t.equal('explicit subscription id honoured', explicitResult.subscription_id, explicitPlan.subscriptionId)
  const errWrongOwner = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_revoke_membership($1, $2, 'refund', NULL, $3)`, [rootAdmin, stacker, explicitPlan.subscriptionId]))
  )
  t.check("another member's subscription id is refused", /SUBSCRIPTION_NOT_FOUND/i.test(errWrongOwner), errWrongOwner)

  // =========================================================================
  console.log(' [13] a manual/admin activation (no payment) is revocable too')
  // =========================================================================
  const manual = await member(db, { name: 'Manual Activation', gender: 'female' })
  await activatePackage(db, manual, 'premium-6-month')
  const manualSub = await scalar(db, `SELECT id FROM public.subscriptions WHERE user_id=$1 AND status='active' ORDER BY id DESC LIMIT 1`, [manual])
  const manualResult = await revoke(db, rootAdmin, manual, { reason: 'incorrect_activation', note: 'Activated on the wrong account' })
  t.equal('manual activation revoked', manualResult.status, 'revoked')
  t.equal('no payment id involved', manualResult.payment_id, null)
  t.equal('subscription cancelled', (await subRow(db, manualSub)).status, 'cancelled')
  t.equal('member is free again', await scalar(db, `SELECT public.has_live_membership($1)`, [manual]), false)
  // jsonb_strip_nulls() drops absent keys, so a manual activation records no
  // payment id at all while still naming the subscription.
  const manualAudit = (await auditRows(db, manual))[0].details
  t.check('audit records no payment id for a manual activation', manualAudit.payment_id === undefined, manualAudit.payment_id)
  t.equal('audit still names the subscription', Number(manualAudit.subscription_id), Number(manualSub))
  t.equal('audit still records the previous/new state', `${manualAudit.previous_status}->${manualAudit.new_status}`, 'active->cancelled')

  // =========================================================================
  console.log(' [14] user and profile data survive revocation')
  // =========================================================================
  t.equal('profile row still exists', await scalar(db, `SELECT count(*)::int FROM public.profiles WHERE id=$1`, [target]), 1)
  t.equal('matrimony profile still exists', await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE user_id=$1`, [target]), 1)
  t.equal('photos untouched', await scalar(db, `SELECT count(*)::int FROM public.profile_photos WHERE profile_id=$1`, [target]), 2)
  t.equal('account still active', await scalar(db, `SELECT is_active FROM public.profiles WHERE id=$1`, [target]), true)
  t.equal('auth user still exists', await scalar(db, `SELECT count(*)::int FROM auth.users WHERE id=$1`, [target]), 1)
  t.equal('biodata source data intact', await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE user_id=$1 AND city IS NOT NULL`, [target]), 1)
  t.equal('subscription history retained', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id=$1`, [target]), 1)
  t.equal('payment history retained', await scalar(db, `SELECT count(*)::int FROM public.payments WHERE user_id=$1`, [target]), 1)
  t.equal('mobile_verified protection intact', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [target]), false)
  const errAdminFlag = await asUser(db, target, () =>
    expectError(() => db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [target]))
  )
  t.check('is_admin is still not client-writable', /CANNOT_MODIFY_ADMIN_ROLE|PROTECTED_ACCOUNT_STATE|permission denied/i.test(errAdminFlag), errAdminFlag)
  t.equal('is_admin is still false', await scalar(db, `SELECT is_admin FROM public.profiles WHERE id = $1`, [target]), false)

  // =========================================================================
  console.log(' [15] client payload manipulation cannot forge a revocation')
  // =========================================================================
  const forgeryTarget = await member(db, { name: 'Forgery Target' })
  const forgeryPaid = await paidMembership(db, forgeryTarget, 'premium-6-month')

  // A member cannot reach the RPC at all, whatever payload they invent.
  const forgeries = [
    [`UPDATE public.subscriptions SET status='cancelled' WHERE id = $1`, [forgeryPaid.subscriptionId], /permission denied/i],
    [`UPDATE public.payments SET status='refunded' WHERE id = $1`, [forgeryPaid.payment.id], /permission denied/i],
    [`DELETE FROM public.subscriptions WHERE id = $1`, [forgeryPaid.subscriptionId], /permission denied/i],
    [`DELETE FROM public.payments WHERE id = $1`, [forgeryPaid.payment.id], /permission denied/i],
  ]
  for (const [sql, params, pattern] of forgeries) {
    const err = await asUser(db, forgeryTarget, () => expectError(() => db.query(sql, params)))
    t.check(`member forgery blocked: ${sql.slice(0, 46)}…`, pattern.test(err), err)
  }
  t.equal('forgery attempts left the subscription active', (await subRow(db, forgeryPaid.subscriptionId)).status, 'active')

  // A revoked member cannot re-publish themselves: the publish-gate trigger
  // forces the truthful non-public status even if the row write is attempted.
  const revokedSelf = await member(db, { name: 'Revoked Self-Helper' })
  const revokedPlan = await paidMembership(db, revokedSelf, 'smart-3-month')
  await revoke(db, rootAdmin, revokedSelf, { reason: 'other' })
  t.equal('revoked member profile is expired', await profileStatus(db, revokedSelf), 'expired')
  await asUser(db, revokedSelf, () =>
    db.query(`UPDATE public.matrimony_profiles SET status = 'active' WHERE user_id = $1`, [revokedSelf])
  )
  t.check(
    'a revoked member cannot re-publish themselves',
    (await profileStatus(db, revokedSelf)) !== 'active',
    await profileStatus(db, revokedSelf)
  )
  t.equal('a revoked member is still not public', await scalar(db, `SELECT public.is_profile_public($1)`, [revokedSelf]), false)
  t.equal('a revoked member cannot resurrect the subscription row',
    (await subRow(db, revokedPlan.subscriptionId)).status, 'cancelled')
  t.equal('forgery attempts left the payment captured', (await payRow(db, forgeryPaid.payment.id)).status, 'captured')
  t.equal('forgery attempts wrote no audit row', (await auditRows(db, forgeryTarget)).length, 0)

  // A member also cannot flip their own mobile_verified to look verified.
  const errVerified = await asUser(db, forgeryTarget, () =>
    expectError(() => db.query(`UPDATE public.profiles SET mobile_verified = TRUE WHERE id = $1`, [forgeryTarget]))
  )
  t.check(
    'existing verified/mobile_verified protection intact',
    /PROTECTED_ACCOUNT_STATE|CANNOT_MODIFY_VERIFICATION_STATUS/i.test(errVerified),
    errVerified
  )
  t.equal('mobile_verified is still false after the forgery attempt',
    await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id = $1`, [forgeryTarget]), false)

  // =========================================================================
  console.log(' [16] migration hygiene')
  // =========================================================================
  const fn = await one(
    db,
    `SELECT p.oid, p.prosecdef, p.proconfig,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
            has_function_privilege('anon', p.oid, 'EXECUTE')            AS anon_exec,
            has_function_privilege('service_role', p.oid, 'EXECUTE')     AS svc_exec
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_revoke_membership'`
  )
  t.check('admin_revoke_membership exists', Boolean(fn?.oid), fn)
  t.check('is SECURITY DEFINER', fn.prosecdef === true)
  t.check('pins search_path', (fn.proconfig ?? []).some((c) => c.startsWith('search_path=')), fn.proconfig)
  t.check('not executable by authenticated', fn.auth_exec === false)
  t.check('not executable by anon', fn.anon_exec === false)
  t.check('executable by service_role', fn.svc_exec === true)
  t.equal('exactly one definition (no overloads)', await scalar(
    db,
    `SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_revoke_membership'`
  ), 1)
  const src = await scalar(db, `SELECT prosrc FROM pg_proc WHERE oid = $1`, [fn.oid])
  t.check('authorises through admin_assert_actor', /admin_assert_actor\(p_admin_id\)/.test(src))
  t.check('takes the shared membership advisory lock', /pg_advisory_xact_lock\(hashtext\('membership:'/.test(src))
  t.check('never writes to the payments table', !/UPDATE public\.payments|DELETE FROM public\.payments|INSERT INTO public\.payments/i.test(src))
  t.check('never touches boosts', !/profile_boost/i.test(src.replace(/has_active_boost/g, '')))
  t.check('never touches featured rows', !/UPDATE public\.featured_profiles|DELETE FROM public\.featured_profiles/i.test(src))
  t.check('no hard-coded admin email or user id', !/[\w.+-]+@[\w-]+\.[\w.]+/.test(src) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i.test(src))

  // The other admin RPCs still share one authoritative check.
  const adminRpcs = (
    await db.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname IN
          ('admin_revoke_membership','admin_set_profile_suspended','admin_set_profile_hidden',
           'admin_reactivate_profile','admin_approve_profile','admin_reject_profile',
           'admin_update_member_profile','admin_prepare_member_deletion')`
    )
  ).rows.map((r) => r.proname)
  for (const name of adminRpcs) {
    const body = await scalar(db, `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`, [name])
    t.check(`${name} authorises with the shared admin check`, /admin_assert_actor\(/.test(body))
  }

  // Pricing untouched.
  const prices = (await db.query(`SELECT slug, price_inr, duration_days FROM public.packages WHERE is_active ORDER BY price_inr`)).rows
  t.equal('Smart stays ₹999 / 90 days', prices.find((p) => p.slug === 'smart-3-month'), { slug: 'smart-3-month', price_inr: 999, duration_days: 90 })
  t.equal('Premium stays ₹2,499 / 180 days', prices.find((p) => p.slug === 'premium-6-month'), { slug: 'premium-6-month', price_inr: 2499, duration_days: 180 })
  t.equal('VIP stays ₹4,999 / 365 days', prices.find((p) => p.slug === 'vip-12-month'), { slug: 'vip-12-month', price_inr: 4999, duration_days: 365 })
  t.equal('no VIP row reverted to ₹5,999', await scalar(db, `SELECT count(*)::int FROM public.packages WHERE price_inr = 5999`), 0)

  // =========================================================================
  console.log(' [17] server-action + admin UI hygiene')
  // =========================================================================
  // Next.js rejects a `'use server'` module that exports anything other than an
  // async function — `next build` fails at "Collecting page data". The reason
  // list this feature needs in BOTH the action and the page therefore lives in
  // the plain `@/lib/admin/members` module. Guard it repo-wide so no future
  // admin action re-introduces the build break.
  const serverFiles = walk(join(repoRoot, 'src')).filter((f) => /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')))
  t.check('the revocation action lives in a `use server` module', serverFiles.some((f) => f.endsWith('src/app/admin/actions.ts')))
  for (const file of serverFiles) {
    const body = readFileSync(file, 'utf8')
    const bad = body
      .split('\n')
      .filter((line) => /^export\s+(?!async\s+function|type\b|interface\b)/.test(line))
      .filter((line) => !/^export\s+async\s+function/.test(line))
    t.equal(`\`use server\` module exports only async functions: ${relative(repoRoot, file)}`, bad, [])
  }

  const reasonsLib = read('src/lib/admin/members.ts')
  const actions = read('src/app/admin/actions.ts')
  const memberPage = read('src/app/admin/members/[id]/page.tsx')

  t.check('the selectable revocation reasons live in the shared (non-use-server) admin module', /export const REVOCATION_REASONS = \[/.test(reasonsLib))
  t.check('…and cover every reason the task requires', ['refund', 'fraud', 'incorrect_activation', 'support_action', 'manual_correction', 'other']
    .every((v) => new RegExp(`value: '${v}'`).test(reasonsLib)))
  t.check('the reasons module is NOT a `use server` file', !/^\s*['"]use server['"]/m.test(reasonsLib))
  t.check('the action validates the reason before calling the RPC', /if \(!isRevocationReason\(reason\)\)/.test(actions))
  t.check('a missing reason is refused with REASON_REQUIRED', /REASON_REQUIRED/.test(actions))
  // The database owns the authoritative reason list; the app's list must be a
  // faithful copy of it (a drift either way is a real bug: an admin could pick
  // a reason the RPC rejects, or the RPC could accept one the UI never offers).
  t.check('the database re-validates the reason too (the UI list is not the authority)', /v_reason = ANY \(c_reasons\)/.test(src) && /INVALID_REASON/.test(src) && /REASON_REQUIRED/.test(src))
  const migrationSrc = read('supabase/migrations/20260921020000_admin_revoke_membership.sql')
  const arrayBody = /c_reasons TEXT\[\] := ARRAY\[([\s\S]*?)\];/.exec(migrationSrc)?.[1] ?? ''
  const dbReasons = [...arrayBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  const appReasons = [...reasonsLib.slice(reasonsLib.indexOf('export const REVOCATION_REASONS'))
    .matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]).sort()
  t.check('the migration really declares a reason allow-list', dbReasons.length === 6, dbReasons)
  t.equal('the app\'s reason list is EXACTLY the database allow-list', appReasons, dbReasons)

  t.check('revokeMembership is an exported async server action', /export async function revokeMembership\(/.test(actions))
  t.check('…and it authorises through the shared admin gate', /requireAdminAction\(\)/.test(actions))
  t.check('…and calls the RPC with the acting admin id', /p_admin_id: ctx\.userId/.test(actions))
  t.check('…through the service-role client, never a member client', /ctx\.admin\.rpc\('admin_revoke_membership'/.test(actions))
  t.check('an idempotent replay is reported honestly, not as a new revocation', /already_revoked/.test(actions) && /no_active_paid_membership/.test(actions))
  t.check('a promotional-only member is told the Platinum grant is left untouched', /free Platinum launch grant, which is left untouched/.test(actions))

  t.check('the member detail page imports the reasons from the shared module', /REVOCATION_REASONS,\n[^}]*\} from '@\/lib\/admin\/members'/.test(memberPage))
  t.check('the page renders the revocation action', /revokeMembership/.test(memberPage))
  // Scoped to the revocation form itself: other admin forms on the same page
  // have their own (required) note fields, so a whole-file regex would lie.
  const formAt = memberPage.indexOf('action={revokeMembership}')
  t.check('the member detail page has a revocation form wired to the action', formAt > 0)
  const revokeForm = memberPage.slice(formAt, memberPage.indexOf('</form>', formAt))

  t.check('the reason field is a REQUIRED select', /<select name="reason" required/.test(revokeForm))
  t.check('the reason select has no silent default (empty option is disabled)', /<option value="" disabled>/.test(revokeForm))
  t.check('the reason options are rendered from the shared list', /REVOCATION_REASONS\.map/.test(revokeForm))
  t.check('the admin note field is present', /name="note"/.test(revokeForm))
  t.check('the admin note field is OPTIONAL', !/name="note"[\s\S]{0,200}?required/.test(revokeForm))
  t.check('the note is labelled audit-log-only and never shown to the member', /never shown to the member/.test(revokeForm))
  t.check('the admin must confirm before it runs', /<ConfirmButton/.test(revokeForm))
  t.check('the confirmation says the payment record is NOT deleted', /payment record will NOT be deleted/.test(revokeForm))
  t.check('the confirmation names the preserved Razorpay identifiers and amount', /Razorpay order id, payment id and amount/.test(revokeForm))
  t.check('the confirmation says this is NOT a refund and points at Admin → Payments', /This is not a refund/.test(revokeForm) && /\/admin\/payments/.test(revokeForm))
  t.check('the confirmation warns the profile leaves the directory', /leaves Browse, Search, matches and Express Interest/.test(revokeForm))
  t.check('the confirmation admits when another entitlement keeps the member paid', /keepsAccessAfterRevocation/.test(revokeForm))
  t.check('the form discloses a free Platinum launch grant that is NOT revoked', /it is NOT revoked/.test(revokeForm))
  t.check('the admin can pick WHICH entitlement when several are live', /<select name="subscription_id"/.test(revokeForm) && /revocableSubs\.length > 1/.test(revokeForm))
  // Both hidden fields are mandatory for the action to run at all: user_id is
  // what requireUuid() validates and what the RPC is authorised against, and
  // return_to is where memberAction() redirects the ok/error notice. A form
  // missing either one throws "Invalid member" before reaching the database.
  t.check('the form posts the member id (requireUuid would otherwise refuse)', /<input type="hidden" name="user_id" value=\{person\.id\} \/>/.test(revokeForm))
  t.check('the form posts return_to so the notice redirects like every other admin action', /<input type="hidden" name="return_to" value=\{returnTo\} \/>/.test(revokeForm))

  // The browser must never reach the RPC itself.
  const clientFiles = walk(join(repoRoot, 'src')).filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')))
  t.check('client components were scanned', clientFiles.length > 5)
  for (const file of clientFiles) {
    t.equal(`no client component calls admin_revoke_membership: ${relative(repoRoot, file)}`,
      /admin_revoke_membership/.test(readFileSync(file, 'utf8')), false)
  }
  t.check('the browser never holds a service-role key', clientFiles.every((f) => !/SUPABASE_SERVICE_ROLE_KEY|createAdminClient/.test(readFileSync(f, 'utf8'))))

  return t
}
