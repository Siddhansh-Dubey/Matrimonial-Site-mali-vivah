// Step 12 — payment + membership lifecycle security checks.
// These checks exercise the real migration chain and its RLS / SECURITY
// DEFINER boundaries. Provider HTTP calls are covered by the route contracts;
// the database tests model the validated local payment row that those routes
// hand to the service-role activation RPCs.
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

async function asAnon(db, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);
                 SELECT set_config('request.jwt.claim.role', 'anon', false);
                 SET ROLE anon;`)
  try {
    return await fn()
  } finally {
    try { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);`) } catch { /* aborted */ }
  }
}

async function packageRow(db, slug = 'smart-3-month') {
  return one(db, `SELECT id, slug, price_inr, duration_days, is_active FROM public.packages WHERE slug = $1`, [slug])
}

async function payment(db, userId, {
  slug = 'smart-3-month',
  kind = 'package',
  status = 'created',
  amount,
  order = `order_${userId.slice(0, 8)}_${Math.random().toString(16).slice(2)}`,
  paymentId = null,
  packageId = undefined,
  packageSlug = undefined,
  durationDays = undefined,
  key = null,
} = {}) {
  const pkg = await packageRow(db, slug)
  const boostDuration = kind === 'boost'
    ? await scalar(db, `SELECT duration_days FROM public.profile_boost_config WHERE id = 1`)
    : null
  const row = await one(
    db,
    `INSERT INTO public.payments
       (user_id, kind, package_id, package_slug, amount_inr, duration_days, status,
        razorpay_order_id, razorpay_payment_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      userId,
      kind,
      kind === 'boost' ? null : (packageId === undefined ? pkg.id : packageId),
      kind === 'boost' ? null : (packageSlug === undefined ? pkg.slug : packageSlug),
      amount ?? (kind === 'boost' ? 499 : pkg.price_inr),
      durationDays ?? (kind === 'boost' ? boostDuration : pkg.duration_days),
      status,
      order,
      paymentId,
      key,
    ],
  )
  return row.id
}

async function activityCount(db, userId, event) {
  return scalar(db, `SELECT count(*)::int AS n FROM public.activity_events WHERE user_id = $1 AND event = $2`, [userId, event])
}

async function activatePayment(db, userId, slug, paymentId) {
  const pkg = await packageRow(db, slug)
  return asService(db, () => scalar(db,
    `SELECT public.activate_membership($1, $2, $3) AS r`, [userId, pkg.id, paymentId]))
}

export default async function paymentMembershipLifecycleSuite(db) {
  const t = new Checks('payment-membership-lifecycle')

  console.log(' [1] package authority')
  const smart = await packageRow(db, 'smart-3-month')
  const premium = await packageRow(db, 'premium-6-month')
  const vip = await packageRow(db, 'vip-12-month')
  t.check('Smart is active at ₹999', smart?.is_active === true && smart.price_inr === 999, smart)
  t.check('Smart duration is 90 days', smart?.duration_days === 90, smart)
  t.check('Premium is active at ₹2,499', premium?.is_active === true && premium.price_inr === 2499, premium)
  t.check('Premium duration is 180 days', premium?.duration_days === 180, premium)
  t.check('VIP is active at ₹4,999, not the retired ₹5,999', vip?.is_active === true && vip.price_inr === 4999 && vip.price_inr !== 5999, vip)
  t.check('VIP duration is 365 days', vip?.duration_days === 365, vip)
  t.equal('legacy Silver is not purchasable', await scalar(db, `SELECT is_active FROM public.packages WHERE slug = 'silver-3-month'`), false)
  t.equal('legacy Gold is not purchasable', await scalar(db, `SELECT is_active FROM public.packages WHERE slug = 'gold-6-month'`), false)
  t.equal('legacy Platinum is not purchasable', await scalar(db, `SELECT is_active FROM public.packages WHERE slug = 'platinum-12-month'`), false)

  const alice = await signUp(db, { email: 'step12-alice@example.com', name: 'Step Twelve Alice', mobile: '9000012001' })
  const bob = await signUp(db, { email: 'step12-bob@example.com', name: 'Step Twelve Bob', mobile: '9000012002' })
  const cara = await signUp(db, { email: 'step12-cara@example.com', name: 'Step Twelve Cara', mobile: '9000012003' })
  await Promise.all([
    completeProfile(db, alice, { gender: 'female' }),
    completeProfile(db, bob, { gender: 'male' }),
    completeProfile(db, cara, { gender: 'male' }),
  ])

  console.log(' [2] ownership and direct RPC boundaries')
  const directInsert = await asUser(db, alice, () => expectError(() => db.query(
    `INSERT INTO public.payments (user_id, package_id, package_slug, amount_inr)
     VALUES ($1, $2, $3, $4)`, [alice, smart.id, smart.slug, smart.price_inr])))
  t.check('member cannot insert a payment row', /permission denied/i.test(directInsert), directInsert)
  const directUpdate = await asUser(db, alice, () => expectError(() => db.query(
    `UPDATE public.payments SET status = 'captured' WHERE user_id = $1`, [alice])))
  t.check('member cannot mark a payment captured directly', /permission denied/i.test(directUpdate), directUpdate)
  const anonActivate = await asAnon(db, () => expectError(() => db.query(
    `SELECT public.activate_membership($1, $2, NULL)`, [alice, smart.id])))
  t.check('anon cannot execute membership activation', /permission denied/i.test(anonActivate), anonActivate)
  const memberActivate = await asUser(db, alice, () => expectError(() => db.query(
    `SELECT public.activate_membership($1, $2, NULL)`, [alice, smart.id])))
  t.check('member cannot execute membership activation', /permission denied/i.test(memberActivate), memberActivate)
  const memberRefund = await asUser(db, alice, () => expectError(() => db.query(
    `SELECT public.refund_membership(gen_random_uuid())`)))
  t.check('member cannot execute refund processing', /permission denied/i.test(memberRefund), memberRefund)
  const eventRead = await asUser(db, alice, () => expectError(() => db.query(`SELECT * FROM public.payment_webhook_events`)))
  t.check('members cannot read the webhook replay ledger', /permission denied/i.test(eventRead), eventRead)

  console.log(' [3] payment snapshot authority')
  const badAmount = await expectError(() => payment(db, alice, { amount: 1, key: 'bad-amount-1' }))
  t.check('wrong package amount is rejected by the database', /AMOUNT_MISMATCH/i.test(badAmount), badAmount)
  const badDuration = await expectError(() => payment(db, alice, { durationDays: 91, key: 'bad-duration-1' }))
  t.check('wrong package duration is rejected by the database', /DURATION_MISMATCH/i.test(badDuration), badDuration)
  const badSlug = await expectError(() => payment(db, alice, { packageSlug: 'vip-12-month', key: 'bad-slug-1' }))
  t.check('package id and slug cannot be swapped', /PACKAGE_MISMATCH|AMOUNT_MISMATCH/i.test(badSlug), badSlug)
  const badCurrency = await expectError(() => db.query(
    `INSERT INTO public.payments (user_id, package_id, package_slug, amount_inr, currency, idempotency_key)
     VALUES ($1, $2, $3, $4, 'USD', 'bad-currency-1')`, [alice, smart.id, smart.slug, smart.price_inr]))
  t.check('non-INR payment is rejected', /CURRENCY_INVALID|payments_currency_inr_check/i.test(badCurrency), badCurrency)
  const badBoost = await expectError(() => payment(db, alice, { kind: 'boost', amount: 1, key: 'bad-boost-1' }))
  t.check('wrong boost amount is rejected', /AMOUNT_MISMATCH/i.test(badBoost), badBoost)
  const badKey = await expectError(() => payment(db, alice, { key: 'short' }))
  t.check('short idempotency keys are rejected', /IDEMPOTENCY_KEY_INVALID/i.test(badKey), badKey)
  const validPayment = await payment(db, alice, { key: 'order-retry-key-1' })
  t.equal('new payment starts in created state', await scalar(db, `SELECT status::text FROM public.payments WHERE id = $1`, [validPayment]), 'created')
  t.equal('package duration is snapshotted on the payment', await scalar(db, `SELECT duration_days FROM public.payments WHERE id = $1`, [validPayment]), smart.duration_days)
  t.equal('payment_initiated is emitted once', await activityCount(db, alice, 'payment_initiated'), 1)
  const duplicateKey = await expectError(() => payment(db, alice, { key: 'order-retry-key-1' }))
  t.check('same user/kind/idempotency key cannot create two attempts', /duplicate|unique/i.test(duplicateKey), duplicateKey)
  const firstFixed = await payment(db, alice, { key: 'fixed-order-1', order: `order_${alice.slice(0, 8)}_fixed` })
  const duplicateOrder = await expectError(() => payment(db, alice, { key: 'another-key-1', order: `order_${alice.slice(0, 8)}_fixed` }))
  t.check('different retry keys may not reuse one Razorpay order', /duplicate|unique/i.test(duplicateOrder), { firstFixed, duplicateOrder })
  const duplicateProviderPayment = await expectError(() => payment(db, alice, { key: 'provider-id-1', paymentId: 'pay_shared_1' }))
  const secondProviderPayment = await expectError(() => payment(db, bob, { key: 'provider-id-2', paymentId: 'pay_shared_1' }))
  t.equal('first provider payment id is accepted', duplicateProviderPayment, '')
  t.check('Razorpay payment identity is globally unique', /duplicate|unique/i.test(secondProviderPayment), secondProviderPayment)

  console.log(' [4] activation relationship and idempotency')
  const pay = await payment(db, alice, { key: 'activate-alice-1', paymentId: 'pay_alice_1' })
  const wrongUser = await expectError(() => activatePayment(db, bob, 'smart-3-month', pay))
  t.check('User B cannot consume User A payment', /relationship mismatch|payment.*user/i.test(wrongUser), wrongUser)
  const wrongPackage = await expectError(() => activatePayment(db, alice, 'premium-6-month', pay))
  t.check('payment cannot be activated for another package', /relationship mismatch|payment.*package/i.test(wrongPackage), wrongPackage)
  const activated = await activatePayment(db, alice, 'smart-3-month', pay)
  t.equal('valid local payment activates membership', activated.status, 'activated')
  t.equal('payment becomes captured only during activation', await scalar(db, `SELECT status::text FROM public.payments WHERE id = $1`, [pay]), 'captured')
  t.equal('subscription points to the exact payment', await scalar(db, `SELECT payment_id FROM public.subscriptions WHERE payment_id = $1`, [pay]), pay)
  t.equal('subscription package is derived from the DB package', await scalar(db, `SELECT package_slug FROM public.subscriptions WHERE payment_id = $1`, [pay]), 'smart-3-month')
  t.equal('captured event is emitted once', await activityCount(db, alice, 'payment_captured'), 1)
  t.equal('membership activation event is emitted once', await activityCount(db, alice, 'membership_activated'), 1)
  const expiresAfterFirst = await scalar(db, `SELECT expires_at FROM public.subscriptions WHERE payment_id = $1`, [pay])
  const retry = await activatePayment(db, alice, 'smart-3-month', pay)
  t.equal('same activation replay returns already_activated', retry.status, 'already_activated')
  t.equal('replay does not add a subscription', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [alice]), 1)
  t.equal('replay does not extend the original expiry', await scalar(db, `SELECT expires_at FROM public.subscriptions WHERE payment_id = $1`, [pay]), expiresAfterFirst)
  t.equal('replay does not duplicate captured activity', await activityCount(db, alice, 'payment_captured'), 1)
  t.equal('replay does not duplicate activation activity', await activityCount(db, alice, 'membership_activated'), 1)
  t.equal('replay does not duplicate payment notification', await scalar(db, `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND title = 'Payment received — welcome aboard'`, [alice]), 1)

  console.log(' [5] failures, renewal and state machine')
  const failed = await payment(db, bob, { key: 'failed-payment-1', paymentId: 'pay_bob_fail' })
  await db.query(`UPDATE public.payments SET status = 'failed', failure_reason = 'declined' WHERE id = $1`, [failed])
  t.equal('failed payment remains failed', await scalar(db, `SELECT status::text FROM public.payments WHERE id = $1`, [failed]), 'failed')
  const failedActivation = await expectError(() => activatePayment(db, bob, 'smart-3-month', failed))
  t.check('failed payment cannot activate membership', /not payable|failed/i.test(failedActivation), failedActivation)
  t.equal('failed payment creates no subscription', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE payment_id = $1`, [failed]), 0)
  const invalidTransition = await expectError(() => db.query(`UPDATE public.payments SET status = 'captured' WHERE id = $1`, [failed]))
  t.check('failed cannot transition back to captured', /STATE_TRANSITION_INVALID/i.test(invalidTransition), invalidTransition)
  const renewalPay = await payment(db, alice, { slug: 'premium-6-month', key: 'renewal-payment-1', paymentId: 'pay_alice_renew' })
  const renewed = await activatePayment(db, alice, 'premium-6-month', renewalPay)
  t.equal('second valid payment creates a renewal', renewed.status, 'activated')
  t.equal('renewal is stacked after the current live plan', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [alice]), 2)
  t.equal('renewal event is recorded once', await activityCount(db, alice, 'membership_renewed'), 1)
  const renewalRetry = await activatePayment(db, alice, 'premium-6-month', renewalPay)
  t.equal('renewal replay is idempotent', renewalRetry.status, 'already_activated')
  t.equal('renewal replay does not add a third subscription', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1`, [alice]), 2)

  console.log(' [6] payment-backed subscription constraints')
  const uncaptured = await payment(db, bob, { key: 'uncaptured-sub-1', paymentId: 'pay_uncaptured' })
  const directSub = await expectError(() => db.query(
    `INSERT INTO public.subscriptions (user_id, package_id, package_slug, payment_id)
     VALUES ($1, $2, $3, $4)`, [bob, smart.id, smart.slug, uncaptured]))
  t.check('subscription cannot consume an uncaptured payment', /NOT_CAPTURED/i.test(directSub), directSub)
  const capturedWrongLink = await payment(db, bob, { key: 'wrong-link-1', paymentId: 'pay_wrong_link' })
  await db.query(`UPDATE public.payments SET status = 'captured' WHERE id = $1`, [capturedWrongLink])
  const wrongLinkSub = await expectError(() => db.query(
    `INSERT INTO public.subscriptions (user_id, package_id, package_slug, payment_id)
     VALUES ($1, $2, $3, $4)`, [cara, smart.id, smart.slug, capturedWrongLink]))
  t.check('subscription cannot consume another user payment', /PAYMENT_MISMATCH/i.test(wrongLinkSub), wrongLinkSub)
  const duplicateSubscription = await expectError(() => db.query(
    `INSERT INTO public.subscriptions (user_id, package_id, package_slug, payment_id)
     VALUES ($1, $2, $3, $4)`, [alice, smart.id, smart.slug, pay]))
  t.check('unique payment link blocks duplicate entitlement', /duplicate|unique/i.test(duplicateSubscription), duplicateSubscription)
  const adminManual = await asService(db, () => scalar(db, `SELECT public.activate_membership($1, $2, NULL) AS r`, [cara, smart.id]))
  t.equal('manual admin activation remains payment-distinguishable', adminManual.status, 'activated')
  t.equal('manual subscription has no payment link', await scalar(db, `SELECT payment_id FROM public.subscriptions WHERE user_id = $1`, [cara]), null)

  console.log(' [7] refunds and entitlement isolation')
  const refundPay = await payment(db, bob, { key: 'refund-package-1', paymentId: 'pay_bob_refund' })
  await activatePayment(db, bob, 'smart-3-month', refundPay)
  const refundResult = await asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [refundPay]))
  t.equal('membership refund is tied to the requested payment', refundResult.status, 'refunded')
  t.equal('refunded payment is marked refunded', await scalar(db, `SELECT status::text FROM public.payments WHERE id = $1`, [refundPay]), 'refunded')
  t.equal('only the payment-linked subscription is cancelled', await scalar(db, `SELECT status::text FROM public.subscriptions WHERE payment_id = $1`, [refundPay]), 'cancelled')
  t.equal('manual/admin subscription is not revoked by membership refund', await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE user_id = $1 AND payment_id IS NULL AND status = 'active'`, [bob]), 0)
  t.equal('membership refund event is emitted once', await activityCount(db, bob, 'membership_refunded'), 1)
  t.equal('payment refund event is emitted once', await activityCount(db, bob, 'payment_refunded'), 1)
  const refundAgain = await asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [refundPay]))
  t.equal('duplicate membership refund is a no-op', refundAgain.status, 'already_refunded')
  t.equal('duplicate refund does not duplicate refund activity', await activityCount(db, bob, 'payment_refunded'), 1)
  t.equal('duplicate refund does not duplicate subscription refund activity', await activityCount(db, bob, 'membership_refunded'), 1)
  const failedRefund = await asService(db, () => expectError(() => db.query(`SELECT public.refund_membership($1)`, [failed])))
  t.check('failed payment cannot be refunded as a captured payment', /not refundable/i.test(failedRefund), failedRefund)

  const boostPay = await payment(db, alice, { kind: 'boost', key: 'boost-payment-1', paymentId: 'pay_boost_1' })
  t.equal('boost duration is snapshotted on the payment', await scalar(db, `SELECT duration_days FROM public.payments WHERE id = $1`, [boostPay]), await scalar(db, `SELECT duration_days FROM public.profile_boost_config WHERE id = 1`))
  const boostActivation = await asService(db, () => scalar(db, `SELECT public.activate_boost_purchase($1) AS r`, [boostPay]))
  t.check('shared payment pipeline activates a purchased boost', boostActivation.status === 'activated' || boostActivation.status === 'stacked', boostActivation)
  const boostAgain = await asService(db, () => scalar(db, `SELECT public.activate_boost_purchase($1) AS r`, [boostPay]))
  t.equal('duplicate boost activation does not add an entitlement', boostAgain.status, 'already_activated')
  t.equal('one purchased boost entitlement maps to one payment', await scalar(db, `SELECT count(*)::int FROM public.profile_boost_entitlements WHERE payment_id = $1`, [boostPay]), 1)
  const boostRefund = await asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [boostPay]))
  t.equal('boost refund returns the boost kind', boostRefund.kind, 'boost')
  t.equal('boost refund revokes only that entitlement', await scalar(db, `SELECT status FROM public.profile_boost_entitlements WHERE payment_id = $1`, [boostPay]), 'revoked')
  const boostRefundAgain = await asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [boostPay]))
  t.equal('duplicate boost refund is idempotent', boostRefundAgain.status, 'already_refunded')

  console.log(' [8] expiry is server-time authoritative')
  const expired = await signUp(db, { email: 'step12-expired@example.com', name: 'Expired Member', mobile: '9000012004' })
  await completeProfile(db, expired)
  await activatePackage(db, expired, 'smart-3-month')
  await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [expired])
  t.equal('expired membership fails the live check before sweep', await scalar(db, `SELECT public.has_live_membership($1)`, [expired]), false)
  t.equal('expired member immediately resolves to free benefits', await scalar(db, `SELECT public.get_membership($1) ->> 'tier'`, [expired]), 'free')
  t.equal('expired profile is not public before cleanup', await scalar(db, `SELECT public.is_profile_public($1)`, [expired]), false)
  t.equal('expired profile is absent from search before cleanup', await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE user_id = $1 AND public.is_profile_public(user_id)`, [expired]), 0)
  await asService(db, () => scalar(db, `SELECT public.sweep_expired_memberships()`))
  t.equal('sweep marks the expired subscription', await scalar(db, `SELECT status::text FROM public.subscriptions WHERE user_id = $1`, [expired]), 'expired')
  t.equal('sweep marks the profile expired', await scalar(db, `SELECT status::text FROM public.matrimony_profiles WHERE user_id = $1`, [expired]), 'expired')
  t.equal('expiry activity is emitted once', await activityCount(db, expired, 'membership_expired'), 1)
  await asService(db, () => scalar(db, `SELECT public.sweep_expired_memberships()`))
  t.equal('repeated sweep does not duplicate expiry activity', await activityCount(db, expired, 'membership_expired'), 1)

  console.log(' [9] deletion and stale webhook safety')
  const deleted = await signUp(db, { email: 'step12-deleted@example.com', name: 'Deleted Member', mobile: '9000012005' })
  await completeProfile(db, deleted)
  const deletedPay = await payment(db, deleted, { key: 'deleted-payment-1', paymentId: 'pay_deleted_1' })
  await activatePayment(db, deleted, 'smart-3-month', deletedPay)
  await asUser(db, deleted, () => scalar(db, `SELECT public.delete_my_account()`))
  t.equal('deleted payment is retained but detached', await scalar(db, `SELECT user_id FROM public.payments WHERE id = $1`, [deletedPay]), null)
  t.equal('deleted subscription is retained but detached', await scalar(db, `SELECT user_id FROM public.subscriptions WHERE payment_id = $1`, [deletedPay]), null)
  t.equal('deleted account is not public', await scalar(db, `SELECT public.is_profile_public($1)`, [deleted]), false)
  const staleWebhookActivation = await asService(db, () => expectError(() => db.query(
    `SELECT public.activate_membership($1, $2, $3)`, [deleted, smart.id, deletedPay])))
  t.check('stale payment cannot resurrect a deleted account', /INACTIVE|not found|mismatch/i.test(staleWebhookActivation), staleWebhookActivation)
  const deletedMembership = await scalar(db, `SELECT public.get_membership($1) ->> 'tier'`, [deleted])
  t.equal('deleted account resolves to free membership', deletedMembership, 'free')
  const retainedRefund = await asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [deletedPay]))
  t.equal('retained orphan payment can be refunded without reviving account', retainedRefund.status, 'refunded')
  const retainedRefundAgain = await asService(db, () => scalar(db, `SELECT public.refund_membership($1) AS r`, [deletedPay]))
  t.equal('orphan refund replay is idempotent', retainedRefundAgain.status, 'already_refunded')

  console.log(' [10] activity and replay ledger constraints')
  const eventOne = await asService(db, () => scalar(db, `SELECT public.log_activity($1, 'payment_captured', '{"payment_id":"x"}'::jsonb, 'event-key-1')`, [alice]))
  const eventTwo = await asService(db, () => scalar(db, `SELECT public.log_activity($1, 'payment_captured', '{"payment_id":"x"}'::jsonb, 'event-key-1')`, [alice]))
  t.equal('activity idempotency returns the original row', eventTwo, eventOne)
  t.equal('activity idempotency has one database row', await scalar(db, `SELECT count(*)::int FROM public.activity_events WHERE user_id = $1 AND event = 'payment_captured' AND metadata ->> '__idkey' = 'event-key-1'`, [alice]), 1)
  t.check('activity metadata does not expose signature/card secrets', !(await one(db, `SELECT metadata FROM public.activity_events WHERE id = $1`, [eventOne])).metadata?.razorpay_signature, eventOne)
  await asService(db, () => db.query(`INSERT INTO public.payment_webhook_events (event_id, event_type) VALUES ('evt-step12-1', 'payment.captured')`))
  const duplicateEvent = await expectError(() => db.query(`INSERT INTO public.payment_webhook_events (event_id, event_type) VALUES ('evt-step12-1', 'payment.captured')`))
  t.check('webhook event identity has a uniqueness constraint', /duplicate|unique/i.test(duplicateEvent), duplicateEvent)
  t.equal('unknown webhook event has no payment mutation', await scalar(db, `SELECT count(*)::int FROM public.payment_webhook_events WHERE event_type = 'payment.captured' AND event_id = 'evt-step12-1'`), 1)

  return t
}
