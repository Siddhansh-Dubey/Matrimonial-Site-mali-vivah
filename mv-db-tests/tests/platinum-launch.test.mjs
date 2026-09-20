// Platinum Launch Offer — first-100 30-day grants + 24-hour demo.
//
// Covers the required scenarios end-to-end against the real migration chain:
//   FIRST-100  1-10 · DEMO 11-20 · RESET 21-27
//
// Concurrency note (scenario 7): PGlite runs ONE connection, so two truly
// parallel transactions cannot be opened here. The anti-race guarantees are
// therefore asserted the way the database enforces them: (a) the claim RPC
// provably serialises (per-member advisory lock + campaign row FOR UPDATE —
// checked against pg_get_functiondef), and (b) the ledger's UNIQUE indexes
// reject a duplicate member claim and a duplicate slot even when written
// directly with full service-role rights. Together these make "both callers
// receive slot 100" impossible at the storage layer, which is exactly where
// the invariant lives.
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

const CAMPAIGN_KEY = 'FIRST_100_PLATINUM'
const FIRST100_SLUG = 'platinum-launch-30d'
const DEMO_SLUG = 'platinum-demo-24h'

async function asAnon(db, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);
                 SELECT set_config('request.jwt.claim.role', 'anon', false);
                 SET ROLE anon;`)
  try {
    return await fn()
  } finally {
    try { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false)`) } catch { /* aborted */ }
  }
}

/** Member-session claim (the exact RPC the wizard/dashboard call). */
function claim(db, userId) {
  return asUser(db, userId, () => one(db, 'SELECT public.claim_platinum_launch_offer() AS r')).then((r) => r.r)
}

/** Member-session read of the launch state. */
function readState(db, userId) {
  return asUser(db, userId, () => one(db, 'SELECT public.get_my_platinum_launch() AS r')).then((r) => r.r)
}

async function claimedFirst100(db) {
  return scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE grant_type = 'first_100'`)
}

async function claimCount(db) {
  return scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims`)
}

async function promoSubCount(db) {
  return scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE package_slug IN ($1, $2)`, [FIRST100_SLUG, DEMO_SLUG])
}

async function paidSubCount(db) {
  return scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE package_slug NOT IN ($1, $2)`, [FIRST100_SLUG, DEMO_SLUG])
}

async function activityCount(db, userId, event) {
  return scalar(db, `SELECT count(*)::int FROM public.activity_events WHERE user_id = $1 AND event = $2`, [userId, event])
}

async function membership(db, userId) {
  return asUser(db, userId, () => one(db, `SELECT public.get_membership($1) AS m`, [userId])).then((r) => r.m)
}

let seq = 0
async function newCompleteMember(db, { gender = 'male', prefix = 'pl' } = {}) {
  seq += 1
  const id = await signUp(db, {
    email: `${prefix}-${seq}-${Date.now().toString(36)}@example.com`,
    name: `${prefix} member ${seq}`,
    mobile: `92000${String(seq).padStart(5, '0')}`,
  })
  await completeProfile(db, id, { gender })
  return id
}

export default async function platinumLaunchSuite(db) {
  const t = new Checks('platinum-launch')

  // ==========================================================================
  console.log(' [A] campaign + package authority (no user counting anywhere)')
  // ==========================================================================
  const campaign = await one(db, `SELECT * FROM public.platinum_launch_campaigns WHERE campaign_key = $1`, [CAMPAIGN_KEY])
  t.check('campaign FIRST_100_PLATINUM is seeded', Boolean(campaign), campaign)
  t.equal('campaign total_slots is 100', campaign?.total_slots, 100)
  t.equal('campaign is enabled', campaign?.enabled, true)
  t.check('campaign has created_at + updated_at', Boolean(campaign?.created_at && campaign?.updated_at))
  t.equal('claim ledger starts EMPTY (0/100 claimed)', await claimCount(db), 0)

  const p30 = await one(db, `SELECT id, slug, price_inr, duration_days, tier::text, is_active FROM public.packages WHERE slug = $1`, [FIRST100_SLUG])
  const p24 = await one(db, `SELECT id, slug, price_inr, duration_days, tier::text, is_active FROM public.packages WHERE slug = $1`, [DEMO_SLUG])
  t.check('30-day promotional package exists', Boolean(p30), p30)
  t.check('24-hour promotional package exists', Boolean(p24), p24)
  t.equal('30-day package duration', p30?.duration_days, 30)
  t.equal('demo package duration is 1 day (24h)', p24?.duration_days, 1)
  t.equal('promotional packages cost 0', [p30?.price_inr, p24?.price_inr], [0, 0])
  t.equal('promotional packages are NOT purchasable (is_active false)', [p30?.is_active, p24?.is_active], [false, false])
  t.equal('promotional packages carry tier platinum', [p30?.tier, p24?.tier], ['platinum', 'platinum'])

  // Paid price list must be untouched (scenario: no price changes, no ₹5,999).
  const smart = await one(db, `SELECT price_inr, duration_days, is_active FROM public.packages WHERE slug = 'smart-3-month'`)
  const premium = await one(db, `SELECT price_inr, duration_days, is_active FROM public.packages WHERE slug = 'premium-6-month'`)
  const vip = await one(db, `SELECT price_inr, duration_days, is_active FROM public.packages WHERE slug = 'vip-12-month'`)
  t.equal('Smart stays ₹999/90 active', [smart?.price_inr, smart?.duration_days, smart?.is_active], [999, 90, true])
  t.equal('Premium stays ₹2,499/180 active', [premium?.price_inr, premium?.duration_days, premium?.is_active], [2499, 180, true])
  t.equal('VIP stays ₹4,999/365 active (never ₹5,999)', [vip?.price_inr, vip?.duration_days, vip?.is_active], [4999, 365, true])
  t.check('the shop never lists the promotional packages', await scalar(db, `SELECT count(*)::int FROM public.packages WHERE is_active AND slug IN ($1, $2)`, [FIRST100_SLUG, DEMO_SLUG]) === 0)

  const vocabulary = await scalar(db, `SELECT public.canonical_activity_events() @> ARRAY['platinum_first_100_granted','platinum_demo_24h_granted','platinum_promotion_expired']`)
  t.equal('the three promotional events are canonical activity names', vocabulary, true)

  // ==========================================================================
  console.log(' [B] eligibility is server-decided (incomplete / restricted accounts)')
  // ==========================================================================
  const incomplete = await signUp(db, { email: 'pl-incomplete@example.com', name: 'In Complete', mobile: '9200090001' })
  const incResult = await claim(db, incomplete)
  t.equal('bare registration does NOT grant Platinum', incResult.status, 'not_eligible')
  t.equal('reason is the incomplete profile', incResult.reason, 'profile_incomplete')
  t.check('the server lists what is missing', Array.isArray(incResult.missing) && incResult.missing.length > 0, incResult.missing)
  t.equal('no claim row is written for an ineligible attempt', await claimCount(db), 0)

  await completeProfile(db, incomplete)
  // Remove the family photo again → the canonical publish-gate definition
  // (admin_profile_missing) must refuse the demo too.
  await db.query(`DELETE FROM public.profile_photos WHERE profile_id = $1 AND kind = 'family_photo'`, [incomplete])
  const noFamily = await claim(db, incomplete)
  t.equal('missing family photo blocks the grant', noFamily.status, 'not_eligible')
  t.check('family photo is named as missing', (noFamily.missing ?? []).includes('family photo'), noFamily.missing)

  // Suspended member: existing admin rules stay authoritative.
  const suspendedUser = await newCompleteMember(db, { prefix: 'pl-susp' })
  await db.query(`UPDATE public.matrimony_profiles SET status = 'suspended' WHERE user_id = $1`, [suspendedUser])
  const suspResult = await claim(db, suspendedUser)
  t.equal('suspended profile cannot claim', suspResult.status, 'not_eligible')
  t.equal('suspended reason', suspResult.reason, 'admin_restricted')

  // Admin hold blocks too, and no slot is wasted.
  const heldUser = await newCompleteMember(db, { prefix: 'pl-hold' })
  await db.query(`UPDATE public.matrimony_profiles SET admin_hidden_at = now() WHERE user_id = $1`, [heldUser])
  const heldResult = await claim(db, heldUser)
  t.equal('admin-held profile cannot claim', heldResult.status, 'not_eligible')
  t.equal('no slot consumed by blocked accounts', await claimedFirst100(db), 0)

  // Deactivated account.
  const offUser = await newCompleteMember(db, { prefix: 'pl-off' })
  await db.query(`UPDATE public.profiles SET is_active = FALSE WHERE id = $1`, [offUser])
  const offResult = await claim(db, offUser)
  t.equal('deactivated account cannot claim', offResult.status, 'not_eligible')
  t.equal('deactivated reason', offResult.reason, 'account_inactive')

  // Campaign switch (admin) stops everything; ledger untouched.
  await db.query(`UPDATE public.platinum_launch_campaigns SET enabled = FALSE WHERE campaign_key = $1`, [CAMPAIGN_KEY])
  const gateUser = await newCompleteMember(db, { prefix: 'pl-gate' })
  const disabledResult = await claim(db, gateUser)
  t.equal('disabled campaign grants nothing', disabledResult.status, 'campaign_disabled')
  t.equal('disabled campaign writes no claim', await claimCount(db), 0)
  await db.query(`UPDATE public.platinum_launch_campaigns SET enabled = TRUE WHERE campaign_key = $1`, [CAMPAIGN_KEY])

  // Unauthenticated / anon callers.
  const anonClaim = await asAnon(db, () => expectError(() => db.query('SELECT public.claim_platinum_launch_offer()')))
  t.check('anon cannot execute the claim RPC', /permission denied/i.test(anonClaim), anonClaim)

  // ==========================================================================
  console.log(' [C] scenarios 1-3: first eligible users get the 30-day Platinum grant')
  // ==========================================================================
  const first = await newCompleteMember(db, { gender: 'female', prefix: 'pl-first' })
  const r1 = await claim(db, first)
  t.equal('1st eligible user: granted', r1.status, 'granted')
  t.equal('1st eligible user: first_100 grant type', r1.grant_type, 'first_100')
  t.equal('1st eligible user: slot 1', r1.slot_number, 1)
  t.equal('1st eligible user: promotion marker', r1.promotion, 'first_100_platinum')
  t.equal('1st eligible user: 30-day package', r1.package_slug, FIRST100_SLUG)
  const r1start = new Date(r1.started_at).getTime()
  const r1exp = new Date(r1.expires_at).getTime()
  t.equal('30-day window is exactly 30 days (server-generated)', Math.round((r1exp - r1start) / 86400000), 30)
  t.check('grant started server-side "now"', Math.abs(r1start - Date.now()) < 60_000, r1.started_at)

  // The entitlement is an ordinary subscription row — the existing mechanism.
  const sub1 = await one(db, `SELECT * FROM public.subscriptions WHERE id = $1`, [r1.subscription_id])
  t.equal('subscription belongs to the member', sub1?.user_id, first)
  t.equal('subscription is active', sub1?.status, 'active')
  t.equal('subscription has NO payment (not a purchase)', sub1?.payment_id, null)
  t.equal('subscription uses the promotional package', sub1?.package_slug, FIRST100_SLUG)
  t.equal('exactly one subscription for the member', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [first]), 1)

  // Membership architecture integration: every existing gate honours it.
  const m1 = await membership(db, first)
  t.equal('get_membership tier is platinum', m1.tier, 'platinum')
  t.equal('get_membership reports a live membership', m1.is_paid, true)
  t.equal('benefit: profile_visible', await asUser(db, first, () => scalar(db, `SELECT public.has_benefit('profile_visible', $1)`, [first])), true)
  t.equal('benefit: appear_in_search', await asUser(db, first, () => scalar(db, `SELECT public.has_benefit('appear_in_search', $1)`, [first])), true)
  t.equal('benefit: express_interest', await asUser(db, first, () => scalar(db, `SELECT public.has_benefit('express_interest', $1)`, [first])), true)
  t.equal('benefit: advanced_search', await asUser(db, first, () => scalar(db, `SELECT public.has_benefit('advanced_search', $1)`, [first])), true)
  t.equal('benefit: who_viewed_me', await asUser(db, first, () => scalar(db, `SELECT public.has_benefit('who_viewed_me', $1)`, [first])), true)
  t.equal('has_live_membership sees the promotional grant', await scalar(db, `SELECT public.has_live_membership($1)`, [first]), true)
  t.equal('profile went live through the existing publish transition', await scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [first]), 'active')
  t.equal('is_profile_public is TRUE for the Platinum member', await scalar(db, `SELECT public.is_profile_public($1)`, [first]), true)

  // Analytics + notifications: promotional, never a payment.
  t.equal('platinum_first_100_granted logged once', await activityCount(db, first, 'platinum_first_100_granted'), 1)
  t.equal('no payment_captured event for the grant', await activityCount(db, first, 'payment_captured'), 0)
  t.equal('no membership_activated event for the grant', await activityCount(db, first, 'membership_activated'), 0)
  t.equal('no payment_received notification', await scalar(db, `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND type = 'payment_received'`, [first]), 0)
  t.check('a promo-worded notification exists', await scalar(db, `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND type = 'admin_message'`, [first]) >= 1)
  const evt = await one(db, `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = 'platinum_first_100_granted'`, [first])
  t.equal('event metadata marks source=launch_promotion', evt?.metadata?.source, 'launch_promotion')
  t.equal('event metadata marks the promotion', evt?.metadata?.promotion, 'first_100_platinum')

  // Ledger row shape.
  const c1 = await one(db, `SELECT * FROM public.platinum_launch_claims WHERE user_id = $1`, [first])
  t.equal('ledger records the campaign', c1?.campaign_id, campaign.id)
  t.equal('ledger records the grant type', c1?.grant_type, 'first_100')
  t.equal('ledger records the subscription it created', c1?.subscription_id, r1.subscription_id)
  t.equal('ledger source marker', c1?.source, 'launch_promotion')
  t.check('ledger stores server-generated start/expiry', Boolean(c1?.start_at && c1?.expiry_at))

  // Scenario 2 + 3: users 2..100 (99th and 100th explicitly asserted).
  let slot99 = null
  let slot100 = null
  for (let i = 2; i <= 100; i += 1) {
    const u = await newCompleteMember(db, { gender: i % 2 ? 'male' : 'female', prefix: 'pl-fill' })
    const r = await claim(db, u)
    if (r.status !== 'granted' || r.grant_type !== 'first_100' || r.slot_number !== i) {
      t.check(`fill user ${i} gets first_100 slot ${i}`, false, r)
      break
    }
    if (i === 99) slot99 = r
    if (i === 100) slot100 = r
  }
  t.equal('99th eligible user got the 30-day grant in slot 99', slot99?.slot_number, 99)
  t.equal('100th eligible user got the 30-day grant in slot 100', slot100?.slot_number, 100)
  t.equal('exactly 100 first-100 claims exist', await claimedFirst100(db), 100)
  t.equal('slots are unique 1..100 with no gaps', await scalar(db, `SELECT count(DISTINCT slot_number)::int FROM public.platinum_launch_claims WHERE grant_type = 'first_100'`), 100)
  t.equal('slot bounds', await one(db, `SELECT min(slot_number) AS lo, max(slot_number) AS hi FROM public.platinum_launch_claims`), { lo: 1, hi: 100 })

  // ==========================================================================
  console.log(' [D] scenario 6: pre-existing test accounts never consume slots')
  // ==========================================================================
  // (The 100 slots above went to campaign claims only — the database already
  // holds extra signed-up accounts from section [B] that never claimed, plus
  // every profile the earlier sections created. The ledger, not a COUNT(*) of
  // users, is the counter.)
  const totalUsers = await scalar(db, `SELECT count(*)::int FROM public.profiles`)
  t.check('more accounts exist than slots, yet exactly 100 claims were made', totalUsers > 100, { totalUsers })
  t.equal('first-100 claims still exactly 100', await claimedFirst100(db), 100)
  const paidTester = await newCompleteMember(db, { prefix: 'pl-paid-tester' })
  await activatePackage(db, paidTester, 'vip-12-month')
  t.equal('a pre-existing paid test account changed nothing', await claimedFirst100(db), 100)

  // ==========================================================================
  console.log(' [E] scenarios 4-5 + 11: after exhaustion, completed profiles get exactly one 24h demo')
  // ==========================================================================
  const demo1 = await newCompleteMember(db, { gender: 'female', prefix: 'pl-demo1' })
  const d1 = await claim(db, demo1)
  t.equal('101st eligible user does NOT get first-100', d1.grant_type, 'demo_24h')
  t.equal('101st eligible user gets the 24-hour demo', d1.status, 'granted')
  t.equal('demo promotion marker', d1.promotion, 'platinum_24h_demo')
  t.equal('demo package slug', d1.package_slug, DEMO_SLUG)
  t.equal('demo carries no slot number', d1.slot_number, null)
  t.equal('first-100 ledger stays at 100 (demos consume no slot)', await claimedFirst100(db), 100)
  const d1start = new Date(d1.started_at).getTime()
  const d1exp = new Date(d1.expires_at).getTime()
  t.equal('demo lasts exactly 24 hours (server-generated)', d1exp - d1start, 86_400_000)
  const subD1 = await one(db, `SELECT * FROM public.subscriptions WHERE id = $1`, [d1.subscription_id])
  t.equal('demo subscription has NO payment', subD1?.payment_id, null)
  t.equal('demo subscription active', subD1?.status, 'active')
  t.equal('platinum_demo_24h_granted logged once', await activityCount(db, demo1, 'platinum_demo_24h_granted'), 1)
  t.equal('demo member has a live membership', await scalar(db, `SELECT public.has_live_membership($1)`, [demo1]), true)
  t.equal('demo member profile went live', await scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [demo1]), 'active')
  t.equal('demo member is publicly visible', await scalar(db, `SELECT public.is_profile_public($1)`, [demo1]), true)
  const md1 = await membership(db, demo1)
  t.equal('demo membership tier is platinum', md1.tier, 'platinum')

  // Scenario 11: another post-campaign user also gets exactly one demo.
  const demo2 = await newCompleteMember(db, { prefix: 'pl-demo2' })
  const d2 = await claim(db, demo2)
  t.equal('next completed user also gets one demo', [d2.status, d2.grant_type], ['granted', 'demo_24h'])
  t.equal('demo claims are separate ledger rows', await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE grant_type = 'demo_24h'`), 2)

  // ==========================================================================
  console.log(' [F] scenarios 8-10 + 12-14: idempotency — never twice, never restarted')
  // ==========================================================================
  const before = await one(db, `SELECT expiry_at, start_at, subscription_id FROM public.platinum_launch_claims WHERE user_id = $1`, [demo1])
  // Scenario 12: editing/saving the profile again must not restart the demo.
  await db.query(`UPDATE public.matrimony_profiles SET city = 'Nashik', updated_at = now() WHERE user_id = $1`, [demo1])
  const again1 = await claim(db, demo1)
  t.equal('re-claim after profile edit: already_claimed', again1.status, 'already_claimed')
  t.check('demo window unchanged after profile edit',
    new Date(again1.expires_at).getTime() === new Date(before.expiry_at).getTime(),
    { after: again1.expires_at, before: before.expiry_at })
  t.equal('demo subscription row unchanged by the profile edit',
    (await one(db, `SELECT id FROM public.subscriptions WHERE user_id = $1`, [demo1])).id, before.subscription_id)
  // Scenario 13: refresh (repeat calls) cannot duplicate or restart.
  const again2 = await claim(db, demo1)
  const again3 = await claim(db, demo1)
  t.equal('refresh repeat #1: already_claimed', again2.status, 'already_claimed')
  t.equal('refresh repeat #2: already_claimed', again3.status, 'already_claimed')
  t.equal('demo expiry identical across repeats', [again1.expires_at, again2.expires_at, again3.expires_at], [again1.expires_at, again1.expires_at, again1.expires_at])
  t.equal('still exactly one demo claim for the member', await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE user_id = $1`, [demo1]), 1)
  t.equal('still exactly one demo subscription for the member', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [demo1]), 1)
  t.equal('grant event was logged exactly once', await activityCount(db, demo1, 'platinum_demo_24h_granted'), 1)
  // Scenario 14: logout/login — a fresh session for the same member still
  // resolves to the SAME grant (state lives in the database, not the session).
  const afterRelogin = await claim(db, demo1)
  t.equal('after logout/login: already_claimed', afterRelogin.status, 'already_claimed')
  t.equal('after logout/login: same expiry', afterRelogin.expires_at, again1.expires_at)
  const readAfter = await readState(db, demo1)
  t.equal('read RPC survives the session change with the live state', [readAfter.has_grant, readAfter.is_live, readAfter.grant_type], [true, true, 'demo_24h'])

  // Same for a first-100 member (scenario 9/10 on the 30-day path).
  const f1again = await claim(db, first)
  t.equal('first-100 member re-claim: already_claimed', f1again.status, 'already_claimed')
  t.equal('first-100 member keeps slot 1', f1again.slot_number, 1)
  t.equal('first-100 member expiry unchanged', f1again.expires_at, r1.expires_at)
  t.equal('first-100 member still has one subscription', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [first]), 1)
  // Scenario E (rules): a first-100 member can NEVER receive the demo later.
  t.equal('first-100 member never receives a demo claim', await scalar(db, `SELECT count(*)::int FROM public.platinum_launch_claims WHERE user_id = $1 AND grant_type = 'demo_24h'`, [first]), 0)

  // Database-level uniqueness (even a buggy/forced writer cannot duplicate).
  const dupClaim = await asService(db, () => expectError(() => db.query(
    `INSERT INTO public.platinum_launch_claims (campaign_id, user_id, grant_type, slot_number, package_slug, promotion, start_at, expiry_at)
     VALUES ($1, $2, 'demo_24h', NULL, $3, 'platinum_24h_demo', now(), now() + interval '24 hours')`,
    [campaign.id, demo1, DEMO_SLUG])))
  t.check('UNIQUE(campaign_id,user_id) rejects a second claim for one member', /duplicate|unique/i.test(dupClaim), dupClaim)
  // paidTester exists with a complete profile but never claimed — a forced
  // second claim for the ALREADY-TAKEN slot 100 must hit the unique slot
  // index even when written with full service-role rights.
  const dupSlot = await asService(db, () => expectError(() => db.query(
    `INSERT INTO public.platinum_launch_claims (campaign_id, user_id, grant_type, slot_number, package_slug, promotion, start_at, expiry_at)
     VALUES ($1, $2, 'first_100', 100, $3, 'first_100_platinum', now(), now() + interval '30 days')`,
    [campaign.id, paidTester, FIRST100_SLUG])))
  t.check('a duplicate slot 100 is rejected by the unique slot index', /duplicate|unique|platinum_launch_claims_slot_uniq/i.test(dupSlot), dupSlot)

  // Scenario 7 (concurrency): the storage-level guarantees are in place.
  const def = await scalar(db, `SELECT pg_get_functiondef('public.claim_platinum_launch_offer()'::regprocedure)`)
  t.check('claim RPC serialises per member with an advisory transaction lock', /pg_advisory_xact_lock/.test(def))
  t.check('claim RPC locks the campaign row FOR UPDATE before counting', /FOR UPDATE/.test(def))
  t.check('the slot count is read from the LEDGER under that lock', /SELECT count\(\*\)::int\s+INTO v_claimed\s+FROM public\.platinum_launch_claims/.test(def))
  t.equal('no RPC argument exists — nobody can claim for another user', await scalar(db, `SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname='claim_platinum_launch_offer' AND p.pronargs > 0`), 0)
  const wrongArity = await asUser(db, demo2, () => expectError(() => db.query('SELECT public.claim_platinum_launch_offer($1)', [first])))
  t.check('calling the RPC with a foreign user id does not exist as a function', /does not exist/i.test(wrongArity), wrongArity)

  // ==========================================================================
  console.log(' [G] scenarios 3, 16, 17: paid memberships are never downgraded or shortened')
  // ==========================================================================
  const paidUser = await newCompleteMember(db, { gender: 'female', prefix: 'pl-paid' })
  await activatePackage(db, paidUser, 'vip-12-month')
  const vipBefore = await one(db, `SELECT id, started_at, expires_at FROM public.subscriptions WHERE user_id = $1`, [paidUser])
  const vipMembershipBefore = await membership(db, paidUser)
  const paidClaim = await claim(db, paidUser)
  t.equal('a paid member who completes the profile may receive the promotion (scenario 8)', paidClaim.status, 'granted')
  const vipAfter = await one(db, `SELECT id, started_at, expires_at FROM public.subscriptions WHERE user_id = $1 AND id = $2`, [paidUser, vipBefore.id])
  t.equal('paid VIP subscription id intact', vipAfter?.id, vipBefore.id)
  t.equal('paid VIP expiry NOT shortened', new Date(vipAfter.expires_at).getTime(), new Date(vipBefore.expires_at).getTime())
  t.equal('paid VIP start NOT moved', new Date(vipAfter.started_at).getTime(), new Date(vipBefore.started_at).getTime())
  const vipMembershipAfter = await membership(db, paidUser)
  t.equal('get_membership still reports the paid VIP tier (scenario 16: no downgrade)', vipMembershipAfter.tier, 'vip')
  t.equal('VIP benefit map unchanged', vipMembershipAfter.benefits.boosts_included, vipMembershipBefore.benefits.boosts_included)
  t.equal('VIP expiry displayed unchanged', vipMembershipAfter.expires_at, vipMembershipBefore.expires_at)
  // Slots were exhausted in [C], so the paid member's promotional grant is
  // the 24-hour demo — overlapping the VIP plan, never rewriting it.
  t.equal('paid member received the demo grant (campaign already exhausted)', paidClaim.grant_type, 'demo_24h')
  const promoSubOfPaid = await one(db, `SELECT started_at, expires_at FROM public.subscriptions WHERE user_id = $1 AND package_slug = $2`, [paidUser, DEMO_SLUG])
  t.check('promotional grant OVERLAPS (starts now) instead of stacking after the paid plan', Math.abs(new Date(promoSubOfPaid.started_at).getTime() - Date.now()) < 60_000)
  t.check('promotional grant does not extend the paid plan either', new Date(promoSubOfPaid.expires_at).getTime() < new Date(vipBefore.expires_at).getTime())

  // ==========================================================================
  console.log(' [H] scenario 7 (purchase while demo active): existing paid rules stay authoritative')
  // ==========================================================================
  const demoBuyer = await newCompleteMember(db, { prefix: 'pl-demobuyer' })
  const dd = await claim(db, demoBuyer)
  t.equal('demo granted before purchase', dd.grant_type, 'demo_24h')
  await activatePackage(db, demoBuyer, 'smart-3-month')
  const paidRow = await one(db, `SELECT * FROM public.subscriptions WHERE user_id = $1 AND package_slug = 'smart-3-month'`, [demoBuyer])
  t.check('paid Smart purchase exists (never disappears)', Boolean(paidRow), paidRow)
  t.equal('paid Smart is active', paidRow?.status, 'active')
  t.check('existing renewal stacking kept the full 90 days (starts where the demo ends)',
    Math.round((new Date(paidRow.expires_at).getTime() - new Date(dd.expires_at).getTime()) / 86400000) === 90,
    { paidExpiry: paidRow?.expires_at, demoExpiry: dd.expires_at })
  const demoRow = await one(db, `SELECT expires_at FROM public.subscriptions WHERE user_id = $1 AND package_slug = $2`, [demoBuyer, DEMO_SLUG])
  t.equal('the demo row was not rewritten by the purchase', new Date(demoRow.expires_at).getTime(), new Date(dd.expires_at).getTime())
  const buyerMembership = await membership(db, demoBuyer)
  t.equal('get_membership reports the paid plan (longest-running live subscription wins)', buyerMembership.tier, 'smart')
  t.check('membership shows the paid package slug, not the demo', buyerMembership.package_slug === 'smart-3-month', buyerMembership.package_slug)

  // ==========================================================================
  console.log(' [I] scenarios 18-19: promotions never touch Razorpay')
  // ==========================================================================
  t.equal('no payment row exists for any promotional grant', await scalar(db, `SELECT count(*)::int FROM public.payments`), 0)
  t.equal('promotional subscriptions all have payment_id NULL', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE package_slug IN ($1,$2) AND payment_id IS NOT NULL`, [FIRST100_SLUG, DEMO_SLUG]), 0)
  const fakePay = await expectError(() => db.query(
    `INSERT INTO public.payments (user_id, kind, package_id, package_slug, amount_inr, status, razorpay_order_id)
     VALUES ($1, 'package', $2, $3, 0, 'created', $4)`,
    [demo2, p24.id, DEMO_SLUG, `order_fake_${Math.random().toString(16).slice(2)}`]))
  t.check('the database itself rejects creating a payment for a promotional package', /PACKAGE_INVALID|not purchasable/i.test(fakePay), fakePay)
  const fakeActivate = await asService(db, () => expectError(() => db.query(
    `SELECT public.activate_membership($1, $2, NULL)`, [demo2, p24.id])))
  t.check('activate_membership() refuses the promotional packages', /not found or inactive/i.test(fakeActivate), fakeActivate)
  t.equal('no captured revenue anywhere', await scalar(db, `SELECT coalesce(sum(amount_inr),0)::int FROM public.payments WHERE status = 'captured'`), 0)

  // ==========================================================================
  console.log(' [J] scenario 20 + RLS: members cannot manipulate anything')
  // ==========================================================================
  const updSub = await asUser(db, demo2, () => expectError(() => db.query(
    `UPDATE public.subscriptions SET expires_at = now() + interval '10 years' WHERE user_id = $1`, [demo2])))
  t.check('member cannot extend their own subscription expiry', /permission denied/i.test(updSub), updSub)
  const insSub = await asUser(db, demo2, () => expectError(() => db.query(
    `INSERT INTO public.subscriptions (user_id, package_id, package_slug, status, started_at, expires_at)
     VALUES ($1, $2, $3, 'active', now(), now() + interval '365 days')`, [demo2, p30.id, FIRST100_SLUG])))
  t.check('member cannot insert a subscription', /permission denied/i.test(insSub), insSub)
  const updClaim = await asUser(db, demo2, () => expectError(() => db.query(
    `UPDATE public.platinum_launch_claims SET grant_type = 'first_100', slot_number = 1, expiry_at = now() + interval '30 days' WHERE user_id = $1`, [demo2])))
  t.check('member cannot rewrite their claim (grant type / expiry)', /permission denied/i.test(updClaim), updClaim)
  const insClaim = await asUser(db, demo2, () => expectError(() => db.query(
    `INSERT INTO public.platinum_launch_claims (campaign_id, user_id, grant_type, package_slug, promotion, start_at, expiry_at)
     VALUES ($1, $2, 'first_100', $3, 'first_100_platinum', now(), now() + interval '30 days')`, [campaign.id, demo2, FIRST100_SLUG])))
  t.check('member cannot self-insert a first-100 claim', /permission denied/i.test(insClaim), insClaim)
  const readCampaign = await asUser(db, demo2, () => expectError(() => db.query(`SELECT * FROM public.platinum_launch_campaigns`)))
  t.check('members cannot read campaign state', /permission denied/i.test(readCampaign), readCampaign)
  const updCampaign = await asUser(db, demo2, () => expectError(() => db.query(`UPDATE public.platinum_launch_campaigns SET total_slots = 1000000`)))
  t.check('members cannot change campaign counters', /permission denied/i.test(updCampaign), updCampaign)
  const anonCampaign = await asAnon(db, () => expectError(() => db.query(`SELECT * FROM public.platinum_launch_campaigns`)))
  t.check('anon cannot read campaign state', /permission denied/i.test(anonCampaign), anonCampaign)
  const otherClaims = await asUser(db, demo2, async () => {
    const r = await db.query(`SELECT count(*)::int AS n FROM public.platinum_launch_claims`)
    return r.rows[0].n
  })
  t.equal('a member sees ONLY their own claim rows through RLS', otherClaims, 1)
  const ownClaimRead = await asUser(db, demo2, async () => {
    const r = await db.query(`SELECT user_id::text FROM public.platinum_launch_claims`)
    return r.rows[0]?.user_id
  })
  t.equal('the visible row is the member\'s own', ownClaimRead, demo2)

  // ==========================================================================
  console.log(' [K] scenarios 6 (rules) + 15: expiry removes Platinum capabilities')
  // ==========================================================================
  // Force the demo to lapse the way time would, then run the member's own
  // lazy sweep (the existing expiry architecture — nothing promo-specific).
  await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '5 minutes' WHERE user_id = $1 AND package_slug = $2`, [demo2, DEMO_SLUG])
  await asUser(db, demo2, () => one(db, `SELECT public.sweep_my_membership() AS r`))
  t.equal('expired demo subscription flipped by the existing sweep', await scalar(db, `SELECT status::text FROM public.subscriptions WHERE user_id = $1 AND package_slug = $2`, [demo2, DEMO_SLUG]), 'expired')
  t.equal('expired demo: no live membership', await scalar(db, `SELECT public.has_live_membership($1)`, [demo2]), false)
  t.equal('expired demo: profile hidden by the existing rule', await scalar(db, `SELECT public.is_profile_public($1)`, [demo2]), false)
  t.equal('expired demo: profile status set to expired', await scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [demo2]), 'expired')
  t.equal('expired demo: paid capability removed (advanced_search)', await asUser(db, demo2, () => scalar(db, `SELECT public.has_benefit('advanced_search', $1)`, [demo2])), false)
  t.equal('expired demo: membership back to free tier', (await membership(db, demo2)).tier, 'free')
  t.equal('platinum_promotion_expired logged once', await activityCount(db, demo2, 'platinum_promotion_expired'), 1)
  // Sweeping again must not duplicate the event (trigger guard + idempotency key).
  await asUser(db, demo2, () => one(db, `SELECT public.sweep_my_membership() AS r`))
  await asService(db, () => one(db, `SELECT public.sweep_expired_memberships() AS r`))
  t.equal('platinum_promotion_expired stays logged exactly once', await activityCount(db, demo2, 'platinum_promotion_expired'), 1)
  const readExpired = await readState(db, demo2)
  t.equal('member state reports the expired demo truthfully', [readExpired.has_grant, readExpired.is_live], [true, false])
  // A later claim attempt returns the same expired grant — never a new demo.
  const postExpiry = await claim(db, demo2)
  t.equal('an expired demo cannot be re-claimed', postExpiry.status, 'already_claimed')
  t.equal('still exactly one subscription for the expired demo member', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [demo2]), 1)

  // Scenario 15: buying a real package afterwards restores capabilities.
  await activatePackage(db, demo2, 'premium-6-month')
  t.equal('paid purchase after an expired demo restores live membership', await scalar(db, `SELECT public.has_live_membership($1)`, [demo2]), true)
  t.equal('paid purchase restores the public listing', await scalar(db, `SELECT public.is_profile_public($1)`, [demo2]), true)
  t.equal('tier is now the paid premium', (await membership(db, demo2)).tier, 'premium')

  // Expiry of a promo while a paid membership is live must NOT hide anything.
  const bothUser = await newCompleteMember(db, { gender: 'female', prefix: 'pl-both' })
  await activatePackage(db, bothUser, 'vip-12-month')
  const bothPromo = await claim(db, bothUser)
  t.equal('paid member received the promotional grant', bothPromo.status, 'granted')
  t.equal('…as a demo (slots exhausted)', bothPromo.grant_type, 'demo_24h')
  await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '5 minutes', status = 'expired' WHERE user_id = $1 AND package_slug = $2`, [bothUser, DEMO_SLUG])
  await asUser(db, bothUser, () => one(db, `SELECT public.sweep_my_membership() AS r`))
  t.equal('promo expiry does not touch the live paid VIP', await scalar(db, `SELECT status::text FROM public.subscriptions WHERE user_id = $1 AND package_slug = 'vip-12-month'`, [bothUser]), 'active')
  t.equal('member stays publicly visible through the paid plan', await scalar(db, `SELECT public.is_profile_public($1)`, [bothUser]), true)
  t.equal('profile stays active', await scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [bothUser]), 'active')

  // ==========================================================================
  console.log(' [L] scenarios 21-27: DEVELOPMENT reset back to 0/100')
  // ==========================================================================
  const usersBefore = await scalar(db, `SELECT count(*)::int FROM public.profiles`)
  const matrimonyBefore = await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles`)
  const paidSubsBefore = await paidSubCount(db)
  const paidExpiriesBefore = await one(db, `SELECT coalesce(sum(extract(epoch FROM expires_at)),0)::bigint AS s FROM public.subscriptions WHERE package_slug NOT IN ($1,$2)`, [FIRST100_SLUG, DEMO_SLUG])
  const activityBefore = await scalar(db, `SELECT count(*)::int FROM public.activity_events`)
  const grantEventsBefore = await scalar(db, `SELECT count(*)::int FROM public.activity_events WHERE event IN ('platinum_first_100_granted','platinum_demo_24h_granted','platinum_promotion_expired')`)
  const claimsBefore = await claimCount(db)
  const promoSubsBefore = await promoSubCount(db)

  // Scenario 27: normal users (and anon) can NEVER call the reset.
  const userReset = await asUser(db, first, () => expectError(() => db.query(`SELECT public.reset_platinum_launch_campaign('FIRST_100_PLATINUM')`)))
  t.check('a member cannot execute the reset RPC', /permission denied/i.test(userReset), userReset)
  const anonReset = await asAnon(db, () => expectError(() => db.query(`SELECT public.reset_platinum_launch_campaign('FIRST_100_PLATINUM')`)))
  t.check('anon cannot execute the reset RPC', /permission denied/i.test(anonReset), anonReset)

  // Typed confirmation is enforced by the database, not just the UI.
  const badConfirm = await asService(db, () => expectError(() => db.query(`SELECT public.reset_platinum_launch_campaign('whatever')`)))
  t.check('reset refuses without the typed campaign-key confirmation', /RESET_CONFIRMATION_REQUIRED/i.test(badConfirm), badConfirm)

  const reset = await asService(db, () => one(db, `SELECT public.reset_platinum_launch_campaign($1) AS r`, [CAMPAIGN_KEY]))
  t.equal('scenario 21: reset reports the campaign back at 0/100', [reset.r.status, reset.r.claimed_slots, reset.r.total_slots], ['reset_complete', 0, 100])
  t.equal('reset removed every claim of the campaign', reset.r.removed_claims, claimsBefore)
  t.equal('reset removed exactly the promotional subscriptions', reset.r.removed_promotional_subscriptions, promoSubsBefore)
  t.equal('claim ledger is empty (0/100 claimed)', await claimCount(db), 0)
  t.equal('no promotional subscription rows remain', await promoSubCount(db), 0)

  // Scenario 22: ONLY promotional entitlements were removed.
  t.equal('scenario 25: paid subscriptions untouched (count)', await paidSubCount(db), paidSubsBefore)
  t.equal('scenario 25: paid subscriptions untouched (expiries)', (await one(db, `SELECT coalesce(sum(extract(epoch FROM expires_at)),0)::bigint AS s FROM public.subscriptions WHERE package_slug NOT IN ($1,$2)`, [FIRST100_SLUG, DEMO_SLUG])).s, paidExpiriesBefore.s)
  t.equal('scenario 26: payments untouched', await scalar(db, `SELECT count(*)::int FROM public.payments`), 0)
  t.equal('scenario 23: no user was deleted', await scalar(db, `SELECT count(*)::int FROM public.profiles`), usersBefore)
  t.equal('scenario 23: no auth user was deleted', await scalar(db, `SELECT count(*)::int FROM auth.users`), usersBefore)
  t.equal('scenario 24: no matrimony profile was deleted', await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles`), matrimonyBefore)
  t.check('audit history preserved (activity stream grew or stayed, never shrank)', await scalar(db, `SELECT count(*)::int FROM public.activity_events`) >= activityBefore)
  t.equal('past grant/expiry events are retained', await scalar(db, `SELECT count(*)::int FROM public.activity_events WHERE event IN ('platinum_first_100_granted','platinum_demo_24h_granted','platinum_promotion_expired')`), grantEventsBefore)
  t.check('grant events exist to be retained', grantEventsBefore > 100)
  const campaignAfter = await one(db, `SELECT campaign_key, total_slots, enabled FROM public.platinum_launch_campaigns WHERE campaign_key = $1`, [CAMPAIGN_KEY])
  t.equal('campaign configuration itself survived the reset', [campaignAfter.campaign_key, campaignAfter.total_slots, campaignAfter.enabled], [CAMPAIGN_KEY, 100, true])

  // Profiles that were live ONLY through a promotion fell back to expired;
  // paid members are unaffected.
  t.equal('promo-only member is no longer publicly visible', await scalar(db, `SELECT public.is_profile_public($1)`, [demo1]), false)
  t.equal('promo-only profile status restored to expired', await scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [first]), 'expired')
  t.equal('paid VIP member is still live after the reset', await scalar(db, `SELECT public.is_profile_public($1)`, [paidUser]), true)
  t.equal('paid VIP member kept the vip tier', (await membership(db, paidUser)).tier, 'vip')
  const resetState = await readState(db, demo1)
  t.equal('member state after reset: no grant', resetState.has_grant, false)

  // The promotion genuinely restarts from 0/100.
  const fresh = await newCompleteMember(db, { prefix: 'pl-fresh' })
  const freshClaim = await claim(db, fresh)
  t.equal('after reset a new member receives slot 1 again', [freshClaim.status, freshClaim.grant_type, freshClaim.slot_number], ['granted', 'first_100', 1])
  t.equal('ledger restarted at one claim', await claimCount(db), 1)
  // A previously granted member may claim again after a DEV reset (the ledger
  // is the authority) — but still only once per campaign run.
  const regrant = await claim(db, demo1)
  t.equal('a previously-demo member can receive a fresh first-100 grant after the dev reset', regrant.grant_type, 'first_100')
  const regrantAgain = await claim(db, demo1)
  t.equal('…and still cannot claim twice in the new run', regrantAgain.status, 'already_claimed')

  // ==========================================================================
  console.log(' [M] the promotional tier never leaks into paid surfaces')
  // ==========================================================================
  t.equal('promotional packages remain unpurchasable after everything', await scalar(db, `SELECT count(*)::int FROM public.packages WHERE is_active AND tier = 'platinum'`), 0)
  const activeList = await db.query(`SELECT slug FROM public.packages WHERE is_active ORDER BY sort_order`)
  t.equal('the active shop catalogue is exactly Smart, Premium, VIP',
    activeList.rows.map((r) => r.slug), ['smart-3-month', 'premium-6-month', 'vip-12-month'])

  return t
}
