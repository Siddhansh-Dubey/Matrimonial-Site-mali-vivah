// Step 6 — Activity tracking & Admin Analytics: database-level assertions.
//
// Verifies that the authoritative event stream actually records the events
// the PRD requires, that metadata is scrubbed of secrets, that duplicate
// mutations don't double-count events, that RLS still blocks ordinary users
// from reading the activity stream, and that admin_analytics() returns KPIs,
// daily buckets and latest activity from real tables (no fakes).
import { readFileSync } from 'node:fs'
import {
  Checks,
  activatePackage,
  applyMigrations,
  asService,
  asUser,
  completeProfile,
  expectError,
  freshDb,
  one,
  scalar,
  signUp,
} from '../lib/harness.mjs'

/** Anonymous role, exactly as PostgREST presents a logged-out visitor. */
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

async function countEvents(db, userId, event) {
  return scalar(
    db,
    `SELECT count(*)::int AS n FROM public.activity_events WHERE user_id = $1 AND event = $2`,
    [userId, event]
  )
}

async function listEvents(db, userId) {
  const r = await db.query(
    `SELECT event, metadata FROM public.activity_events WHERE user_id = $1 ORDER BY id`,
    [userId]
  )
  return r.rows
}

async function setConfig(db) {
  await db.query(
    `UPDATE public.profile_boost_config SET duration_days = 5, price_inr = 499, is_active = TRUE WHERE id = 1`
  )
}

async function createPayment(db, userId, opts = {}) {
  const kind = opts.kind ?? 'package'
  const amount = opts.amount ?? 999
  const meta = opts.metadata ?? (kind === 'boost' ? { item: 'boost', duration_days: 5 } : {})
  const slug = opts.packageSlug ?? 'smart-3-month'
  const pkgId = kind === 'boost' ? null : (await one(db, `SELECT id FROM public.packages WHERE slug = $1`, [slug]))?.id
  const row = await one(
    db,
    `INSERT INTO public.payments (user_id, kind, package_id, package_slug, amount_inr, status, metadata, razorpay_order_id)
     VALUES ($1, $2, $3, $4, $5, 'created', $6::jsonb, 'order_' || gen_random_uuid()::text)
     RETURNING id`,
    [userId, kind, pkgId, kind === 'package' ? slug : null, amount, meta]
  )
  return row.id
}

export default async function activitySuite(db) {
  const t = new Checks('activity')
  await setConfig(db)

  // =========================================================================
  // 1. Registration and login activity
  // =========================================================================
  console.log(' [1] registration / login activity')
  const alice = await signUp(db, {
    email: 'alice@example.com', name: 'Alice', mobile: '9000000001',
  })
  await completeProfile(db, alice, { gender: 'female' })

  t.equal('registration event recorded', await countEvents(db, alice, 'registered'), 1)
  t.equal('profile_created event recorded', await countEvents(db, alice, 'profile_created'), 1)

  await asUser(db, alice, () => db.query(`SELECT public.record_login()`))
  t.equal('login event recorded', await countEvents(db, alice, 'logged_in'), 1)

  // Second record_login should still log (logins may repeat) — that's fine;
  // not idempotent on purpose (each sign-in is an event).
  await asUser(db, alice, () => db.query(`SELECT public.record_login()`))
  t.equal('second login event recorded', await countEvents(db, alice, 'logged_in'), 2)

  // =========================================================================
  // 2. Profile activity (profile_completed / profile_published / profile_updated)
  // =========================================================================
  console.log(' [2] profile lifecycle events')
  // completeProfile() fills all required fields, so profile_completed should fire.
  t.equal('profile_completed event recorded', await countEvents(db, alice, 'profile_completed'), 1)

  // Activating a package (paid) flips the profile to active → profile_published.
  await activatePackage(db, alice, 'premium-6-month')
  t.equal('profile_published event recorded on activation', await countEvents(db, alice, 'profile_published'), 1)
  t.equal('membership_activated event recorded', await countEvents(db, alice, 'membership_activated'), 1)

  // A profile update (changing a field) should fire profile_updated (throttled).
  await asUser(db, alice, () =>
    db.query(`UPDATE public.matrimony_profiles SET about_me = 'Hello world' WHERE user_id = $1`, [alice])
  )
  // Throttle is 60 seconds; at least one profile_updated exists.
  const nUpd = await countEvents(db, alice, 'profile_updated')
  t.check('profile_updated event recorded', nUpd >= 1, nUpd)

  // =========================================================================
  // 3. Search activity
  // =========================================================================
  console.log(' [3] search activity')
  // Sign up Bob (paid) to perform a search.
  const bob = await signUp(db, { email: 'bob@example.com', name: 'Bob', mobile: '9000000002' })
  await completeProfile(db, bob)
  await activatePackage(db, bob, 'smart-3-month')

  await asUser(db, bob, () =>
    db.query(
      `SELECT public.search_matches('female'::public.gender, 21, 35, 'Pune', NULL, 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
    )
  )
  t.equal('search_performed recorded', await countEvents(db, bob, 'search_performed'), 1)

  // =========================================================================
  // 4. Interest sent / accepted / declined
  // =========================================================================
  console.log(' [4] interest sent / accepted / declined')
  const charlie = await signUp(db, { email: 'charlie@example.com', name: 'Charlie', mobile: '9000000003' })
  await completeProfile(db, charlie, { gender: 'male' })
  await activatePackage(db, charlie, 'premium-6-month')

  // Charlie expresses interest in Alice (mutual interest path requires both
  // sides; here Charlie sends one-way → interest_sent).
  await asUser(db, charlie, () =>
    scalar(db, `SELECT public.express_interest($1, NULL) AS r`, [alice])
  )
  t.equal('interest_sent recorded (charlie → alice)', await countEvents(db, charlie, 'interest_sent'), 1)

  // As Alice, accept the interest (pending → accepted).
  const iRow = await one(
    db,
    `SELECT id FROM public.interests WHERE sender_id = $1 AND receiver_id = $2`,
    [charlie, alice]
  )
  await asUser(db, alice, () =>
    db.query(`UPDATE public.interests SET status = 'accepted' WHERE id = $1`, [iRow.id])
  )
  t.equal('interest_accepted recorded (alice)', await countEvents(db, alice, 'interest_accepted'), 1)

  // Decline: create another pending interest then decline.
  const dave = await signUp(db, { email: 'dave@example.com', name: 'Dave', mobile: '9000000004' })
  await completeProfile(db, dave, { gender: 'male' })
  await activatePackage(db, dave, 'smart-3-month')
  await asUser(db, dave, () => scalar(db, `SELECT public.express_interest($1, NULL) AS r`, [alice]))
  const iRow2 = await one(db, `SELECT id FROM public.interests WHERE sender_id = $1 AND receiver_id = $2`, [dave, alice])
  await asUser(db, alice, () =>
    db.query(`UPDATE public.interests SET status = 'declined' WHERE id = $1`, [iRow2.id])
  )
  t.equal('interest_declined recorded (alice)', await countEvents(db, alice, 'interest_declined'), 1)

  // =========================================================================
  // 5. Payment lifecycle
  // =========================================================================
  console.log(' [5] payment lifecycle')
  const eve = await signUp(db, { email: 'eve@example.com', name: 'Eve', mobile: '9000000005' })
  await completeProfile(db, eve)
  const evePayId = await createPayment(db, eve, { packageSlug: 'premium-6-month', amount: 2499 })

  // payment_initiated fires on INSERT (status='created').
  t.equal('payment_initiated recorded', await countEvents(db, eve, 'payment_initiated'), 1)

  // Capture the payment via activate_membership.
  const evePkg = await one(db, `SELECT id FROM public.packages WHERE slug = 'premium-6-month'`)
  await asService(db, () =>
    scalar(db, `SELECT public.activate_membership($1, $2, $3) AS r`, [eve, evePkg.id, evePayId])
  )
  t.equal('payment_captured recorded', await countEvents(db, eve, 'payment_captured'), 1)
  t.equal('membership_activated recorded', await countEvents(db, eve, 'membership_activated'), 1)

  // Re-activating the SAME payment must be idempotent (no duplicate events).
  await asService(db, () =>
    scalar(db, `SELECT public.activate_membership($1, $2, $3) AS r`, [eve, evePkg.id, evePayId])
  )
  t.equal('retry does not duplicate payment_captured', await countEvents(db, eve, 'payment_captured'), 1)
  t.equal('retry does not duplicate membership_activated', await countEvents(db, eve, 'membership_activated'), 1)

  // Payment failed: transition a fresh payment to failed (superuser, to mirror
  // the server-side webhook path).
  const failPay = await createPayment(db, eve, { packageSlug: 'premium-6-month', amount: 2499 })
  await db.query(
    `UPDATE public.payments SET status = 'failed', failure_reason = 'card declined' WHERE id = $1`,
    [failPay]
  )
  t.equal('payment_failed recorded', await countEvents(db, eve, 'payment_failed'), 1)

  // =========================================================================
  // 6. Boost activation (package-included + purchased)
  // =========================================================================
  console.log(' [6] boost activation + expiry sweep')
  // Eve (Premium) gets boosts_included. Activating should log boost_activated.
  await asUser(db, eve, () => scalar(db, `SELECT public.boost_my_profile() AS r`))
  t.equal('boost_activated (package) recorded', await countEvents(db, eve, 'boost_activated'), 1)
  t.equal('profile_boosted (package) recorded', await countEvents(db, eve, 'profile_boosted'), 1)

  // Simulate boost expiry by advancing clock on profile_boosts, then run sweep.
  await db.query(
    `UPDATE public.profile_boosts SET expires_at = expires_at - interval '10 days' WHERE user_id = $1`,
    [eve]
  )
  await asService(db, () => scalar(db, `SELECT public.sweep_expired_memberships() AS r`))
  t.equal('boost_expired recorded', await countEvents(db, eve, 'boost_expired'), 1)

  // Standalone boost purchase flow.
  const boostPay = await createPayment(db, eve, { kind: 'boost', amount: 499 })
  t.equal('payment_initiated recorded for boost', (await countEvents(db, eve, 'payment_initiated')) >= 1, true)
  await asService(db, () => scalar(db, `SELECT public.activate_boost_purchase($1) AS r`, [boostPay]))
  t.equal('payment_captured recorded for boost payment', await countEvents(db, eve, 'payment_captured'), 2)
  t.equal('boost_purchased recorded', await countEvents(db, eve, 'boost_purchased'), 1)
  t.equal('boost_activated (purchase) recorded', await countEvents(db, eve, 'boost_activated'), 2)

  // Re-activating same boost payment must be idempotent.
  await asService(db, () => scalar(db, `SELECT public.activate_boost_purchase($1) AS r`, [boostPay]))
  t.equal('retry does not duplicate boost_purchased', await countEvents(db, eve, 'boost_purchased'), 1)

  // =========================================================================
  // 7. Report/block activity
  // =========================================================================
  console.log(' [7] block events')
  await asUser(db, bob, () =>
    db.query(`INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [bob, dave])
  )
  t.equal('block_created recorded', await countEvents(db, bob, 'block_created'), 1)
  await asUser(db, bob, () =>
    db.query(`DELETE FROM public.blocks WHERE blocker_id = $1 AND blocked_id = $2`, [bob, dave])
  )
  t.equal('block_removed recorded', await countEvents(db, bob, 'block_removed'), 1)

  // =========================================================================
  // 8. Story/Moment events
  // =========================================================================
  console.log(' [8] moment events')
  // Insert a moment as Charlie.
  const mom = await asUser(db, charlie, () =>
    one(
      db,
      `INSERT INTO public.moments (user_id, media_type, storage_path, expires_at)
       VALUES ($1::uuid, 'photo', $2, now() + interval '24 hours')
       RETURNING id`,
      [charlie, charlie + '/moment.jpg']
    )
  )
  t.equal('moment_posted recorded', await countEvents(db, charlie, 'moment_posted'), 1)

  // Admin-remove the moment (superuser, mirrors admin panel's service-role action).
  await db.query(`UPDATE public.moments SET is_removed = TRUE WHERE id = $1`, [mom.id])
  t.equal('moment_removed recorded', await countEvents(db, charlie, 'moment_removed'), 1)

  // =========================================================================
  // 9. Verification events
  // =========================================================================
  console.log(' [9] verification events')
  const vReq = await asUser(db, bob, () =>
    one(
      db,
      `INSERT INTO public.verification_requests (user_id, type, status)
       VALUES ($1, 'photo', 'pending') RETURNING id`,
      [bob]
    )
  )
  t.equal('verification_submitted recorded', await countEvents(db, bob, 'verification_submitted'), 1)

  // Approve (superuser mirrors admin panel service-role action).
  await db.query(
    `UPDATE public.verification_requests SET status = 'verified', reviewed_at = now() WHERE id = $1`,
    [vReq.id]
  )
  t.equal('verification_approved recorded', await countEvents(db, bob, 'verification_approved'), 1)
  t.equal('profile_verified recorded', await countEvents(db, bob, 'profile_verified'), 1)

  // Reject path.
  const vReq2 = await asUser(db, bob, () =>
    one(
      db,
      `INSERT INTO public.verification_requests (user_id, type, status)
       VALUES ($1, 'id_document', 'pending') RETURNING id`,
      [bob]
    )
  )
  await db.query(
    `UPDATE public.verification_requests SET status = 'rejected', note = 'blurry', reviewed_at = now() WHERE id = $1`,
    [vReq2.id]
  )
  t.equal('verification_rejected recorded', await countEvents(db, bob, 'verification_rejected'), 1)

  // =========================================================================
  // 10. Activity metadata does NOT contain forbidden sensitive fields
  // =========================================================================
  console.log(' [10] metadata never leaks sensitive fields')
  const all = await listEvents(db, alice)
  const forbidden = ['phone', 'mobile', 'email', 'password', 'token', 'secret', 'signature', 'address']
  let leaks = 0
  for (const ev of all) {
    const keys = Object.keys(ev.metadata ?? {})
    for (const k of keys) {
      if (forbidden.some((f) => k.toLowerCase().includes(f))) {
        leaks += 1
      }
    }
  }
  t.equal('no sensitive keys in activity metadata', leaks, 0)

  // Also verify log_activity() scrubs when invoked directly.
  await asService(db, () =>
    scalar(
      db,
      `SELECT public.log_activity($1, 'payment_initiated',
         jsonb_build_object('phone', '9999999999', 'email', 'x@y.com', 'package_slug', 'premium', 'razorpay_signature', 'abc')) AS id`,
      [alice]
    )
  )
  const scrubbedRows = await db.query(
    `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = 'payment_initiated' ORDER BY id DESC LIMIT 1`,
    [alice]
  )
  const scrubbedMeta = scrubbedRows.rows[0]?.metadata ?? {}
  const scrubbedKeys = Object.keys(scrubbedMeta)
  const hasLeak = scrubbedKeys.some((k) =>
    ['phone', 'mobile', 'email', 'password', 'token', 'secret', 'signature', 'address'].some((f) =>
      k.toLowerCase().includes(f)
    )
  )
  t.check('log_activity scrubs forbidden keys', !hasLeak, scrubbedKeys)
  t.check('safe key preserved', scrubbedKeys.includes('package_slug'), scrubbedKeys)

  // =========================================================================
  // 11. Normal users cannot read arbitrary activity events
  // =========================================================================
  console.log(' [11] RLS: ordinary users cannot read others activity')
  // As Bob, reading Alice's activity should return 0 rows (RLS).
  const rowsAsBob = await asUser(db, bob, () =>
    db.query(`SELECT id FROM public.activity_events WHERE user_id = $1`, [alice])
  )
  t.equal('bob cannot read alice activity', rowsAsBob.rows.length, 0)
  // Bob CAN read his own.
  const ownRows = await asUser(db, bob, () =>
    db.query(`SELECT id FROM public.activity_events WHERE user_id = $1`, [bob])
  )
  t.check('bob can read own activity', ownRows.rows.length > 0, ownRows.rows.length)

  // =========================================================================
  // 12. Admin can access analytics through admin_analytics()
  // =========================================================================
  console.log(' [12] admin analytics RPC')
  // Mark alice as admin.
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [alice])

  // The admin panel calls this RPC with the SERVICE-ROLE client, which carries
  // no user JWT: authorization is admin_assert_actor(p_admin_id) — the same
  // single authoritative admin check every other admin RPC uses. (Before
  // migration 20260921000000 the gate was is_admin(), which reads auth.uid();
  // a service-role call has no uid, so the RPC rejected the very admin the
  // panel had already authorised — the reported
  // "Could not load analytics: admin_analytics: admin only.")
  const analytics = await asService(db, () =>
    scalar(db, `SELECT public.admin_analytics(14, $1) AS a`, [alice])
  )
  t.check('admin_analytics returns payload', analytics != null, analytics)
  const parsed = typeof analytics === 'string' ? JSON.parse(analytics) : analytics
  t.equal('kpis.total_members reflects real count', parsed.kpis.total_members, 5)
  t.check('revenue_total is a number', typeof parsed.kpis.revenue_total === 'number', parsed.kpis)
  t.check('daily.days is an array', Array.isArray(parsed.daily.days), parsed.daily)
  t.equal('daily buckets length = window_days', parsed.daily.days.length, 14)
  t.check('top_cities array present', Array.isArray(parsed.top_cities), parsed.top_cities)
  t.check('latest_activity array present', Array.isArray(parsed.latest_activity), parsed.latest_activity)
  // No fake data — counts of not-yet-existent items are 0.
  t.equal('payments_refunded = 0 (none)', parsed.kpis.payments_refunded, 0)

  // The day axis must END ON TODAY (IST). It used to be built from a
  // timestamptz, so to_char() re-rendered the labels in the session timezone
  // (UTC) and the current IST day fell off the axis — today's signups,
  // revenue, interests, messages, searches and profile views vanished from
  // every chart even though the data existed.
  const istToday = await scalar(
    db,
    `SELECT to_char(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS d`
  )
  t.equal('day axis ends on the current IST day', parsed.daily.days.at(-1), istToday)
  t.equal('today\u2019s signup bucket counts the real signups', parsed.daily.signups.at(-1), 5)

  // A signed-in admin may also call it (auth.uid() must equal p_admin_id).
  const errOtherAdminClaim = await (async () => {
    try {
      await asUser(db, alice, () => scalar(db, `SELECT public.admin_analytics(14, $1) AS a`, [alice]))
      return ''
    } catch (e) {
      return e.message ?? String(e)
    }
  })()
  t.check(
    'EXECUTE is service_role only (the body still gates, defence in depth)',
    /permission denied/i.test(errOtherAdminClaim),
    errOtherAdminClaim
  )

  // Non-admin cannot call admin_analytics(): a plain member has no EXECUTE
  // privilege at all, and the service-role control plane cannot name a
  // non-admin as the acting admin.
  const errNonAdmin = await (async () => {
    try {
      await asUser(db, bob, () => scalar(db, `SELECT public.admin_analytics(14, $1) AS a`, [alice]))
      return ''
    } catch (e) {
      return e.message ?? String(e)
    }
  })()
  t.check('non-admin member blocked', /permission denied/i.test(errNonAdmin), errNonAdmin)

  const errNonAdminId = await (async () => {
    try {
      await asService(db, () => scalar(db, `SELECT public.admin_analytics(14, $1) AS a`, [bob]))
      return ''
    } catch (e) {
      return e.message ?? String(e)
    }
  })()
  t.check('service role cannot name a non-admin actor', /ADMIN_ONLY/i.test(errNonAdminId), errNonAdminId)

  const errNoActor = await (async () => {
    try {
      await asService(db, () => scalar(db, `SELECT public.admin_analytics(14) AS a`))
      return ''
    } catch (e) {
      return e.message ?? String(e)
    }
  })()
  t.check('service role cannot read analytics anonymously', /ADMIN_ONLY/i.test(errNoActor), errNoActor)

  const errAnon = await asAnon(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, [alice]))
  )
  t.check('anonymous caller blocked', /permission denied/i.test(errAnon), errAnon)

  // One definition only: no leftover integer-only overload.
  const analyticsOverloads = (
    await db.query(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_analytics'`
    )
  ).rows.map((r) => r.args)
  t.equal('exactly one admin_analytics definition', analyticsOverloads, ['p_days integer, p_admin_id uuid'])

  // =========================================================================
  // 13. Date range filtering works
  // =========================================================================
  console.log(' [13] date-range filtering')
  const readRange = (days) =>
    asService(db, () => scalar(db, `SELECT public.admin_analytics($1, $2) AS a`, [days, alice]))
  const norm = (v) => (typeof v === 'string' ? JSON.parse(v) : v)

  const p7 = norm(await readRange(7))
  t.equal('window_days reflects request (7)', p7.window_days, 7)
  t.equal('daily.days length matches window (7)', p7.daily.days.length, 7)
  t.equal('7-day axis ends today (IST)', p7.daily.days.at(-1), istToday)
  const p14 = norm(await readRange(14))
  t.equal('window_days reflects request (14)', p14.window_days, 14)
  t.equal('daily.days length matches window (14)', p14.daily.days.length, 14)
  const p30 = norm(await readRange(30))
  t.equal('window_days reflects request (30)', p30.window_days, 30)
  t.equal('daily.days length matches window (30)', p30.daily.days.length, 30)
  t.equal('30-day axis ends today (IST)', p30.daily.days.at(-1), istToday)
  const p90 = norm(await readRange(90))
  t.equal('window_days reflects request (90)', p90.window_days, 90)
  t.equal('daily.days length matches window (90)', p90.daily.days.length, 90)
  t.equal('90-day axis ends today (IST)', p90.daily.days.at(-1), istToday)
  // The window really reaches the query: a 90-day axis strictly contains the
  // 7-day one and every bucket array is the same length as the axis.
  t.check(
    'the window changes the server-side query (90d ⊃ 7d)',
    p90.daily.days.slice(-7).every((d, i) => d === p7.daily.days[i]) &&
      p90.daily.days.length > p7.daily.days.length,
    { d7: p7.daily.days, d90tail: p90.daily.days.slice(-7) }
  )
  for (const [name, payload] of [['7', p7], ['14', p14], ['30', p30], ['90', p90]]) {
    for (const series of ['signups', 'revenue', 'interests', 'messages', 'searches', 'profile_views']) {
      t.equal(
        `${name}-day ${series} bucket length matches the axis`,
        payload.daily[series].length,
        payload.daily.days.length
      )
    }
  }
  // Out-of-range input is clamped server-side, never trusted.
  t.equal('p_days = 0 is clamped to 1', norm(await readRange(0)).window_days, 1)
  t.equal('p_days = 9999 is clamped to 365', norm(await readRange(9999)).window_days, 365)

  // =========================================================================
  // 14. Analytics counts come from authoritative sources (no double counting)
  // =========================================================================
  console.log(' [14] authoritative sources')
  // payment_captured count from analytics should equal the actual number of
  // payments with status='captured' updated within the window. We added
  // captured payments for eve (2 captured: membership + boost) = 2.
  const capCount = await scalar(
    db,
    `SELECT count(*)::int FROM public.payments WHERE status = 'captured' AND updated_at >= now() - interval '30 days'`
  )
  t.equal('payments_captured KPI matches payments table', p30.kpis.payments_captured, capCount)

  // interests_sent from the KPI should match the interests table count.
  const intCount = await scalar(
    db,
    `SELECT count(*)::int FROM public.interests WHERE created_at >= now() - interval '30 days'`
  )
  t.equal('interests_sent KPI matches interests table', p30.kpis.interests_sent, intCount)

  // profile_views KPI should use the profile_views table (zero since we
  // haven't created any views in this test).
  t.equal('profile_views KPI matches profile_views table (0)', p30.kpis.profile_views, 0)

  // messages KPI should be 0 (no messages sent yet — need mutual + paid, but
  // we haven't set up a mutual conversation).
  t.equal('messages KPI = 0 with no messages', p30.kpis.messages, 0)

  // =========================================================================
  // 15. Account deleted event
  // =========================================================================
  console.log(' [15] account deletion event')
  const frank = await signUp(db, { email: 'frank@example.com', name: 'Frank', mobile: '9000000006' })
  await completeProfile(db, frank)
  await asUser(db, frank, () => scalar(db, `SELECT public.log_account_deletion('test reason') AS id`))
  t.equal('account_deleted recorded', await countEvents(db, frank, 'account_deleted'), 1)
  // Idempotent — second call does not duplicate.
  await asUser(db, frank, () => scalar(db, `SELECT public.log_account_deletion('test reason') AS id`))
  t.equal('account_deleted idempotent', await countEvents(db, frank, 'account_deleted'), 1)

  // =========================================================================
  // 16. Canonical event vocabulary is exposed
  // =========================================================================
  console.log(' [16] canonical event vocabulary')
  const voc = await scalar(db, `SELECT public.canonical_activity_events() AS v`)
  const parsedVoc = typeof voc === 'string' ? JSON.parse(voc) : voc
  t.check('vocabulary is array', Array.isArray(parsedVoc), parsedVoc)
  t.check('vocabulary includes registered', parsedVoc.includes('registered'), parsedVoc)
  t.check('vocabulary includes payment_captured', parsedVoc.includes('payment_captured'), parsedVoc)
  t.check('vocabulary includes boost_activated', parsedVoc.includes('boost_activated'), parsedVoc)
  t.check('vocabulary includes moment_posted', parsedVoc.includes('moment_posted'), parsedVoc)

  return t
}
