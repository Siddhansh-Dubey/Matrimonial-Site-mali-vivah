// Admin Analytics authorization + data integrity (Step 15).
//
// Reproduces and then proves the fix for the reported failure:
//
//     Could not load analytics: admin_analytics: admin only.
//
// The Admin panel authorises /admin with profiles.is_admin on the MEMBER's
// session (src/lib/admin/server.ts → rpc('is_admin')), but the page invoked
// admin_analytics() with the SERVICE-ROLE client. A service-role request has no
// user JWT, so auth.uid() was NULL, is_admin() was FALSE and the RPC rejected
// the very admin the page had already authorised. Migration
// 20260921000000_admin_analytics_authorization.sql moves the RPC onto
// admin_assert_actor(p_admin_id) — the ONE authoritative admin check every
// other admin RPC already used — and the page now passes the acting admin id.
//
// Checks: admin can read; ordinary member cannot; anonymous cannot; the four
// date ranges really change the query; revenue/user counts come from the
// authoritative tables; empty datasets are rendered as 0 rather than hidden or
// fabricated; RLS, GRANTs, SECURITY DEFINER and search_path stay intact.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** The exact call the Admin → Analytics page makes (service role + actor id). */
function analyticsAsPanel(db, days, adminId) {
  return asService(db, () => scalar(db, `SELECT public.admin_analytics($1, $2) AS a`, [days, adminId]))
}

function parse(v) {
  return typeof v === 'string' ? JSON.parse(v) : v
}

let seq = 0
async function member(db, { name, gender = 'male' }) {
  seq += 1
  const id = await signUp(db, {
    email: `an-${seq}-${Date.now().toString(36)}@example.com`,
    name,
    mobile: `98${String(10000000 + seq).slice(0, 8)}`,
    forWhom: 'self',
  })
  await completeProfile(db, id, { gender })
  return id
}

async function capturedPayment(db, userId, slug, amount) {
  const pkg = await one(db, `SELECT id FROM public.packages WHERE slug = $1`, [slug])
  const row = await one(
    db,
    `INSERT INTO public.payments
       (user_id, kind, package_id, package_slug, amount_inr, duration_days, status,
        razorpay_order_id, razorpay_payment_id)
     VALUES ($1, 'package', $2, $3, $4, 180, 'created', $5, $6)
     RETURNING id`,
    [userId, pkg.id, slug, amount, `order_an_${seq}_${Math.random().toString(16).slice(2)}`, `pay_an_${seq}`]
  )
  return row.id
}

export default async function adminAnalyticsAuthzSuite(db) {
  const t = new Checks('admin-analytics-authz')

  // =========================================================================
  console.log(' [1] fixture: one admin, several ordinary members, real activity')
  // =========================================================================
  const admin = await member(db, { name: 'Analytics Admin' })
  const carol = await member(db, { name: 'Carol Member', gender: 'female' })
  const dave = await member(db, { name: 'Dave Member' })
  const erin = await member(db, { name: 'Erin Member', gender: 'female' })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])

  // Real paid activity through the authoritative activation RPC.
  const payCarol = await capturedPayment(db, carol, 'premium-6-month', 2499)
  const premiumPkg = await one(db, `SELECT id FROM public.packages WHERE slug = 'premium-6-month'`)
  await asService(db, () =>
    scalar(db, `SELECT public.activate_membership($1, $2, $3) AS r`, [carol, premiumPkg.id, payCarol])
  )
  await activatePackage(db, dave, 'smart-3-month')

  // Real engagement activity.
  await asUser(db, dave, () => scalar(db, `SELECT public.express_interest($1, 'hello') AS r`, [carol]))

  const totalMembers = await scalar(db, `SELECT count(*)::int FROM public.profiles`)
  t.check('fixture has several members', totalMembers >= 4, totalMembers)

  // =========================================================================
  console.log(' [2] the admin CAN retrieve analytics through the panel path')
  // =========================================================================
  const payload = parse(await analyticsAsPanel(db, 14, admin))
  t.check('admin_analytics returns a payload', payload != null && typeof payload === 'object', payload)
  t.equal('window_days echoes the request', payload.window_days, 14)
  t.check('kpis object present', payload.kpis && typeof payload.kpis === 'object')
  t.check('daily object present', payload.daily && Array.isArray(payload.daily.days))
  t.check('top_cities array present', Array.isArray(payload.top_cities))
  t.check('latest_activity array present', Array.isArray(payload.latest_activity))
  t.check('packages array present', Array.isArray(payload.packages))

  // =========================================================================
  console.log(' [3] ordinary members and anonymous callers CANNOT')
  // =========================================================================
  const errMember = await asUser(db, carol, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, [admin]))
  )
  t.check('authenticated non-admin denied', /permission denied/i.test(errMember), errMember)

  const errMemberSelf = await asUser(db, carol, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, [carol]))
  )
  t.check('non-admin naming itself as actor denied', /permission denied/i.test(errMemberSelf), errMemberSelf)

  const errAnon = await asAnon(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, [admin]))
  )
  t.check('anonymous denied', /permission denied/i.test(errAnon), errAnon)

  const errAnonNoActor = await asAnon(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14)`))
  )
  t.check('anonymous denied without an actor too', /permission denied/i.test(errAnonNoActor), errAnonNoActor)

  const errServiceNoActor = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14)`))
  )
  t.check('service role cannot read analytics anonymously', /ADMIN_ONLY/i.test(errServiceNoActor), errServiceNoActor)

  const errServiceBadActor = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, [carol]))
  )
  t.check('service role cannot name a non-admin actor', /ADMIN_ONLY/i.test(errServiceBadActor), errServiceBadActor)

  const errServiceGhost = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, ['00000000-0000-0000-0000-000000000000']))
  )
  t.check('a fabricated admin id is refused', /ADMIN_ONLY/i.test(errServiceGhost), errServiceGhost)

  // Demoting the admin closes access immediately — no cached privilege.
  await db.query(`UPDATE public.profiles SET is_admin = FALSE WHERE id = $1`, [admin])
  const errDemoted = await asService(db, () =>
    expectError(() => db.query(`SELECT public.admin_analytics(14, $1)`, [admin]))
  )
  t.check('revoking profiles.is_admin closes analytics at once', /ADMIN_ONLY/i.test(errDemoted), errDemoted)
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])

  // =========================================================================
  console.log(' [4] the Admin → Analytics page really sends the acting admin')
  // =========================================================================
  // Source assertions (the convention already used by
  // audit-authorization.test.mjs): PGlite cannot render React, so the wiring is
  // asserted against the page source instead.
  const page = readFileSync(join(repoRoot, 'src/app/admin/analytics/page.tsx'), 'utf8')
  t.check(
    'page takes userId from requireAdminPage()',
    /const\s*\{\s*admin,\s*userId:\s*adminId\s*\}\s*=\s*await\s+requireAdminPage\(\)/.test(page),
    'requireAdminPage destructure'
  )
  t.check(
    'page passes p_admin_id to the RPC',
    /rpc\('admin_analytics',\s*\{\s*p_days:\s*days,\s*p_admin_id:\s*adminId\s*\}\)/.test(page),
    'admin_analytics rpc call'
  )
  t.check('page never invents an admin id', !/p_admin_id:\s*['"][0-9a-f-]{8,}/i.test(page))
  t.check('page still gates on requireAdminPage()', page.includes('await requireAdminPage()'))

  // =========================================================================
  console.log(' [5] date ranges actually modify the server-side query')
  // =========================================================================
  for (const days of [7, 14, 30, 90]) {
    const p = parse(await analyticsAsPanel(db, days, admin))
    t.equal(`${days}-day window_days`, p.window_days, days)
    t.equal(`${days}-day bucket count`, p.daily.days.length, days)
    for (const series of ['signups', 'revenue', 'interests', 'messages', 'searches', 'profile_views']) {
      t.equal(`${days}-day ${series} aligned with the axis`, p.daily[series].length, p.daily.days.length)
      t.check(
        `${days}-day ${series} is all real numbers`,
        p.daily[series].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0),
        p.daily[series]
      )
    }
  }
  const istToday = await scalar(
    db,
    `SELECT to_char(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS d`
  )
  const p90 = parse(await analyticsAsPanel(db, 90, admin))
  const p7 = parse(await analyticsAsPanel(db, 7, admin))
  t.equal('axis ends on the current IST day', p90.daily.days.at(-1), istToday)
  t.check(
    'the 90-day axis strictly contains the 7-day axis',
    p90.daily.days.length > p7.daily.days.length &&
      p90.daily.days.slice(-7).every((d, i) => d === p7.daily.days[i])
  )

  // =========================================================================
  console.log(' [6] real activity data, from authoritative tables only')
  // =========================================================================
  const fresh = parse(await analyticsAsPanel(db, 30, admin))

  t.equal('Total members comes from profiles', fresh.kpis.total_members, await scalar(db, `SELECT count(*)::int FROM public.profiles`))
  t.equal(
    'Paid members comes from live subscriptions',
    fresh.kpis.paid_members,
    await scalar(db, `SELECT count(DISTINCT user_id)::int FROM public.subscriptions WHERE status='active' AND expires_at > now()`)
  )
  t.equal(
    'Free members = total − paid (authoritative, no fabrication)',
    fresh.kpis.free_members,
    fresh.kpis.total_members - fresh.kpis.paid_members
  )
  t.equal('Free + paid = total', fresh.kpis.free_members + fresh.kpis.paid_members, fresh.kpis.total_members)
  t.equal(
    'Live profiles comes from matrimony_profiles',
    fresh.kpis.live_profiles,
    await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE status='active'`)
  )
  t.equal(
    'Verified profiles comes from matrimony_profiles.verified_at',
    fresh.kpis.verified_profiles,
    await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE verified_at IS NOT NULL`)
  )
  t.equal(
    'Hidden profiles comes from matrimony_profiles.status',
    fresh.kpis.hidden_profiles,
    await scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE status='hidden'`)
  )
  t.equal(
    'Active subscriptions comes from subscriptions',
    fresh.kpis.live_subscriptions,
    await scalar(db, `SELECT count(*)::int FROM public.subscriptions WHERE status='active' AND expires_at > now()`)
  )
  t.equal(
    'Open reports comes from reports',
    fresh.kpis.open_reports,
    await scalar(db, `SELECT count(*)::int FROM public.reports WHERE status IN ('open','reviewing')`)
  )

  // Revenue is the sum of CAPTURED payments only — never a guess.
  const capturedTotal = await scalar(
    db,
    `SELECT coalesce(sum(amount_inr),0)::int FROM public.payments WHERE status='captured'`
  )
  t.equal('all-time revenue = captured payments', fresh.kpis.revenue_total, capturedTotal)
  t.check('captured revenue is non-zero for the fixture', capturedTotal > 0, capturedTotal)
  const capturedWindow = await scalar(
    db,
    `SELECT coalesce(sum(amount_inr),0)::int FROM public.payments WHERE status='captured' AND updated_at >= now() - interval '30 days'`
  )
  t.equal('30-day revenue = captured payments in window', fresh.kpis.revenue_window, capturedWindow)

  // Interests really flowed, and analytics sees exactly what the table holds.
  t.equal(
    'interests_sent = interests rows',
    fresh.kpis.interests_sent,
    await scalar(db, `SELECT count(*)::int FROM public.interests WHERE created_at >= now() - interval '30 days'`)
  )
  t.check('the express_interest really happened', fresh.kpis.interests_sent >= 1, fresh.kpis.interests_sent)
  t.equal(
    'profile views = profile_views rows',
    fresh.kpis.profile_views,
    await scalar(db, `SELECT count(*)::int FROM public.profile_views WHERE viewed_at >= now() - interval '30 days'`)
  )
  t.check(
    'latest activity carries real events',
    fresh.latest_activity.length > 0 &&
      fresh.latest_activity.every((a) => typeof a.event === 'string' && a.event.length > 0),
    fresh.latest_activity.slice(0, 3)
  )
  t.check(
    'today\\u2019s signup bucket counts the fixture signups',
    fresh.daily.signups.at(-1) >= 4,
    fresh.daily.signups.at(-1)
  )
  t.equal(
    'signup bucket total matches profiles created today (IST)',
    fresh.daily.signups.reduce((a, b) => a + b, 0),
    await scalar(
      db,
      `SELECT count(*)::int FROM public.profiles
        WHERE created_at >= now() - interval '30 days'`
    )
  )

  // The package mix mirrors the subscriptions table.
  const activeSlugs = (
    await db.query(
      `SELECT coalesce(nullif(btrim(package_slug),''),'(unknown)') AS slug, count(*)::int AS n
       FROM public.subscriptions WHERE status='active' AND expires_at > now() GROUP BY 1 ORDER BY 1`
    )
  ).rows
  t.equal(
    'packages mix lists every live package slug',
    fresh.packages.map((p) => p.package_slug).sort(),
    activeSlugs.map((r) => r.slug).sort()
  )
  t.equal(
    'packages mix counts match subscriptions',
    fresh.packages.reduce((a, p) => a + p.active, 0),
    activeSlugs.reduce((a, r) => a + r.n, 0)
  )

  // =========================================================================
  console.log(' [7] empty datasets render as 0 — never hidden, never faked')
  // =========================================================================
  const emptyDbChecks = parse(await analyticsAsPanel(db, 1, admin))
  t.equal('1-day window is still a valid payload', emptyDbChecks.window_days, 1)
  t.equal('1-day axis has exactly one bucket', emptyDbChecks.daily.days.length, 1)
  // Metrics with no rows at all must be present and zero.
  for (const key of ['payments_refunded', 'payments_failed', 'moments_reported', 'verifications_rejected', 'subscriptions_expired', 'contact_reveals']) {
    t.check(`${key} is present and a number`, typeof emptyDbChecks.kpis[key] === 'number', emptyDbChecks.kpis[key])
  }
  t.equal('payments_refunded = 0 (none exist)', emptyDbChecks.kpis.payments_refunded, 0)
  t.equal('verifications_rejected = 0 (none exist)', emptyDbChecks.kpis.verifications_rejected, 0)
  t.equal('contact_reveals = 0 (none exist)', emptyDbChecks.kpis.contact_reveals, 0)
  // A metric being zero must not blank the rest of the payload.
  t.check('top_cities still returned when some are empty', Array.isArray(emptyDbChecks.top_cities))
  t.check('latest_activity still returned', Array.isArray(emptyDbChecks.latest_activity))

  // No fabricated values anywhere: every KPI is a finite non-negative number.
  const badKpis = Object.entries(emptyDbChecks.kpis).filter(
    ([, v]) => typeof v !== 'number' || !Number.isFinite(v) || v < 0
  )
  t.equal('every KPI is a finite, non-negative number', badKpis, [])
  t.check(
    'no KPI is suspiciously "round-marketing" fake (all derive from counts)',
    Object.keys(emptyDbChecks.kpis).length >= 30,
    Object.keys(emptyDbChecks.kpis).length
  )

  // =========================================================================
  console.log(' [8] security posture is intact')
  // =========================================================================
  const fn = await one(
    db,
    `SELECT p.oid, p.prosecdef, p.proconfig, p.proowner::regrole::text AS owner,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
            has_function_privilege('anon', p.oid, 'EXECUTE')            AS anon_exec,
            has_function_privilege('service_role', p.oid, 'EXECUTE')     AS svc_exec
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_analytics'`
  )
  t.check('admin_analytics is SECURITY DEFINER', fn.prosecdef === true, fn)
  t.check('admin_analytics pins search_path', (fn.proconfig ?? []).some((c) => c.startsWith('search_path=')), fn.proconfig)
  t.check('admin_analytics is NOT executable by authenticated', fn.auth_exec === false, fn)
  t.check('admin_analytics is NOT executable by anon', fn.anon_exec === false, fn)
  t.check('admin_analytics IS executable by service_role', fn.svc_exec === true, fn)
  t.equal('exactly one admin_analytics definition (no overloads)', await scalar(
    db,
    `SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_analytics'`
  ), 1)

  const body = await scalar(db, `SELECT prosrc FROM pg_proc WHERE oid = $1`, [fn.oid])
  t.check('the gate is admin_assert_actor (the shared authoritative check)', /admin_assert_actor\(p_admin_id\)/.test(body))
  t.check('the old is_admin()-only gate is gone', !/is_admin\(\) INTO v_is_admin/.test(body))
  t.check('no hard-coded admin email or user id in the function', !/[\w.+-]+@[\w-]+\.[\w.]+/.test(body) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i.test(body))

  // RLS on the underlying tables is unchanged — analytics works because the
  // function is SECURITY DEFINER, not because anything was opened up.
  for (const tbl of ['profiles', 'matrimony_profiles', 'subscriptions', 'payments', 'activity_events', 'reports', 'profile_views']) {
    t.equal(
      `RLS still enabled on ${tbl}`,
      await scalar(db, `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${tbl}'::regclass`),
      true
    )
  }
  const carolSeesPayments = await asUser(db, carol, () =>
    db.query(`SELECT id FROM public.payments WHERE user_id = $1`, [dave])
  )
  t.equal('RLS: a member still cannot read another member\\u2019s payments', carolSeesPayments.rows.length, 0)
  const carolSeesActivity = await asUser(db, carol, () =>
    db.query(`SELECT id FROM public.activity_events WHERE user_id = $1`, [dave])
  )
  t.equal('RLS: a member still cannot read another member\\u2019s activity', carolSeesActivity.rows.length, 0)

  // Analytics never leaks contact details or payment secrets.
  const raw = JSON.stringify(payload)
  t.check('no email addresses in the payload', !/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw))
  t.check('no razorpay secrets / signatures in the payload', !/razorpay_(signature|secret)|key_secret/i.test(raw))
  t.check('no raw mobile numbers in the payload', !/"\+?9[0-9]{9}"/.test(raw))

  return t
}
