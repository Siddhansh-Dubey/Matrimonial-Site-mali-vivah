// Step 11 — Privacy, account deletion and personal-data lifecycle.
//
// Proves:
//  1. delete_my_account hides the profile FIRST (fail-safe even before auth
//     user removal) and is idempotent
//  2. a member cannot delete another member (RPC has no user_id argument;
//     acting as B never retires A)
//  3. anon cannot delete
//  4. deleted / deactivated accounts leave search, Daily 5, featured, public
//     profile, contact, interest and chat
//  5. payments / subscriptions / reports / activity survive with user_id NULL
//  6. personal rows (interests, photos, boosts, notifications) CASCADE
//  7. privacy settings are enforced in get_public_profile, not just the UI
//  8. other members cannot SELECT privacy-gated columns via table RLS
//  9. contact is paid + mutual + public + active accounts only
// 10. expired / suspended / hidden / deleted targets never reveal contact
// 11. public browse RPCs never return phone/email
// 12. expired moments are hidden from other members
// 13. update_my_privacy_settings is allow-listed and own-row only
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

const CONTACT_KEYS = ['phone', 'email', 'mobile', 'contact_phone', 'contact_email', 'whatsapp', 'whatsapp_number']

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
    } catch { /* aborted transaction fallback */ }
  }
}

async function member(db, tag, { gender = 'female', pkg = 'premium-6-month' } = {}) {
  const id = await signUp(db, {
    email: `${tag}@lifecycle.example.com`,
    name: `${tag[0].toUpperCase()}${tag.slice(1)} Member`,
    mobile: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
  })
  await completeProfile(db, id, { gender })
  if (pkg) await activatePackage(db, id, pkg)
  return id
}

async function createAdmin(db) {
  const id = await signUp(db, {
    email: 'admin.lifecycle@malivivah.test',
    name: 'Admin Lifecycle',
    mobile: '9800000091',
  })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [id])
  return id
}

const search = (db, viewer, looking) =>
  asUser(db, viewer, () => scalar(db, `SELECT public.search_matches($1) AS r`, [looking]))
const daily = (db, viewer) =>
  asUser(db, viewer, () => scalar(db, `SELECT public.get_daily_matches() AS r`))
const featured = (db, viewer) =>
  asUser(db, viewer, () => scalar(db, `SELECT public.get_featured_profiles() AS r`))
const pub = (db, viewer, target) =>
  asUser(db, viewer, () => scalar(db, `SELECT public.get_public_profile($1) AS r`, [target]))
const contact = (db, viewer, target) =>
  asUser(db, viewer, () => scalar(db, `SELECT public.get_profile_contact($1) AS r`, [target]))
const isPublic = (db, id) => scalar(db, `SELECT public.is_profile_public($1) AS r`, [id])

function payloadHasId(payload, id) {
  return JSON.stringify(payload ?? null).includes(id)
}

export default async function privacyLifecycleSuite(db) {
  const t = new Checks('privacy-lifecycle')
  const adminId = await createAdmin(db)

  const alice = await member(db, 'alice', { gender: 'female' })
  const bob = await member(db, 'bob', { gender: 'male' })
  const cara = await member(db, 'cara', { gender: 'female' })
  const dave = await member(db, 'dave', { gender: 'male' })
  const free = await member(db, 'freebie', { gender: 'male', pkg: null })

  const aliceMobile = await scalar(db, `SELECT mobile FROM public.profiles WHERE id = $1`, [alice])
  const bobMobile = await scalar(db, `SELECT mobile FROM public.profiles WHERE id = $1`, [bob])

  // =========================================================================
  console.log(' [1] privacy settings are server-enforced')
  // =========================================================================
  await db.query(
    `UPDATE public.matrimony_profiles
     SET about_me = 'Secret intro', annual_income = '10 - 15 lpa',
         family_details = 'Joint family in Pune'
     WHERE user_id = $1`,
    [alice]
  )

  const before = await pub(db, bob, alice)
  t.check('paid viewer sees about_me by default', before?.about_me === 'Secret intro', before?.about_me)
  t.check('paid viewer sees income by default', before?.annual_income === '10 - 15 lpa', before?.annual_income)
  t.check('paid viewer sees family_details by default', before?.family_details === 'Joint family in Pune', before?.family_details)
  t.check('paid viewer sees family_photo path by default', Boolean(before?.family_photo), before?.family_photo)

  const settings = await asUser(db, alice, () =>
    scalar(db, `SELECT public.update_my_privacy_settings($1::jsonb) AS r`, [
      JSON.stringify({
        show_about: false,
        show_family_details: false,
        show_family_photo: false,
        show_income: false,
      }),
    ])
  )
  t.check('update_my_privacy_settings writes the four keys',
    settings?.show_about === false &&
      settings?.show_family_details === false &&
      settings?.show_family_photo === false &&
      settings?.show_income === false,
    settings)

  const after = await pub(db, bob, alice)
  t.equal('get_public_profile hides about_me when toggled off', after?.about_me ?? null, null)
  t.equal('get_public_profile hides income when toggled off', after?.annual_income ?? null, null)
  t.equal('get_public_profile hides family_details when toggled off', after?.family_details ?? null, null)
  t.equal('get_public_profile hides family_photo when toggled off', after?.family_photo ?? null, null)

  const unknown = await asUser(db, alice, () =>
    expectError(() =>
      db.query(`SELECT public.update_my_privacy_settings($1::jsonb)`, [JSON.stringify({ show_phone: false })])
    )
  )
  t.check('unknown privacy key is rejected', /FIELD_NOT_EDITABLE/.test(unknown), unknown)

  const forged = await asUser(db, bob, () =>
    scalar(db, `SELECT public.update_my_privacy_settings($1::jsonb) AS r`, [
      JSON.stringify({ show_about: true }),
    ])
  )
  t.equal('Bob writing privacy settings only changes Bob, not Alice', forged.show_about, true)
  const aliceStill = await scalar(
    db,
    `SELECT (privacy_settings ->> 'show_about')::boolean AS v FROM public.matrimony_profiles WHERE user_id = $1`,
    [alice]
  )
  t.equal('Alice privacy is unchanged by Bob\'s RPC call', aliceStill, false)

  const otherRow = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE user_id = $1`, [alice])
  )
  t.equal('other members cannot SELECT another matrimony_profiles row', otherRow, 0)

  const familyRead = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int AS n FROM public.profile_photos WHERE profile_id = $1 AND kind = 'family_photo'`, [alice])
  )
  t.equal('other members cannot SELECT another member\'s family photo row', familyRead, 0)

  const profileRead = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int AS n FROM public.profile_photos WHERE profile_id = $1 AND kind = 'profile_photo'`, [alice])
  )
  t.equal('other members can still SELECT an active profile photo', profileRead, 1)

  const mobileLeak = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int AS n FROM public.profiles WHERE id = $1 AND mobile IS NOT NULL`, [alice])
  )
  t.equal('other members cannot SELECT profiles.mobile of another member', mobileLeak, 0)

  // Restore Alice's privacy so later contact tests are not confused by it.
  await asUser(db, alice, () =>
    db.query(`SELECT public.update_my_privacy_settings($1::jsonb)`, [
      JSON.stringify({
        show_about: true,
        show_family_details: true,
        show_family_photo: true,
        show_income: true,
      }),
    ])
  )

  // =========================================================================
  console.log(' [2] contact privacy — paid + mutual + public only')
  // =========================================================================
  t.equal('free viewer never gets contact', await contact(db, free, alice), null)
  t.equal('paid viewer without mutual never gets contact', await contact(db, bob, alice), null)

  await asUser(db, alice, () => db.query(`SELECT public.express_interest($1)`, [bob]))
  t.equal('one-way interest does not unlock contact', await contact(db, bob, alice), null)

  await asUser(db, bob, () => db.query(`SELECT public.express_interest($1)`, [alice]))
  t.equal('paid + mutual unlocks Alice\'s mobile', await contact(db, bob, alice), aliceMobile)
  t.equal('paid + mutual unlocks Bob\'s mobile the other way', await contact(db, alice, bob), bobMobile)

  const card = await pub(db, bob, alice)
  t.equal('get_public_profile contact_phone matches the gated mobile', card?.contact_phone ?? null, aliceMobile)
  t.check('get_public_profile contact_email is present only after mutual', Boolean(card?.contact_email), card?.contact_email)

  const searchCards = await search(db, bob, 'female')
  t.check('search never includes a contact key',
    Array.isArray(searchCards) && searchCards.every((c) => CONTACT_KEYS.every((k) => !(k in c))),
    searchCards?.[0] && Object.keys(searchCards[0]))
  t.check('search still lists a public Alice', payloadHasId(searchCards, alice))

  const dailyCards = await daily(db, bob)
  t.check('Daily 5 never includes a contact key',
    Array.isArray(dailyCards) && dailyCards.every((c) => CONTACT_KEYS.every((k) => !(k in c))))

  await db.query(
    `INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 1)
     ON CONFLICT (profile_id) DO UPDATE SET position = 1`,
    [alice]
  )
  const feat = await featured(db, bob)
  t.check('featured lists Alice while public', payloadHasId(feat, alice))
  t.check('featured never includes a contact key',
    Array.isArray(feat) && feat.every((c) => CONTACT_KEYS.every((k) => !(k in c))))

  // Expired TARGET: membership lapses, is_profile_public false, contact gone.
  await db.query(
    `UPDATE public.subscriptions SET started_at = now() - interval '200 days', expires_at = now() - interval '1 day' WHERE user_id = $1`,
    [cara]
  )
  await asService(db, () => db.query(`SELECT public.sweep_expired_memberships()`))
  t.equal('expired target is not public', await isPublic(db, cara), false)
  t.equal('expired target never reveals contact (even if a stale mutual existed)', await contact(db, bob, cara), null)
  t.equal('get_public_profile of expired target is null', await pub(db, bob, cara), null)
  t.check('search excludes expired target', !payloadHasId(await search(db, bob, 'female'), cara))

  // Suspended TARGET.
  await asService(db, () =>
    db.query(`SELECT public.admin_set_profile_suspended($1, TRUE, $2, 'test')`, [dave, adminId])
  )
  t.equal('suspended target is not public', await isPublic(db, dave), false)
  t.equal('suspended target never reveals contact', await contact(db, bob, dave), null)
  t.check('search excludes suspended target', !payloadHasId(await search(db, alice, 'male'), dave))

  // Hidden TARGET (admin hold).
  const eve = await member(db, 'eve', { gender: 'female' })
  await asService(db, () =>
    db.query(`SELECT public.admin_set_profile_hidden($1, TRUE, $2, 'test')`, [eve, adminId])
  )
  t.equal('admin-hidden target is not public', await isPublic(db, eve), false)
  t.equal('admin-hidden target never reveals contact', await contact(db, bob, eve), null)
  t.check('search excludes admin-hidden target', !payloadHasId(await search(db, bob, 'female'), eve))

  // =========================================================================
  console.log(' [3] moments — expired / non-public authors stay off the rail')
  // =========================================================================
  const momentId = await scalar(
    db,
    `INSERT INTO public.moments (user_id, storage_path, caption)
     VALUES ($1, $2, 'hello') RETURNING id`,
    [alice, `${alice}/moment.jpg`]
  )
  const rail = await asUser(db, bob, () => scalar(db, `SELECT public.list_moments() AS r`))
  t.check('live moment of a public author appears on the rail', payloadHasId(rail, momentId))

  await db.query(`UPDATE public.moments SET expires_at = now() - interval '1 hour' WHERE id = $1`, [momentId])
  const railExpired = await asUser(db, bob, () => scalar(db, `SELECT public.list_moments() AS r`))
  t.check('expired moment is gone from list_moments', !payloadHasId(railExpired, momentId))
  const otherReadsExpired = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int AS n FROM public.moments WHERE id = $1`, [momentId])
  )
  t.equal('other members cannot SELECT an expired moment row', otherReadsExpired, 0)

  // =========================================================================
  console.log(' [4] delete_my_account — fail-safe hide, auth, idempotency')
  // =========================================================================
  const pay = await one(
    db,
    `INSERT INTO public.payments (user_id, kind, amount_inr, status, razorpay_order_id)
     VALUES ($1, 'package', 2499, 'captured', 'order_' || gen_random_uuid()::text)
     RETURNING id`,
    [alice]
  )
  const report = await asUser(db, alice, () =>
    scalar(db, `SELECT public.report_profile($1, 'spam', 'test') AS r`, [bob])
  )
  t.equal('Alice can file a report before deletion', report.status, 'filed')

  const anonDel = await expectError(() => asAnon(db, () => db.query(`SELECT public.delete_my_account()`)))
  t.check('anon cannot call delete_my_account', /permission denied|not authenticated/.test(anonDel), anonDel)

  // Bob deleting himself must not touch Alice.
  const bobBefore = await isPublic(db, bob)
  await asUser(db, cara, () => db.query(`SELECT public.delete_my_account()`))
  t.equal('Alice stays public when Cara deletes herself', await isPublic(db, alice), true)
  t.equal('Bob stays public when Cara deletes herself', await isPublic(db, bob), bobBefore)

  // Alice retires — WITHOUT removing auth.users. This is the fail-safe case.
  const retired = await asUser(db, alice, () => scalar(db, `SELECT public.delete_my_account() AS r`))
  t.equal('delete_my_account reports ok', retired.ok, true)
  t.equal('profile is no longer public after the RPC (auth user still exists)', await isPublic(db, alice), false)
  t.equal('is_active is false after the RPC', await scalar(db, `SELECT is_active FROM public.profiles WHERE id = $1`, [alice]), false)
  t.equal('email is anonymised', await scalar(db, `SELECT email FROM public.profiles WHERE id = $1`, [alice]), `deleted-${alice}@deleted.invalid`)
  t.equal('mobile is cleared', await scalar(db, `SELECT mobile FROM public.profiles WHERE id = $1`, [alice]), null)
  t.equal('get_public_profile is null after hide', await pub(db, bob, alice), null)
  t.equal('get_profile_contact is null after hide', await contact(db, bob, alice), null)
  t.check('search excludes the retired member', !payloadHasId(await search(db, bob, 'female'), alice))
  t.check('Daily 5 excludes the retired member', !payloadHasId(await daily(db, bob), alice))
  t.check('featured excludes the retired member', !payloadHasId(await featured(db, bob), alice))
  t.equal('featured row is gone', await scalar(db, `SELECT count(*)::int AS n FROM public.featured_profiles WHERE profile_id = $1`, [alice]), 0)
  t.equal('photo rows are gone', await scalar(db, `SELECT count(*)::int AS n FROM public.profile_photos WHERE profile_id = $1`, [alice]), 0)

  const sendAfter = await asUser(db, alice, () =>
    expectError(() => db.query(`SELECT public.express_interest($1)`, [bob]))
  )
  t.check('retired member cannot send new interest', /not authenticated|TARGET_UNAVAILABLE/.test(sendAfter), sendAfter)

  const receiveAfter = await asUser(db, bob, () =>
    expectError(() => db.query(`SELECT public.express_interest($1)`, [alice]))
  )
  t.check('retired member cannot receive new interest', /TARGET_UNAVAILABLE/.test(receiveAfter), receiveAfter)

  t.equal('chat with a retired member is refused', await scalar(db, `SELECT public.can_chat_with($1, $2)`, [bob, alice]), false)

  t.equal('payment row is retained with user_id NULL after hide',
    await scalar(db, `SELECT user_id FROM public.payments WHERE id = $1`, [pay.id]), null)
  t.equal('subscription row is detached (user_id NULL)',
    await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = $1`, [alice]), 0)
  t.check('subscription row still exists unlinked',
    (await scalar(db, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id IS NULL`)) >= 1)
  t.equal('report row is retained with reporter_id NULL',
    await scalar(db, `SELECT reporter_id FROM public.reports WHERE id = $1`, [report.report_id]), null)
  t.equal('account_deleted activity was written',
    await scalar(db, `SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'account_deleted' AND user_id = $1`, [alice]), 1)

  const again = await asUser(db, alice, () => scalar(db, `SELECT public.delete_my_account() AS r`))
  t.equal('second delete_my_account is idempotent (ok)', again.ok, true)

  // Now remove the auth user — the product's last step.
  const del = await expectError(() => db.query(`DELETE FROM auth.users WHERE id = $1`, [alice]))
  t.equal('auth.users delete succeeds after retirement', del, '')
  t.equal('profile row is gone after auth delete', await scalar(db, `SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [alice]), 0)
  t.equal('payment row still exists after auth delete', await scalar(db, `SELECT count(*)::int AS n FROM public.payments WHERE id = $1`, [pay.id]), 1)
  t.equal('report row still exists after auth delete', await scalar(db, `SELECT count(*)::int AS n FROM public.reports WHERE id = $1`, [report.report_id]), 1)
  t.equal('account_deleted activity survives with user_id NULL',
    await scalar(db, `SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'account_deleted' AND user_id IS NULL AND metadata @> '{"source":"retire_account_data"}'`), 1)
  t.equal('boost / entitlement rows for Alice are gone',
    await scalar(db, `SELECT count(*)::int AS n FROM public.profile_boosts WHERE user_id = $1`, [alice]), 0)
  t.equal('notifications for Alice are gone',
    await scalar(db, `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1`, [alice]), 0)
  t.equal('get_public_profile of a fully deleted member is null', await pub(db, bob, alice), null)
  t.equal('get_profile_contact of a fully deleted member is null', await contact(db, bob, alice), null)

  // =========================================================================
  console.log(' [5] admin prepare also hides before auth removal')
  // =========================================================================
  const frank = await member(db, 'frank', { gender: 'male' })
  const frankEmail = await scalar(db, `SELECT email FROM public.profiles WHERE id = $1`, [frank])
  await asService(db, () =>
    db.query(`SELECT public.admin_prepare_member_deletion($1, $2, $3, 'test')`, [frank, adminId, frankEmail])
  )
  t.equal('admin prepare hides the member immediately', await isPublic(db, frank), false)
  t.equal('admin prepare anonymises the email',
    await scalar(db, `SELECT email FROM public.profiles WHERE id = $1`, [frank]),
    `deleted-${frank}@deleted.invalid`)
  t.check('search excludes the admin-prepared member', !payloadHasId(await search(db, bob, 'male'), frank))
  t.equal('admin audit row was written',
    await scalar(db, `SELECT count(*)::int AS n FROM public.admin_audit_log WHERE admin_id = $1 AND action = 'admin_member_deleted' AND target_id = $2`, [adminId, frank]), 1)

  const selfPrep = await asService(db, () =>
    expectError(() =>
      db.query(`SELECT public.admin_prepare_member_deletion($1, $1, $2)`, [adminId, 'admin.lifecycle@malivivah.test'])
    )
  )
  t.check('admin cannot prepare deletion of their own account', /ADMIN_SELF_DELETE/.test(selfPrep), selfPrep)

  return t
}
