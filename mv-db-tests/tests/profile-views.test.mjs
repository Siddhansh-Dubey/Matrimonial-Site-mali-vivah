// Profile-view ACCESS model — database-level assertions.
//
// Two distinct PRD capabilities are asserted separately:
//   • profile_views  → the aggregate COUNT, served by my_profile_view_stats()
//   • who_viewed_me  → the individual VISITOR LIST, served by SELECTing
//                      profile_views rows (RLS-gated)
//
// Plus the tracking rules that must survive this change: only ACTIVE_PAID,
// publicly-listed targets accumulate views; self-views, hidden/free/expired/
// suspended targets and blocked pairs never produce a row.
import {
  Checks,
  activatePackage,
  asService,
  asUser,
  completeProfile,
  one,
  scalar,
  signUp,
} from '../lib/harness.mjs'

let seq = 0

async function member(db, tag, pkgSlug) {
  seq += 1
  const id = await signUp(db, {
    email: `${tag}@example.com`,
    name: `Member ${tag}`,
    mobile: '9' + String(100000000 + seq).padStart(9, '0'),
  })
  await completeProfile(db, id)
  if (pkgSlug) await activatePackage(db, id, pkgSlug)
  return id
}

/** A view exactly as src/app/profile/[id]/page.tsx records it (as the viewer). */
const recordView = (db, viewerId, viewedId) =>
  asUser(db, viewerId, () =>
    db.query(`INSERT INTO public.profile_views (viewer_id, viewed_id) VALUES ($1, $2)`, [
      viewerId,
      viewedId,
    ])
  )

/** Ground truth, bypassing RLS. */
const storedViews = (db, viewedId) =>
  scalar(db, `SELECT count(*)::int AS n FROM public.profile_views WHERE viewed_id = $1`, [viewedId])

/** The member-facing count RPC. */
const stats = (db, userId) =>
  asUser(db, userId, () => scalar(db, `SELECT public.my_profile_view_stats() AS r`))

/** Raw rows the member can actually SELECT (the visitor list). */
const visibleRows = (db, userId) =>
  asUser(db, userId, () =>
    db
      .query(
        `SELECT id, viewer_id, viewed_at FROM public.profile_views WHERE viewed_id = $1 ORDER BY id`,
        [userId]
      )
      .then((r) => r.rows)
  )

/** A PostgREST-style bypass attempt: count(*) straight off the table. */
const clientCount = (db, userId) =>
  asUser(db, userId, () =>
    scalar(db, `SELECT count(*)::int AS n FROM public.profile_views WHERE viewed_id = $1`, [userId])
  )

const benefit = (db, userId, key) =>
  asUser(db, userId, () => scalar(db, `SELECT public.has_benefit($1) AS r`, [key]))

// ---------------------------------------------------------------------------
export default async function profileViewsSuite(db) {
  const t = new Checks('profile-views')

  // =========================================================================
  // 1. benefit maps — the source of truth
  // =========================================================================
  console.log(' [1] benefit maps')
  {
    const free = await one(db, `SELECT public.free_benefits() AS b`)
    t.equal('FREE does not grant profile_views (the count)', free.b.profile_views, false)
    t.equal('FREE does not grant who_viewed_me (the list)', free.b.who_viewed_me, false)

    const rows = await db
      .query(
        `SELECT slug, (public.free_benefits() || benefits) AS b
         FROM public.packages WHERE slug IN ('smart-3-month','premium-6-month','vip-12-month') ORDER BY slug`
      )
      .then((r) => r.rows)
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.b]))
    t.equal('Smart keeps the profile-view count', bySlug['smart-3-month'].profile_views, true)
    t.equal('Smart is NOT given who_viewed_me', bySlug['smart-3-month'].who_viewed_me, false)
    t.equal('Premium has the count', bySlug['premium-6-month'].profile_views, true)
    t.equal('Premium has who_viewed_me', bySlug['premium-6-month'].who_viewed_me, true)
    t.equal('VIP has the count', bySlug['vip-12-month'].profile_views, true)
    t.equal('VIP has who_viewed_me', bySlug['vip-12-month'].who_viewed_me, true)
  }

  // Cast of members. Targets accumulate views; viewers do the looking.
  const freeTarget = await member(db, 'pv-free', null)
  const smart = await member(db, 'pv-smart', 'smart-3-month')
  const premium = await member(db, 'pv-premium', 'premium-6-month')
  const vip = await member(db, 'pv-vip', 'vip-12-month')
  const viewerA = await member(db, 'pv-viewer-a', 'smart-3-month')
  const viewerB = await member(db, 'pv-viewer-b', 'premium-6-month')

  t.equal('free member: has_benefit(profile_views) = false', await benefit(db, freeTarget, 'profile_views'), false)
  t.equal('smart member: has_benefit(profile_views) = true', await benefit(db, smart, 'profile_views'), true)
  t.equal('smart member: has_benefit(who_viewed_me) = false', await benefit(db, smart, 'who_viewed_me'), false)
  t.equal('premium member: has_benefit(who_viewed_me) = true', await benefit(db, premium, 'who_viewed_me'), true)

  // =========================================================================
  // 2. tracking still works — ACTIVE_PAID public target accumulates views
  // =========================================================================
  console.log(' [2] tracking of a public ACTIVE_PAID target')
  {
    await recordView(db, viewerA, premium)
    await recordView(db, viewerB, premium)
    t.equal('two views recorded against the paid public target', await storedViews(db, premium), 2)
    const row = await one(
      db,
      `SELECT viewer_id, viewed_id, viewed_at FROM public.profile_views WHERE viewed_id = $1 ORDER BY id LIMIT 1`,
      [premium]
    )
    t.equal('row records the viewer id', row.viewer_id, viewerA)
    t.equal('row records the viewed profile id', row.viewed_id, premium)
    t.check('row records a timestamp', row.viewed_at instanceof Date || typeof row.viewed_at === 'string', row.viewed_at)
    const notif = await scalar(
      db,
      `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND type = 'profile_viewed'`,
      [premium]
    )
    t.check('the existing "someone viewed you" notification still fires', notif >= 1, notif)
  }

  // =========================================================================
  // 3. tracking guards are intact
  // =========================================================================
  console.log(' [3] tracking guards (self / non-public / blocked)')
  {
    // Self-view: the guard drops it before the CHECK constraint can complain.
    await asUser(db, smart, () =>
      db.query(`INSERT INTO public.profile_views (viewer_id, viewed_id) VALUES ($1, $1)`, [smart])
        .catch(() => undefined)
    )
    t.equal('self-view is not counted', await storedViews(db, smart), 0)

    // Free (never-paid, not publicly listed) target.
    await recordView(db, viewerA, freeTarget)
    t.equal('viewing a FREE target creates no view', await storedViews(db, freeTarget), 0)

    // Hidden target: paid, but the owner hid the profile.
    const hidden = await member(db, 'pv-hidden', 'premium-6-month')
    await db.query(`UPDATE public.matrimony_profiles SET status = 'hidden' WHERE user_id = $1`, [hidden])
    await recordView(db, viewerA, hidden)
    t.equal('viewing a HIDDEN target creates no view', await storedViews(db, hidden), 0)

    // Suspended target.
    const suspended = await member(db, 'pv-susp', 'premium-6-month')
    await db.query(`UPDATE public.matrimony_profiles SET status = 'suspended' WHERE user_id = $1`, [suspended])
    await recordView(db, viewerA, suspended)
    t.equal('viewing a SUSPENDED target creates no view', await storedViews(db, suspended), 0)

    // Expired membership target (status flipped by the expiry sweep).
    const expired = await member(db, 'pv-expired', 'premium-6-month')
    await db.query(
      `UPDATE public.subscriptions SET started_at = started_at - interval '400 days', expires_at = now() - interval '1 day' WHERE user_id = $1`,
      [expired]
    )
    await asService(db, () => scalar(db, `SELECT public.sweep_expired_memberships() AS r`))
    await recordView(db, viewerA, expired)
    t.equal('viewing an EXPIRED target creates no view', await storedViews(db, expired), 0)

    // Blocked pair.
    const blockedTarget = await member(db, 'pv-blocked', 'premium-6-month')
    await asUser(db, blockedTarget, () =>
      db.query(`INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [blockedTarget, viewerA])
    )
    await recordView(db, viewerA, blockedTarget)
    t.equal('a blocked pair creates no view', await storedViews(db, blockedTarget), 0)
  }

  // Give every tier some real views to read back.
  await recordView(db, viewerA, smart)
  await recordView(db, viewerB, smart)
  await recordView(db, viewerA, vip)
  t.equal('smart target accumulated views', await storedViews(db, smart), 2)
  t.equal('vip target accumulated views', await storedViews(db, vip), 1)

  // =========================================================================
  // 4. the COUNT capability (profile_views)
  // =========================================================================
  console.log(' [4] profile-view COUNT (profile_views benefit)')
  {
    const free = await stats(db, freeTarget)
    t.equal('free member: allowed = false', free.allowed, false)
    t.equal('free member: no total is returned', free.total, null)
    t.equal('free member: no 30-day figure is returned', free.last_30_days, null)
    t.equal('free member: no last-viewed timestamp is returned', free.last_viewed_at, null)
    t.equal('free member: who_viewed_me = false', free.who_viewed_me, false)

    const s = await stats(db, smart)
    t.equal('smart member: allowed = true', s.allowed, true)
    t.equal('smart member: real count returned', s.total, 2)
    t.equal('smart member: 30-day count returned', s.last_30_days, 2)
    t.check('smart member: last_viewed_at present', Boolean(s.last_viewed_at), s.last_viewed_at)
    t.equal('smart member: who_viewed_me still false', s.who_viewed_me, false)

    const p = await stats(db, premium)
    t.equal('premium member: count returned', p.total, 2)
    t.equal('premium member: who_viewed_me true', p.who_viewed_me, true)

    const v = await stats(db, vip)
    t.equal('vip member: count returned', v.total, 1)

    // A paid member with zero views gets 0 — not a lock.
    const quiet = await member(db, 'pv-quiet', 'smart-3-month')
    const q = await stats(db, quiet)
    t.check('paid member with no views: allowed with total 0', q.allowed === true && q.total === 0, q)

    // The RPC always reports on auth.uid() — it takes no target parameter.
    const noArg = await scalar(
      db,
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'my_profile_view_stats' AND pronargs = 0`
    )
    t.equal('my_profile_view_stats() accepts no user parameter', noArg, 1)
  }

  // =========================================================================
  // 5. bypass attempts — the count must not be reachable off the table
  // =========================================================================
  console.log(' [5] direct client access cannot bypass the gate')
  {
    t.equal('free member counting rows directly gets 0', await clientCount(db, freeTarget), 0)
    // freeTarget has no stored views at all; use a member who HAS views but no benefit.
    const smartRows = await clientCount(db, smart)
    t.equal('smart member (count benefit, no who_viewed_me) reads no raw rows', smartRows, 0)
    t.equal('...although the rows really exist', await storedViews(db, smart), 2)

    // A member can never read someone else's rows, whatever their plan.
    const cross = await asUser(db, premium, () =>
      scalar(db, `SELECT count(*)::int AS n FROM public.profile_views WHERE viewed_id = $1`, [vip])
    )
    t.equal('premium member cannot read another member\u2019s view rows', cross, 0)

    const anonExec = await scalar(
      db,
      `SELECT has_function_privilege('anon', 'public.my_profile_view_stats()', 'EXECUTE') AS r`
    )
    t.equal('anon cannot execute my_profile_view_stats()', anonExec, false)
  }

  // =========================================================================
  // 6. the VISITOR LIST capability (who_viewed_me)
  // =========================================================================
  console.log(' [6] who viewed me (who_viewed_me benefit)')
  {
    t.equal('free member sees no visitors', (await visibleRows(db, freeTarget)).length, 0)
    t.equal('smart (no who_viewed_me) sees no visitors', (await visibleRows(db, smart)).length, 0)

    const prem = await visibleRows(db, premium)
    t.equal('premium sees their visitors', prem.length, 2)
    t.check(
      'premium visitor rows carry viewer id + timestamp',
      prem.every((r) => r.viewer_id && r.viewed_at),
      prem
    )
    t.equal('vip sees their visitors', (await visibleRows(db, vip)).length, 1)

    // Losing the plan loses the list immediately (time-aware benefit).
    await db.query(
      `UPDATE public.subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = $1`,
      [premium]
    )
    t.equal('an expired plan can no longer read visitors', (await visibleRows(db, premium)).length, 0)
    const lapsed = await stats(db, premium)
    t.check('an expired plan can no longer read the count', lapsed.allowed === false && lapsed.total === null, lapsed)
  }

  // =========================================================================
  // 7. tracking keeps working for members who cannot READ view data
  // =========================================================================
  console.log(' [7] free members still record views they make')
  {
    const freeViewer = await member(db, 'pv-freeviewer', null)
    const before = await storedViews(db, vip)
    await recordView(db, freeViewer, vip)
    t.equal('a FREE viewer still generates a tracked view on a paid target', await storedViews(db, vip), before + 1)
    const row = await one(
      db,
      `SELECT viewer_id FROM public.profile_views WHERE viewed_id = $1 ORDER BY id DESC LIMIT 1`,
      [vip]
    )
    t.equal('...attributed to the free viewer', row.viewer_id, freeViewer)
  }

  return t
}
