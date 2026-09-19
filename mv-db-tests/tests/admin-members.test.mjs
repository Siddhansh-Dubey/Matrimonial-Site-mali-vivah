// Step 7 — Admin Members / User Management: database-level assertions.
//
// Every admin action of the Members module is authoritative in the database
// (admin_* RPCs, service role only). This suite proves, against the real
// migrations running in PGlite:
//   • server-side list filters, approve within the existing status model,
//     allow-listed edits that keep the community hierarchy valid and keep
//     business_name separate from company,
//   • suspend / hide remove a profile from search, Daily 5, featured and
//     interest without destroying membership data, and unsuspend / unhide /
//     reactivate restore the TRUTHFUL state (paid → active, free → hidden,
//     lapsed → expired, draft → draft) — never bypassing payment or the
//     publish gate,
//   • deletion needs a deliberate confirmation, is self-protected, cascades
//     consistently and leaves the audit trail behind,
//   • verify / feature / boost / manual activation keep their single meaning,
//   • non-admins are refused, and every state change writes an
//     admin_audit_log row + a scrubbed activity event.
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

let seq = 0
async function member(db, tag, { gender = 'male', complete = true, paid = null, name } = {}) {
  seq += 1
  const id = await signUp(db, {
    email: `${tag}${seq}@example.com`,
    name: name ?? `${tag[0].toUpperCase()}${tag.slice(1)} ${seq}`,
    mobile: `9${String(100000000 + seq).padStart(9, '0')}`,
  })
  if (complete) await completeProfile(db, id, { gender })
  if (paid) await activatePackage(db, id, paid)
  return id
}

const svc = (db, sql, params) => asService(db, () => scalar(db, sql, params))
const status = (db, id) => scalar(db, `SELECT status::text AS s FROM public.matrimony_profiles WHERE user_id = $1`, [id])
const isPublic = (db, id) => scalar(db, `SELECT public.is_profile_public($1) AS p`, [id])
const state = (db, id) => svc(db, `SELECT public.admin_member_state($1) AS s`, [id])
const mpRow = (db, id) => one(db, `SELECT * FROM public.matrimony_profiles WHERE user_id = $1`, [id])

const suspend = (db, id, admin, on = true, reason = null) =>
  svc(db, `SELECT public.admin_set_profile_suspended($1, $2, $3, $4) AS r`, [id, on, admin, reason])
const hide = (db, id, admin, on = true, reason = null) =>
  svc(db, `SELECT public.admin_set_profile_hidden($1, $2, $3, $4) AS r`, [id, on, admin, reason])
const reactivate = (db, id, admin) => svc(db, `SELECT public.admin_reactivate_profile($1, $2) AS r`, [id, admin])
const approve = (db, id, admin) => svc(db, `SELECT public.admin_approve_profile($1, $2) AS r`, [id, admin])
const reject = (db, id, admin, note) => svc(db, `SELECT public.admin_reject_profile($1, $2, $3) AS r`, [id, admin, note])
const edit = (db, id, admin, profile = {}, prefs = {}) =>
  svc(db, `SELECT public.admin_update_member_profile($1, $2, $3::jsonb, $4::jsonb) AS r`, [
    id, admin, JSON.stringify(profile), JSON.stringify(prefs),
  ])
const prepareDelete = (db, id, admin, email, reason = null) =>
  svc(db, `SELECT public.admin_prepare_member_deletion($1, $2, $3, $4) AS r`, [id, admin, email, reason])
const list = (db, args = {}) =>
  svc(
    db,
    `SELECT public.admin_list_members(
       p_q => $1, p_status => $2, p_paid => $3, p_verified => $4, p_featured => $5,
       p_city => $6, p_package => $7, p_limit => $8, p_offset => $9) AS r`,
    [args.q ?? null, args.status ?? null, args.paid ?? null, args.verified ?? null, args.featured ?? null,
     args.city ?? null, args.package ?? null, args.limit ?? 200, args.offset ?? 0]
  )
const listIds = async (db, args) => ((await list(db, args))?.rows ?? []).map((r) => r.id)

const search = (db, viewerId, lookingFor = 'female') =>
  asUser(db, viewerId, () =>
    scalar(db, `SELECT public.search_matches(p_looking_for => $1::public.gender, p_min_age => 18, p_max_age => 60, p_limit => 200) AS r`, [lookingFor])
  )
const searchIds = async (db, viewerId, lookingFor) => ((await search(db, viewerId, lookingFor)) ?? []).map((c) => c.user_id)
const dailyIds = async (db, viewerId) => {
  const r = await asUser(db, viewerId, () => scalar(db, `SELECT public.get_daily_matches(25) AS r`))
  const arr = Array.isArray(r) ? r : (r?.matches ?? [])
  return arr.map((c) => c.user_id)
}
const featuredIds = async (db) => ((await scalar(db, `SELECT public.get_featured_profiles(50) AS r`)) ?? []).map((c) => c.user_id)

const auditCount = (db, id, action) =>
  scalar(db, `SELECT count(*)::int AS n FROM public.admin_audit_log WHERE target_id = $1 AND action = $2`, [id, action])
const eventCount = (db, id, event) =>
  scalar(db, `SELECT count(*)::int AS n FROM public.activity_events WHERE user_id = $1 AND event = $2`, [id, event])
const lastEventMeta = (db, id, event) =>
  scalar(db, `SELECT metadata FROM public.activity_events WHERE user_id = $1 AND event = $2 ORDER BY id DESC LIMIT 1`, [id, event])

async function expireMembership(db, id) {
  await db.query(
    `UPDATE public.subscriptions SET started_at = now() - interval '200 days', expires_at = now() - interval '1 day' WHERE user_id = $1`,
    [id]
  )
  await asService(db, () => db.query(`SELECT public.sweep_expired_memberships()`))
}

/* ------------------------------------------------------------------------ */

export default async function adminMembersSuite(db) {
  const t = new Checks('admin-members')
  await db.query(`UPDATE public.profile_boost_config SET duration_days = 5, price_inr = 499, is_active = TRUE WHERE id = 1`)
  await db.query(`UPDATE public.matching_config SET threshold = 0`)

  const admin = await member(db, 'admin', { gender: 'female', name: 'Admin One' })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin])
  const admin2 = await member(db, 'admintwo', { gender: 'female', name: 'Admin Two' })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [admin2])

  // A paid male viewer who searches for brides + a paid female who searches grooms.
  const viewer = await member(db, 'viewer', { paid: 'premium-6-month', name: 'Viewer Groom' })
  const viewerF = await member(db, 'viewerf', { gender: 'female', paid: 'premium-6-month', name: 'Viewer Bride' })

  // =========================================================================
  console.log(' [1] server-side list filters')
  // =========================================================================
  {
    const paidF = await member(db, 'listpaid', { gender: 'female', paid: 'smart-3-month', name: 'Lista Paid' })
    const freeF = await member(db, 'listfree', { gender: 'female', name: 'Listb Free' })
    await db.query(`UPDATE public.matrimony_profiles SET city = 'Nashik', verified_at = now() WHERE user_id = $1`, [freeF])
    await db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 1)`, [paidF])
    const expiredF = await member(db, 'listexp', { gender: 'female', paid: 'smart-3-month', name: 'Listc Expired' })
    await expireMembership(db, expiredF)

    const all = await list(db)
    t.check('list returns total + rows', typeof all.total === 'number' && Array.isArray(all.rows), all)
    t.check('list rows carry contact + state columns',
      all.rows.every((r) => 'email' in r && 'status' in r && 'is_paid' in r && 'featured' in r), all.rows[0])

    const byName = await listIds(db, { q: 'Lista' })
    t.equal('search by name', byName, [paidF])
    t.equal('search by email', await listIds(db, { q: `listfree${seq - 1}@` }), [freeF])
    t.equal('search by UUID', await listIds(db, { q: expiredF }), [expiredF])
    const byMobile = await listIds(db, { q: (await one(db, `SELECT mobile FROM public.profiles WHERE id = $1`, [paidF])).mobile })
    t.equal('search by mobile', byMobile, [paidF])

    const paid = await listIds(db, { paid: 'paid' })
    t.check('paid filter includes live plan, excludes free + expired', paid.includes(paidF) && !paid.includes(freeF) && !paid.includes(expiredF))
    const free = await listIds(db, { paid: 'free' })
    t.check('free filter = never paid', free.includes(freeF) && !free.includes(paidF) && !free.includes(expiredF))
    const expired = await listIds(db, { paid: 'expired' })
    t.check('expired filter = paid before, no live plan', expired.includes(expiredF) && !expired.includes(paidF) && !expired.includes(freeF))
    const verified = await listIds(db, { verified: 'verified' })
    t.check('verified filter', verified.includes(freeF) && !verified.includes(paidF))
    const featured = await listIds(db, { featured: 'featured' })
    t.equal('featured filter', featured, [paidF])
    const city = await listIds(db, { city: 'nashik' })
    t.equal('city filter (case-insensitive)', city, [freeF])
    const pkg = await listIds(db, { package: 'smart-3-month' })
    t.check('package filter (live plan only)', pkg.includes(paidF) && !pkg.includes(expiredF))
    const st = await listIds(db, { status: 'expired' })
    t.check('status filter', st.includes(expiredF) && !st.includes(paidF))
    const pub = await listIds(db, { status: 'public' })
    t.check('"public" filter uses is_profile_public', pub.includes(paidF) && !pub.includes(freeF) && !pub.includes(expiredF))
    const page = await list(db, { limit: 2, offset: 0 })
    t.check('paging respects limit', page.rows.length === 2 && page.total > 2, { n: page.rows.length, total: page.total })
    const bad = await expectError(() => list(db, { status: 'nonsense' }))
    t.check('unknown status filter is rejected', /INVALID_FILTER/.test(bad), bad)
  }

  // =========================================================================
  console.log(' [2] approve within the existing status model')
  // =========================================================================
  {
    const draftFree = await member(db, 'apprfree', { gender: 'female' })
    t.equal('complete draft starts as draft', await status(db, draftFree), 'draft')
    const r = await approve(db, draftFree, admin)
    t.equal('free approval → hidden (APPROVED_FREE)', r.status, 'hidden')
    t.equal('free approval does NOT create a membership', await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1`, [draftFree]), 0)
    t.equal('approved free profile is not public', await isPublic(db, draftFree), false)
    t.equal('approved free profile is not paid', (await state(db, draftFree)).live_membership, false)
    t.equal('approve audit row', await auditCount(db, draftFree, 'admin_member_approved'), 1)
    t.equal('approve activity event', await eventCount(db, draftFree, 'admin_member_approved'), 1)

    const again = await expectError(() => approve(db, draftFree, admin))
    t.check('approving an already approved profile is refused', /APPROVE_NOT_APPLICABLE/.test(again), again)

    // Paid + complete draft → active (through the publish gate)
    const draftPaid = await member(db, 'apprpaid', { gender: 'female' })
    await db.query(`UPDATE public.matrimony_profiles SET status = 'draft' WHERE user_id = $1`, [draftPaid])
    await activatePackage(db, draftPaid, 'smart-3-month')
    await db.query(`UPDATE public.matrimony_profiles SET status = 'pending_review' WHERE user_id = $1`, [draftPaid])
    const rp = await approve(db, draftPaid, admin)
    t.equal('paid approval → active', rp.status, 'active')
    t.equal('paid approved profile is public', await isPublic(db, draftPaid), true)

    // Incomplete draft → refused with the checklist
    const incomplete = await member(db, 'apprinc', { gender: 'female', complete: false })
    const e = await expectError(() => approve(db, incomplete, admin))
    t.check('incomplete profile cannot be approved', /PROFILE_INCOMPLETE/.test(e), e)
    t.equal('incomplete profile stays draft', await status(db, incomplete), 'draft')

    // Reject → rejected + note delivered, then approve again works
    const rr = await reject(db, draftPaid, admin, 'Please upload a clearer profile photo.')
    t.equal('reject → rejected', rr.status, 'rejected')
    t.equal('rejected profile is not public', await isPublic(db, draftPaid), false)
    const note = await scalar(db, `SELECT message FROM public.notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [draftPaid])
    t.check('reject note reaches the member', /clearer profile photo/.test(note ?? ''), note)
    const noNote = await expectError(() => reject(db, draftFree, admin, '   '))
    t.check('reject requires a note', /NOTE_REQUIRED/.test(noNote), noNote)
    t.equal('re-approve after reject → active (paid)', (await approve(db, draftPaid, admin)).status, 'active')
  }

  // =========================================================================
  console.log(' [3] edit: allow-list, community hierarchy, business_name ≠ company')
  // =========================================================================
  {
    const u = await member(db, 'edit', { gender: 'female', paid: 'smart-3-month' })
    const subs = await db.query(`SELECT sc.id, sc.name, sc.community_id FROM public.sub_communities sc WHERE sc.is_active ORDER BY sc.sort_order, sc.name`)
    const [subA, subB] = subs.rows
    const otherCommunity = await one(db, `INSERT INTO public.communities (slug, name, is_active, sort_order) VALUES ('test-other', 'Other Test Community', TRUE, 99) RETURNING id`)
    const foreignSub = await one(db, `INSERT INTO public.sub_communities (community_id, slug, name, is_active, sort_order) VALUES ($1, 'foreign-sub', 'Foreign Sub', TRUE, 1) RETURNING id`, [otherCommunity.id])

    const r = await edit(db, u, admin,
      { business_name: 'Patil Nursery', company: 'Infosys', smoking: 'occasionally', drinking: 'never', family_type: 'nuclear', father_occupation: 'Farmer', full_name: 'Edited Name', sub_community_id: subA.id },
      { min_age: 24, max_age: 30, preferred_cities: ['Pune', 'Nashik'], preferred_diet: 'vegetarian' })
    t.equal('edit reports changed', r.changed, true)
    const row = await mpRow(db, u)
    t.equal('business_name saved', row.business_name, 'Patil Nursery')
    t.equal('company saved separately', row.company, 'Infosys')
    t.equal('lifestyle enum saved', row.smoking, 'occasionally')
    t.equal('family fields saved', [row.family_type, row.father_occupation], ['nuclear', 'Farmer'])
    t.equal('community derived from sub-community', row.community_id, subA.community_id)
    t.equal('legacy sub_community text synced by the hierarchy trigger', row.sub_community, subA.name)
    t.equal('full_name saved on profiles', await scalar(db, `SELECT full_name FROM public.profiles WHERE id = $1`, [u]), 'Edited Name')
    const pp = await one(db, `SELECT * FROM public.partner_preferences WHERE profile_id = $1`, [u])
    t.equal('partner preferences saved', [pp.min_age, pp.max_age, pp.preferred_cities], [24, 30, ['Pune', 'Nashik']])
    t.equal('edit keeps status', row.status, 'active')
    t.equal('edit audit row lists field names', (await one(db, `SELECT details FROM public.admin_audit_log WHERE target_id = $1 AND action = 'admin_member_edited' ORDER BY id DESC LIMIT 1`, [u])).details.fields.includes('business_name'), true)
    const meta = await lastEventMeta(db, u, 'admin_member_edited')
    t.check('edit activity metadata carries field names, never values', JSON.stringify(meta).includes('business_name') && !JSON.stringify(meta).includes('Patil Nursery'), meta)

    // Clearing business_name never touches company
    await edit(db, u, admin, { business_name: '' })
    const row2 = await mpRow(db, u)
    t.equal('blank business_name → NULL, company untouched', [row2.business_name, row2.company], [null, 'Infosys'])

    // Hierarchy integrity: a sub-community from another community cannot be paired
    const mismatch = await expectError(() => edit(db, u, admin, { community_id: subA.community_id, sub_community_id: foreignSub.id }))
    t.check('mismatched community/sub-community is rejected', /COMMUNITY_MISMATCH/.test(mismatch), mismatch)
    t.equal('row unchanged after rejected edit', (await mpRow(db, u)).sub_community_id, subA.id)
    if (subB) {
      await edit(db, u, admin, { sub_community_id: subB.id })
      const row3 = await mpRow(db, u)
      t.equal('switching sub-community keeps pair consistent', [row3.community_id, row3.sub_community], [subB.community_id, subB.name])
    }

    // Allow-list: protected columns are refused, not silently ignored
    for (const bad of [{ status: 'active' }, { verified_at: new Date().toISOString() }, { privacy_settings: {} }, { admin_hidden_at: null }, { user_id: admin }, { whatsapp_opt_in: true }]) {
      const e = await expectError(() => edit(db, u, admin, bad))
      t.check(`edit refuses ${Object.keys(bad)[0]}`, /FIELD_NOT_EDITABLE/.test(e), e)
    }
    const badPref = await expectError(() => edit(db, u, admin, {}, { profile_id: admin }))
    t.check('edit refuses foreign preference keys', /FIELD_NOT_EDITABLE/.test(badPref), badPref)
    const badEnum = await expectError(() => edit(db, u, admin, { smoking: 'sometimes' }))
    t.check('invalid enum value is rejected by the type', /invalid input value/.test(badEnum), badEnum)
    t.equal('no-op edit reports unchanged', (await edit(db, u, admin, {}, {})).changed, false)
  }

  // =========================================================================
  console.log(' [4] suspend removes from every public surface; membership data survives')
  // =========================================================================
  const bride = await member(db, 'bride', { gender: 'female', paid: 'premium-6-month', name: 'Bride Paid' })
  {
    await db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 2)`, [bride])
    t.check('baseline: paid bride is public', await isPublic(db, bride))
    t.check('baseline: in search', (await searchIds(db, viewer)).includes(bride))
    t.check('baseline: in Daily 5', (await dailyIds(db, viewer)).includes(bride))
    t.check('baseline: in featured', (await featuredIds(db)).includes(bride))

    const r = await suspend(db, bride, admin, true, 'multiple reports')
    t.equal('suspend → suspended', r.status, 'suspended')
    t.equal('suspend remembers prior status', (await mpRow(db, bride)).status_before_suspension, 'active')
    t.equal('suspended is not public', await isPublic(db, bride), false)
    t.check('suspended not in search', !(await searchIds(db, viewer)).includes(bride))
    t.check('suspended not in Daily 5', !(await dailyIds(db, viewer)).includes(bride))
    t.check('suspended not in featured', !(await featuredIds(db)).includes(bride))
    const interest = await asUser(db, viewer, () => expectError(() => db.query(`SELECT public.express_interest($1, NULL)`, [bride])))
    t.check('cannot express interest to a suspended profile', /TARGET_UNAVAILABLE/.test(interest), interest)
    const seen = await asUser(db, viewer, () => scalar(db, `SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE user_id = $1`, [bride]))
    t.equal('RLS: other members cannot read the suspended row', seen, 0)
    t.equal('subscription data untouched by suspension', await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1 AND status = 'active'`, [bride]), 1)
    t.equal('suspend audit row carries the reason', (await one(db, `SELECT details FROM public.admin_audit_log WHERE target_id = $1 AND action = 'admin_member_suspended'`, [bride])).details.reason, 'multiple reports')
    const meta = await lastEventMeta(db, bride, 'admin_member_suspended')
    t.check('suspend activity metadata has no reason / admin id', meta && !('reason' in meta) && !('admin_id' in meta), meta)
    t.equal('suspend is idempotent', (await suspend(db, bride, admin, true)).changed, false)
    t.equal('member notified about suspension', await scalar(db, `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND title ILIKE '%suspended%'`, [bride]), 1)
  }

  // =========================================================================
  console.log(' [5] unsuspend restores the truthful state')
  // =========================================================================
  {
    // paid → active
    const r = await suspend(db, bride, admin, false)
    t.equal('paid member → active on unsuspend', r.status, 'active')
    t.check('paid member public again', await isPublic(db, bride))
    t.check('back in search', (await searchIds(db, viewer)).includes(bride))
    t.equal('suspension bookkeeping cleared', (await mpRow(db, bride)).suspended_at, null)
    t.equal('unsuspend audit row', await auditCount(db, bride, 'admin_member_unsuspended'), 1)
    t.equal('unsuspend activity event', await eventCount(db, bride, 'admin_member_unsuspended'), 1)

    // free (approved) → hidden, never active
    const freeB = await member(db, 'freeb', { gender: 'female' })
    await approve(db, freeB, admin)
    await suspend(db, freeB, admin)
    const rf = await suspend(db, freeB, admin, false)
    t.equal('free member → hidden (APPROVED_FREE) on unsuspend', rf.status, 'hidden')
    t.equal('free member still not public', await isPublic(db, freeB), false)
    t.equal('free member got no membership', await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1`, [freeB]), 0)

    // lapsed → expired
    const lapsed = await member(db, 'lapsed', { gender: 'female', paid: 'smart-3-month' })
    await suspend(db, lapsed, admin)
    await expireMembership(db, lapsed)
    const rl = await suspend(db, lapsed, admin, false)
    t.equal('lapsed member → expired on unsuspend', rl.status, 'expired')
    t.equal('lapsed member not public', await isPublic(db, lapsed), false)

    // never published draft → draft
    const draft = await member(db, 'draftsus', { gender: 'female' })
    await suspend(db, draft, admin)
    const rd = await suspend(db, draft, admin, false)
    t.equal('draft → draft on unsuspend', rd.status, 'draft')

    // paid but a photo was removed while suspended → publish gate refuses → hidden, not stuck suspended
    const broken = await member(db, 'broken', { gender: 'female', paid: 'smart-3-month' })
    await suspend(db, broken, admin)
    await db.query(`DELETE FROM public.profile_photos WHERE profile_id = $1 AND kind = 'family_photo'`, [broken])
    const rb = await suspend(db, broken, admin, false)
    t.equal('paid + incomplete → hidden (gate refused) instead of staying suspended', rb.status, 'hidden')
    t.check('gate message recorded', /PROFILE_INCOMPLETE/.test(rb.publish_note ?? ''), rb.publish_note)

    // payment during suspension does NOT unsuspend; unsuspend then publishes
    const payWhile = await member(db, 'paywhile', { gender: 'female' })
    await approve(db, payWhile, admin)
    await suspend(db, payWhile, admin)
    const act = await activatePackage(db, payWhile, 'smart-3-month')
    t.equal('manual activation while suspended keeps status suspended', await status(db, payWhile), 'suspended')
    t.check('…but the subscription was created', act.r.subscription_id != null, act.r)
    t.equal('unsuspend after payment → active', (await suspend(db, payWhile, admin, false)).status, 'active')
  }

  // =========================================================================
  console.log(' [6] admin hold (hide) is distinct from suspension and destroys nothing')
  // =========================================================================
  {
    const before = await one(db, `SELECT status, verified_at FROM public.matrimony_profiles WHERE user_id = $1`, [bride])
    const r = await hide(db, bride, admin, true, 'investigating a report')
    t.equal('hide sets the hold flag', r.admin_hidden, true)
    const row = await mpRow(db, bride)
    t.equal('hide keeps status', row.status, before.status)
    t.check('hide records who/when/why (admin-only columns)', row.admin_hidden_by === admin && row.admin_hidden_at && row.admin_hidden_reason === 'investigating a report')
    t.equal('hidden profile is not public', await isPublic(db, bride), false)
    t.check('hidden not in search', !(await searchIds(db, viewer)).includes(bride))
    t.check('hidden not in Daily 5', !(await dailyIds(db, viewer)).includes(bride))
    t.check('hidden not in featured', !(await featuredIds(db)).includes(bride))
    const seen = await asUser(db, viewer, () => scalar(db, `SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE user_id = $1`, [bride]))
    t.equal('RLS: other members cannot read a hidden row', seen, 0)
    const seenPhotos = await asUser(db, viewer, () => scalar(db, `SELECT count(*)::int AS n FROM public.profile_photos WHERE profile_id = $1`, [bride]))
    t.equal('RLS: other members cannot read a hidden profile\u2019s photos', seenPhotos, 0)
    const own = await asUser(db, bride, () => scalar(db, `SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE user_id = $1`, [bride]))
    t.equal('owner still reads their own hidden row', own, 1)
    t.equal('membership survives the hold', await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1 AND status = 'active' AND expires_at > now()`, [bride]), 1)
    t.equal('featured row survives the hold (auto-suppressed while not public)', await scalar(db, `SELECT count(*)::int AS n FROM public.featured_profiles WHERE profile_id = $1`, [bride]), 1)
    const vis = await asUser(db, bride, () => scalar(db, `SELECT public.profile_visibility_reason() AS v`))
    t.equal('member sees the admin_hidden reason', vis.reason, 'admin_hidden')
    t.check('member-facing copy contains no internal reason', !JSON.stringify(vis).includes('investigating'), vis)
    t.equal('admin_member_state distinguishes hold from suspension', [(await state(db, bride)).admin_hidden, (await state(db, bride)).suspended], [true, false])
    const meta = await lastEventMeta(db, bride, 'admin_member_hidden')
    t.check('hide activity metadata has no reason', meta && !('reason' in meta), meta)
    t.equal('hide audit row', await auditCount(db, bride, 'admin_member_hidden'), 1)

    // Suspending while on hold: suspension wins in the reason; both flags visible to admin
    await suspend(db, bride, admin)
    t.equal('suspended + hidden → member sees suspended', (await state(db, bride)).visibility.reason, 'suspended')
    await suspend(db, bride, admin, false)
    t.equal('unsuspend alone does not lift the hold', (await mpRow(db, bride)).admin_hidden_at !== null, true)
    t.equal('still not public while hold remains', await isPublic(db, bride), false)

    // Unhide → public again (paid)
    const u = await hide(db, bride, admin, false)
    t.equal('unhide clears the hold', u.admin_hidden, false)
    t.check('paid member public again after unhide', await isPublic(db, bride))
    t.check('back in featured after unhide', (await featuredIds(db)).includes(bride))
    t.equal('unhide audit row', await auditCount(db, bride, 'admin_member_unhidden'), 1)
    t.equal('unhide is idempotent', (await hide(db, bride, admin, false)).changed, false)

    // Free member on hold: unhide → still hidden (free), status unchanged
    const freeH = await member(db, 'freehold', { gender: 'female' })
    await approve(db, freeH, admin)
    await hide(db, freeH, admin)
    await hide(db, freeH, admin, false)
    t.equal('free member stays hidden/free after unhide', [await status(db, freeH), await isPublic(db, freeH)], ['hidden', false])

    // Payment while on hold does not make the profile public
    const payHold = await member(db, 'payhold', { gender: 'female' })
    await approve(db, payHold, admin)
    await hide(db, payHold, admin)
    await activatePackage(db, payHold, 'smart-3-month')
    t.equal('payment flips status to active…', await status(db, payHold), 'active')
    t.equal('…but the admin hold still keeps it private', await isPublic(db, payHold), false)
    await hide(db, payHold, admin, false)
    t.check('public once the hold is lifted', await isPublic(db, payHold))
  }

  // =========================================================================
  console.log(' [7] reactivate is state-aware and never bypasses payment or completion')
  // =========================================================================
  {
    // suspended paid → active
    await suspend(db, bride, admin)
    await hide(db, bride, admin)
    const r = await reactivate(db, bride, admin)
    t.equal('suspended + held paid member → active', r.status, 'active')
    t.equal('reactivate lists what it lifted', [...r.changes].sort(), ['admin_hold_lifted', 'suspension_lifted'])
    t.check('public after reactivate', await isPublic(db, bride))
    t.equal('reactivate audit row', await auditCount(db, bride, 'admin_member_reactivated'), 1)
    t.equal('reactivate activity event', await eventCount(db, bride, 'admin_member_reactivated') >= 1, true)

    // suspended free → hidden (approved/free), not paid
    const freeR = await member(db, 'freereact', { gender: 'female' })
    await approve(db, freeR, admin)
    await suspend(db, freeR, admin)
    const rf = await reactivate(db, freeR, admin)
    t.equal('suspended free member → hidden (APPROVED_FREE)', rf.status, 'hidden')
    t.equal('reactivate did not create membership', await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1`, [freeR]), 0)
    t.equal('free reactivated member not public', await isPublic(db, freeR), false)

    // expired (never suspended) → stays expired, no bypass
    const exp = await member(db, 'expreact', { gender: 'female', paid: 'smart-3-month' })
    await expireMembership(db, exp)
    t.equal('sweep flipped to expired', await status(db, exp), 'expired')
    const re = await reactivate(db, exp, admin)
    t.equal('expired member cannot be reactivated into active', re.status, 'expired')
    t.equal('nothing changed for the expired member', re.changed, false)
    t.check('note explains the renewal requirement', /MEMBERSHIP_EXPIRED/.test(re.note ?? ''), re.note)
    t.equal('expired member not public', await isPublic(db, exp), false)

    // suspended expired → expired
    await suspend(db, exp, admin)
    t.equal('suspended expired member → expired on reactivate', (await reactivate(db, exp, admin)).status, 'expired')

    // draft / incomplete → draft
    const inc = await member(db, 'increact', { gender: 'female', complete: false })
    const ri = await reactivate(db, inc, admin)
    t.equal('incomplete draft stays draft', ri.status, 'draft')
    t.check('note lists missing items', /PROFILE_INCOMPLETE/.test(ri.note ?? '') && /photo/.test(ri.note ?? ''), ri.note)

    // hidden/expired with a live plan (repair path) → active through the gate
    const repair = await member(db, 'repair', { gender: 'female' })
    await approve(db, repair, admin)
    await db.query(`INSERT INTO public.subscriptions (user_id, package_id, package_slug, status, started_at, expires_at)
                    SELECT $1, id, slug, 'active', now(), now() + interval '30 days' FROM public.packages WHERE slug = 'smart-3-month'`, [repair])
    t.equal('setup: hidden with a live plan', await status(db, repair), 'hidden')
    const rr = await reactivate(db, repair, admin)
    t.equal('hidden + live plan → published', rr.status, 'active')
    t.check('repair path is public', await isPublic(db, repair))
  }

  // =========================================================================
  console.log(' [8] verify / feature / boost / manual activation keep one meaning each')
  // =========================================================================
  {
    const freeV = await member(db, 'verify', { gender: 'female' })
    await approve(db, freeV, admin)
    await db.query(`UPDATE public.matrimony_profiles SET verified_at = now() WHERE user_id = $1`, [freeV])
    t.equal('verified free member stays hidden/free', [await status(db, freeV), await isPublic(db, freeV), (await state(db, freeV)).live_membership], ['hidden', false, false])
    t.equal('verified flag reported', (await state(db, freeV)).verified, true)

    // featured: PK prevents duplicates; non-public rows never render publicly
    await db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 5) ON CONFLICT (profile_id) DO UPDATE SET position = EXCLUDED.position`, [bride])
    await db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 6) ON CONFLICT (profile_id) DO UPDATE SET position = EXCLUDED.position`, [bride])
    t.equal('no duplicate featured rows', await scalar(db, `SELECT count(*)::int AS n FROM public.featured_profiles WHERE profile_id = $1`, [bride]), 1)
    const dup = await expectError(() => db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 7)`, [bride]))
    t.check('featured primary key rejects a second row', /duplicate key/.test(dup), dup)
    await db.query(`INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 1) ON CONFLICT DO NOTHING`, [freeV])
    t.check('featured free (non-public) profile is not shown publicly', !(await featuredIds(db)).includes(freeV))

    // boost: configured duration, admin entitlement, no payment
    const b = await svc(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [bride, admin])
    t.equal('admin boost uses configured duration (5 days)', b.duration_days, 5)
    const ent = await one(db, `SELECT source, payment_id, duration_days FROM public.profile_boost_entitlements WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [bride])
    t.equal('boost entitlement is admin-sourced without payment', [ent.source, ent.payment_id, ent.duration_days], ['admin', null, 5])
    t.equal('boost flag visible in admin state', (await state(db, bride)).boosted, true)
    const b2 = await expectError(() => svc(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [bride, admin]))
    t.check('second boost refused while live', /BOOST_ALREADY_ACTIVE/.test(b2), b2)

    // manual activation = activate_membership
    const man = await member(db, 'manual', { gender: 'female' })
    const act = await activatePackage(db, man, 'premium-6-month')
    t.equal('manual activation creates the subscription', act.r.status, 'activated')
    t.equal('manual activation publishes a complete profile', await status(db, man), 'active')
    t.equal('membership_activated event written by the RPC', await eventCount(db, man, 'membership_activated'), 1)
  }

  // =========================================================================
  console.log(' [9] authorization: non-admins and anonymous callers are refused')
  // =========================================================================
  {
    const victim = await member(db, 'victim', { gender: 'female', paid: 'smart-3-month' })
    const calls = {
      admin_set_profile_suspended: `SELECT public.admin_set_profile_suspended($1, TRUE, $2, NULL)`,
      admin_set_profile_hidden: `SELECT public.admin_set_profile_hidden($1, TRUE, $2, NULL)`,
      admin_reactivate_profile: `SELECT public.admin_reactivate_profile($1, $2)`,
      admin_approve_profile: `SELECT public.admin_approve_profile($1, $2)`,
      admin_reject_profile: `SELECT public.admin_reject_profile($1, $2, 'x')`,
      admin_update_member_profile: `SELECT public.admin_update_member_profile($1, $2, '{"city":"x"}'::jsonb, '{}'::jsonb)`,
      admin_prepare_member_deletion: `SELECT public.admin_prepare_member_deletion($1, $2, 'x@example.com', NULL)`,
      admin_member_state: `SELECT public.admin_member_state($1)`,
    }
    for (const [fn, sql] of Object.entries(calls)) {
      const e = await asUser(db, viewer, () => expectError(() => db.query(sql, sql.includes('$2') ? [victim, viewer] : [victim])))
      t.check(`member cannot execute ${fn}`, /permission denied/.test(e), e)
    }
    const eList = await asUser(db, viewer, () => expectError(() => db.query(`SELECT public.admin_list_members()`)))
    t.check('member cannot execute admin_list_members', /permission denied/.test(eList), eList)
    const eAnon = await expectError(async () => {
      await db.exec(`SELECT set_config('request.jwt.claim.role', 'anon', false); SET ROLE anon;`)
      try { await db.query(`SELECT public.admin_list_members()`) } finally {
        await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false);`)
      }
    })
    t.check('anon cannot execute admin_list_members', /permission denied|ADMIN_ONLY/.test(eAnon), eAnon)
    // Even with the service key, the acting admin must be a real admin.
    const eActor = await expectError(() => suspend(db, victim, viewer))
    t.check('service call naming a non-admin actor is refused', /ADMIN_ONLY/.test(eActor), eActor)
    const eNull = await expectError(() => suspend(db, victim, null))
    t.check('service call without an actor is refused', /ADMIN_ONLY/.test(eNull), eNull)
    t.equal('victim untouched by refused calls', await status(db, victim), 'active')
    const auditRead = await asUser(db, viewer, () => expectError(() => db.query(`SELECT * FROM public.admin_audit_log`)))
    t.check('members cannot read the admin audit log', /permission denied/.test(auditRead), auditRead)
  }

  // =========================================================================
  console.log(' [10] self-protection')
  // =========================================================================
  {
    const eSelf = await expectError(() => suspend(db, admin, admin))
    t.check('admin cannot suspend themselves', /ADMIN_SELF_ACTION/.test(eSelf), eSelf)
    const eHide = await expectError(() => hide(db, admin, admin))
    t.check('admin cannot hide themselves', /ADMIN_SELF_ACTION/.test(eHide), eHide)
    const eDel = await expectError(() => prepareDelete(db, admin, admin, `admin1@example.com`))
    t.check('admin cannot delete their own account', /ADMIN_SELF_DELETE/.test(eDel), eDel)
    const admin2Email = (await one(db, `SELECT email FROM public.profiles WHERE id = $1`, [admin2])).email
    const eOther = await expectError(() => prepareDelete(db, admin2, admin, admin2Email))
    t.check('another admin account is protected until demoted in the database', /ADMIN_TARGET_PROTECTED/.test(eOther), eOther)
    t.equal('admins still admins', await scalar(db, `SELECT count(*)::int AS n FROM public.profiles WHERE is_admin AND id IN ($1, $2)`, [admin, admin2]), 2)
  }

  // =========================================================================
  console.log(' [11] delete: deliberate confirmation + consistent cascade + surviving audit')
  // =========================================================================
  {
    const gone = await member(db, 'gone', { gender: 'female', paid: 'smart-3-month', name: 'Gone Member' })
    const email = (await one(db, `SELECT email FROM public.profiles WHERE id = $1`, [gone])).email
    // footprint: interest + message + block + report + notification + boost
    await asUser(db, viewer, () => db.query(`SELECT public.express_interest($1, 'hi')`, [gone]))
    await asUser(db, gone, () => db.query(`SELECT public.express_interest($1, 'hello')`, [viewer]))
    const convo = await asUser(db, viewer, () => scalar(db, `SELECT public.get_or_create_conversation($1) AS c`, [gone]))
    const convoId = convo?.conversation_id ?? convo?.id
    if (convoId) await asUser(db, viewer, () => db.query(`SELECT public.send_message($1, 'namaste')`, [convoId]))
    await db.query(`INSERT INTO public.reports (reporter_id, reported_id, target_type, target_id, reason, status) VALUES ($1, $2, 'profile', $2::text, 'spam', 'open')`, [viewerF, gone]).catch(() => undefined)
    await svc(db, `SELECT public.admin_grant_boost($1, $2) AS r`, [gone, admin])

    const wrong = await expectError(() => prepareDelete(db, gone, admin, 'someone-else@example.com'))
    t.check('wrong confirmation email is refused', /DELETE_CONFIRMATION_MISMATCH/.test(wrong), wrong)
    const empty = await expectError(() => prepareDelete(db, gone, admin, ''))
    t.check('empty confirmation is refused', /DELETE_CONFIRMATION_MISMATCH/.test(empty), empty)
    t.equal('member still exists after refused attempts', await scalar(db, `SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [gone]), 1)
    t.equal('no deletion audit row after refused attempts', await auditCount(db, gone, 'admin_member_deleted'), 0)

    const prep = await prepareDelete(db, gone, admin, email.toUpperCase(), 'GDPR request')
    t.equal('confirmation is case-insensitive on the email', prep.ok, true)
    t.check('footprint summarises the cascade', prep.footprint.subscriptions === 1 && prep.footprint.interests === 2 && prep.footprint.boosts === 1, prep.footprint)
    t.check('audit row keeps only a masked email', prep.email_masked === `${email[0]}***${email.slice(email.indexOf('@'))}`, prep.email_masked)
    t.equal('account_deleted event written before removal', await eventCount(db, gone, 'account_deleted'), 1)
    t.equal('admin_member_deleted event written before removal', await eventCount(db, gone, 'admin_member_deleted'), 1)

    // The server action now wipes storage and deletes the auth user — simulate the auth deletion.
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [gone])

    const tables = [
      ['profiles', 'id'], ['matrimony_profiles', 'user_id'], ['partner_preferences', 'profile_id'], ['profile_photos', 'profile_id'],
      ['subscriptions', 'user_id'], ['payments', 'user_id'], ['notifications', 'user_id'], ['profile_boosts', 'user_id'],
      ['profile_boost_entitlements', 'user_id'], ['verification_requests', 'user_id'], ['moments', 'user_id'],
      ['featured_profiles', 'profile_id'], ['conversation_members', 'user_id'], ['messages', 'sender_id'],
      ['reports', 'reported_id'], ['blocks', 'blocked_id'], ['login_history', 'user_id'],
    ]
    for (const [table, col] of tables) {
      const n = await scalar(db, `SELECT count(*)::int AS n FROM public.${table} WHERE ${col} = $1`, [gone])
      t.equal(`cascade: ${table} has no rows for the deleted member`, n, 0)
    }
    t.equal('cascade: interests either side removed', await scalar(db, `SELECT count(*)::int AS n FROM public.interests WHERE sender_id = $1 OR receiver_id = $1`, [gone]), 0)
    t.equal('viewer\u2019s own data survives', await scalar(db, `SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [viewer]), 1)
    t.equal('admin audit row survives deletion', await auditCount(db, gone, 'admin_member_deleted'), 1)
    const auditRow = await one(db, `SELECT details FROM public.admin_audit_log WHERE target_id = $1 AND action = 'admin_member_deleted'`, [gone])
    t.check('audit details: name + masked email + reason, no raw email/mobile', auditRow.details.name === 'Gone Member' && auditRow.details.reason === 'GDPR request' && !JSON.stringify(auditRow.details).includes(email), auditRow.details)
    t.equal('activity events survive anonymised (user_id NULL)', await scalar(db, `SELECT count(*)::int AS n FROM public.activity_events WHERE user_id IS NULL AND event = 'admin_member_deleted'`), 1)
    t.equal('no orphan boost entitlements anywhere', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boost_entitlements e LEFT JOIN public.profiles p ON p.id = e.user_id WHERE p.id IS NULL`), 0)
  }

  // =========================================================================
  console.log(' [12] audit + activity vocabulary')
  // =========================================================================
  {
    const voc = await scalar(db, `SELECT public.canonical_activity_events() AS v`)
    const parsed = typeof voc === 'string' ? JSON.parse(voc) : voc
    for (const ev of ['admin_member_approved', 'admin_member_edited', 'admin_member_suspended', 'admin_member_unsuspended', 'admin_member_hidden', 'admin_member_reactivated', 'admin_member_deleted', 'admin_member_verified', 'admin_member_unverified', 'admin_member_featured', 'admin_member_unfeatured', 'admin_manual_membership_activation', 'boost_granted']) {
      t.check(`vocabulary includes ${ev}`, parsed.includes(ev))
    }
    const secrets = await scalar(db, `SELECT count(*)::int AS n FROM public.activity_events WHERE event LIKE 'admin_member_%' AND (metadata ? 'reason' OR metadata ? 'note' OR metadata ? 'admin_id' OR metadata ? 'email' OR metadata ? 'mobile')`)
    t.equal('no admin activity event carries reasons, notes, admin ids or contact data', secrets, 0)
    const auditActions = (await db.query(`SELECT DISTINCT action FROM public.admin_audit_log ORDER BY action`)).rows.map((r) => r.action)
    for (const a of ['admin_member_approved', 'admin_member_rejected', 'admin_member_edited', 'admin_member_suspended', 'admin_member_unsuspended', 'admin_member_hidden', 'admin_member_unhidden', 'admin_member_reactivated', 'admin_member_deleted']) {
      t.check(`audit log has ${a}`, auditActions.includes(a), auditActions)
    }
    const nullAdmin = await scalar(db, `SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action LIKE 'admin_member_%' AND admin_id IS NULL`)
    t.equal('every Step 7 audit row names the acting admin', nullAdmin, 0)
  }

  // =========================================================================
  console.log(' [13] migration hygiene')
  // =========================================================================
  {
    const fns = (await db.query(
      `SELECT p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN (
         'admin_assert_actor','admin_profile_missing','admin_member_state','admin_apply_restored_status',
         'admin_set_profile_suspended','admin_set_profile_hidden','admin_reactivate_profile','admin_approve_profile',
         'admin_reject_profile','admin_update_member_profile','admin_prepare_member_deletion','admin_list_members')`
    )).rows
    t.equal('all twelve admin RPCs exist', fns.length, 12)
    t.check('every admin RPC is SECURITY DEFINER with a fixed search_path',
      fns.every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => c.startsWith('search_path='))), fns.map((f) => [f.proname, f.proconfig]))
    t.check('no admin RPC is executable by authenticated or anon',
      fns.every((f) => !f.auth_exec && !f.anon_exec), fns.filter((f) => f.auth_exec || f.anon_exec).map((f) => f.proname))
    t.check('every admin RPC is executable by service_role', fns.every((f) => f.svc_exec))
    const policy = await one(db, `SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy WHERE polname = 'Members read active matrimony profiles'`)
    t.check('member read policy also requires no admin hold', /admin_hidden_at IS NULL/.test(policy?.q ?? ''), policy)
    const isPublicSrc = await scalar(db, `SELECT prosrc FROM pg_proc WHERE proname = 'is_profile_public'`)
    t.check('is_profile_public() checks the admin hold', /admin_hidden_at IS NULL/.test(isPublicSrc))
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'matrimony_profiles' AND column_name IN ('admin_hidden_at','admin_hidden_by','admin_hidden_reason','suspended_at','suspended_by','suspension_reason','status_before_suspension')`)).rows
    t.equal('seven bookkeeping columns exist', cols.length, 7)
    const enumVals = (await db.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.profile_status'::regtype ORDER BY enumsortorder`)).rows.map((r) => r.enumlabel)
    t.equal('profile_status vocabulary unchanged (no new statuses)', enumVals, ['draft', 'pending_review', 'active', 'hidden', 'rejected', 'suspended', 'expired'])
  }

  return t
}
