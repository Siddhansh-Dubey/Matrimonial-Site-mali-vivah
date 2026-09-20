// Step 14: Hardening and Phase 1 audit finding closure verification
import {
  Checks,
  asUser,
  asService,
  signUp,
  completeProfile,
  activatePackage,
  one,
  scalar,
  expectError,
} from '../lib/harness.mjs'

export default async function suite(db) {
  const t = new Checks('step14-hardening')

  // Setup test users:
  // Alice: Female, adult, paid active
  // Bob: Male, adult, paid active
  // Charlie: Male, adult, free (unpaid)
  // Dave: Male, adult, expired
  const alice = await signUp(db, { email: 'alice.hard@test.internal', name: 'Alice Hard', mobile: '9811111111' })
  await completeProfile(db, alice, { gender: 'female', dob: '1995-05-15', city: 'Pune' })
  await activatePackage(db, alice, 'smart-3-month')

  const bob = await signUp(db, { email: 'bob.hard@test.internal', name: 'Bob Hard', mobile: '9822222222' })
  await completeProfile(db, bob, { gender: 'male', dob: '1992-08-20', city: 'Pune' })
  await activatePackage(db, bob, 'premium-6-month')

  const charlie = await signUp(db, { email: 'charlie.hard@test.internal', name: 'Charlie Hard', mobile: '9833333333' })
  await completeProfile(db, charlie, { gender: 'male', dob: '1990-01-10', city: 'Mumbai' })
  // Charlie is free / unpaid (status should be hidden)

  const dave = await signUp(db, { email: 'dave.hard@test.internal', name: 'Dave Hard', mobile: '9844444444' })
  await completeProfile(db, dave, { gender: 'male', dob: '1988-11-25', city: 'Pune' })
  await activatePackage(db, dave, 'smart-3-month')
  // Expire Dave's membership
  await db.query(`UPDATE public.subscriptions SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [dave])
  await db.query(`UPDATE public.matrimony_profiles SET status = 'expired' WHERE user_id = $1`, [dave])

  // Helper for expecting authorization/constraint denials
  const expectDenied = async (label, fn, pattern) => {
    const err = await expectError(fn)
    t.check(label, pattern.test(err), err)
  }

  // --------------------------------------------------------------------------
  // §1. S07: profile_photo_is_listable() live membership gate
  // --------------------------------------------------------------------------
  t.equal('paid active member photo is listable', await scalar(db, 'SELECT public.profile_photo_is_listable($1)', [alice]), true)
  t.equal('paid active member photo is listable (bob)', await scalar(db, 'SELECT public.profile_photo_is_listable($1)', [bob]), true)
  t.equal('free member photo is NOT listable', await scalar(db, 'SELECT public.profile_photo_is_listable($1)', [charlie]), false)
  t.equal('expired member photo is NOT listable', await scalar(db, 'SELECT public.profile_photo_is_listable($1)', [dave]), false)

  // --------------------------------------------------------------------------
  // §2. S04: Storage object RLS & authorization (can_read_storage_object)
  // --------------------------------------------------------------------------
  // Owner reading own file in any bucket
  t.equal(
    'owner can read own profile photo',
    await asUser(db, alice, () => scalar(db, "SELECT public.can_read_storage_object('profile-photos', $1)", [`${alice}/avatar.jpg`])),
    true
  )
  t.equal(
    'owner can read own verification doc',
    await asUser(db, alice, () => scalar(db, "SELECT public.can_read_storage_object('verification-docs', $1)", [`${alice}/id.pdf`])),
    true
  )
  // Cross-user verification document access is strictly denied
  t.equal(
    'other member cannot read verification doc',
    await asUser(db, bob, () => scalar(db, "SELECT public.can_read_storage_object('verification-docs', $1)", [`${alice}/id.pdf`])),
    false
  )
  // Blocked user cannot read storage object
  await asUser(db, alice, () => db.query('SELECT public.block_member($1)', [dave]))
  t.equal(
    'blocked member cannot read photo',
    await asUser(db, dave, () => scalar(db, "SELECT public.can_read_storage_object('profile-photos', $1)", [`${alice}/avatar.jpg`])),
    false
  )
  await asUser(db, alice, () => db.query('SELECT public.unblock_member($1)', [dave]))

  // --------------------------------------------------------------------------
  // §3. S14/S05: Moments lifecycle & storage path server authority
  // --------------------------------------------------------------------------
  // Ineligible author (free / hidden profile) cannot post moment
  await expectDenied(
    'free member cannot post moment',
    () => asUser(db, charlie, () => db.query(
      `INSERT INTO public.moments (user_id, media_type, storage_path) VALUES ($1, 'photo', $2)`,
      [charlie, `${charlie}/moments/1.jpg`]
    )),
    /MOMENT_AUTHOR_NOT_ELIGIBLE/
  )

  // Path must start with author ID
  await expectDenied(
    'moment path must start with author ID',
    () => asUser(db, alice, () => db.query(
      `INSERT INTO public.moments (user_id, media_type, storage_path) VALUES ($1, 'photo', 'forged/path.jpg')`,
      [alice]
    )),
    /MOMENT_INVALID_STORAGE_PATH/
  )

  // Legitimate active paid member posts moment
  const momentRes = await asUser(db, alice, () => one(
    db,
    `INSERT INTO public.moments (user_id, media_type, storage_path, caption)
     VALUES ($1, 'photo', $2, 'Spring celebration')
     RETURNING id, created_at, expires_at, is_removed`,
    [alice, `${alice}/moments/spring.jpg`]
  ))
  t.check('moment inserted with id', Boolean(momentRes.id))
  t.equal('moment is not removed by default', momentRes.is_removed, false)

  // Verify expiry is set to exactly ~24 hours from creation
  const expiryHours = await scalar(
    db,
    `SELECT round(extract(epoch FROM (expires_at - created_at)) / 3600)::int FROM public.moments WHERE id = $1`,
    [momentRes.id]
  )
  t.equal('moment expiry is set to 24 hours', expiryHours, 24)

  // Member cannot tamper with expiry date or timestamps (UPDATE denied to authenticated)
  await expectDenied(
    'member cannot update moment',
    () => asUser(db, alice, () => db.query(
      `UPDATE public.moments SET expires_at = now() + interval '30 days' WHERE id = $1`,
      [momentRes.id]
    )),
    /permission denied/
  )

  // --------------------------------------------------------------------------
  // §4. S09: Photo and verification storage path validation
  // --------------------------------------------------------------------------
  await expectDenied(
    'photo path must start with profile_id',
    () => asUser(db, bob, () => db.query(
      `INSERT INTO public.profile_photos (profile_id, storage_path, kind) VALUES ($1, 'other/avatar.jpg', 'profile_photo')`,
      [bob]
    )),
    /PHOTO_INVALID_STORAGE_PATH/
  )

  await expectDenied(
    'verification request storage_path must start with user_id',
    () => asUser(db, bob, () => db.query(
      `INSERT INTO public.verification_requests (user_id, type, storage_path) VALUES ($1, 'photo', 'other/id.jpg')`,
      [bob]
    )),
    /VERIFICATION_INVALID_STORAGE_PATH/
  )

  // --------------------------------------------------------------------------
  // §5. S06/S08: Report security
  // --------------------------------------------------------------------------
  await expectDenied(
    'ordinary member cannot directly INSERT into reports table',
    () => asUser(db, bob, () => db.query(
      `INSERT INTO public.reports (reporter_id, target_id, reason) VALUES ($1, $2, 'spam')`,
      [bob, alice]
    )),
    /permission denied/
  )

  // Must use report_profile RPC
  const reportRpcRes = await asUser(db, bob, () => one(
    db,
    `SELECT public.report_profile($1, 'inappropriate_content', 'Spam bio') AS res`,
    [alice]
  ))
  t.check('report filed through report_profile RPC', Boolean(reportRpcRes))

  // Ordinary member cannot read raw reports table
  const reportsRead = await asUser(db, bob, () => db.query('SELECT * FROM public.reports'))
  t.equal('member reading raw reports gets 0 rows', reportsRead.rows.length, 0)

  // --------------------------------------------------------------------------
  // §6. S10: Adult age requirement (18+)
  // --------------------------------------------------------------------------
  const minorUser = await signUp(db, { email: 'minor@test.internal', name: 'Minor User', mobile: '9855555555' })

  // Trigger / Constraint prevents setting DOB < 18 years
  await expectDenied(
    'underage DOB is rejected on matrimony_profiles update',
    () => db.query(
      `UPDATE public.matrimony_profiles SET date_of_birth = (CURRENT_DATE - INTERVAL '17 years') WHERE user_id = $1`,
      [minorUser]
    ),
    /UNDERAGE_PROFILE|violates check constraint/
  )

  // admin_profile_missing reports missing date of birth for underage or null
  const missingWithNullDob = await scalar(db, 'SELECT public.admin_profile_missing($1)', [minorUser])
  t.check('admin_profile_missing requires date of birth', missingWithNullDob.includes('date of birth'))

  // --------------------------------------------------------------------------
  // §7. Requirement 13: Notification producers (Moment & Matches)
  // --------------------------------------------------------------------------
  // When Alice (female) posted a moment earlier, Bob (opposite-gender active member) should receive notification
  const bobNotifications = await asUser(db, bob, () => db.query(
    `SELECT * FROM public.notifications WHERE user_id = $1 AND type = 'new_moment'`,
    [bob]
  ))
  t.check('opposite-gender active member received new_moment notification', bobNotifications.rows.length >= 1)

  // Duplicate moment notification within 24h is suppressed
  const secondMoment = await asUser(db, alice, () => one(
    db,
    `INSERT INTO public.moments (user_id, media_type, storage_path, caption)
     VALUES ($1, 'photo', $2, 'Another moment')
     RETURNING id`,
    [alice, `${alice}/moments/second.jpg`]
  ))
  t.check('second moment inserted', Boolean(secondMoment.id))
  const bobNotifsAfterSecond = await asUser(db, bob, () => db.query(
    `SELECT * FROM public.notifications WHERE user_id = $1 AND type = 'new_moment'`,
    [bob]
  ))
  t.equal('moment notification is deduplicated within 24h', bobNotifsAfterSecond.rows.length, bobNotifications.rows.length)

  // Daily 5 produces new_matches notification on qualifying match
  const dailyMatches = await asUser(db, bob, () => scalar(db, 'SELECT public.get_daily_matches()'))
  t.check('get_daily_matches returned array', Array.isArray(dailyMatches))

  // --------------------------------------------------------------------------
  // §8. Requirement 14: Member self-sweep (sweep_my_membership)
  // --------------------------------------------------------------------------
  // Create lapsed subscription for Dave and call sweep_my_membership
  await asUser(db, dave, () => db.query('SELECT public.sweep_my_membership()'))
  const daveExpNotifs = await scalar(
    db,
    `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND type = 'package_expiring'`,
    [dave]
  )
  t.check('sweep_my_membership created package_expiring notification', daveExpNotifs >= 1)

  const daveExpActivity = await scalar(
    db,
    `SELECT count(*)::int FROM public.activity_events WHERE user_id = $1 AND event = 'membership_expired'`,
    [dave]
  )
  t.check('sweep_my_membership logged membership_expired activity', daveExpActivity >= 1)

  // --------------------------------------------------------------------------
  // §9. Individual profile compatibility RPC (PRD Completion)
  // --------------------------------------------------------------------------
  const compatAliceBob = await asUser(db, bob, () => one(
    db,
    'SELECT public.get_profile_compatibility($1) AS res',
    [alice]
  ))
  t.check('compatibility returns a valid object', typeof compatAliceBob.res === 'object' && compatAliceBob.res !== null)
  t.check('compatibility returns numeric score', typeof compatAliceBob.res.score === 'number')
  t.check('compatibility score is within 0-100', compatAliceBob.res.score >= 0 && compatAliceBob.res.score <= 100)
  t.check('compatibility returns reasons array', Array.isArray(compatAliceBob.res.reasons))

  // Self compatibility returns 100
  const selfCompat = await asUser(db, bob, () => one(
    db,
    'SELECT public.get_profile_compatibility($1) AS res',
    [bob]
  ))
  t.equal('self compatibility returns score 100', selfCompat.res.score, 100)

  // Blocked target returns null score
  await asUser(db, bob, () => db.query('SELECT public.block_member($1)', [alice]))
  const blockedCompat = await asUser(db, bob, () => one(
    db,
    'SELECT public.get_profile_compatibility($1) AS res',
    [alice]
  ))
  t.equal('blocked member compatibility returns score null', blockedCompat.res.score, null)
  await asUser(db, bob, () => db.query('SELECT public.unblock_member($1)', [alice]))

  return t
}
