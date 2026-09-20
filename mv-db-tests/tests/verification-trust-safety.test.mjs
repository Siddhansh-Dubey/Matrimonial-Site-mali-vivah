// Step 10 — Verification + Trust & Safety DB test suite.
//
// Proves all Phase 14 RLS / RPC security requirements:
//  1. anon cannot create verification request
//  2. member can create own verification request
//  3. member cannot create verification request for another user
//  4. member cannot approve own verification
//  5. member cannot modify verification status directly
//  6. non-admin cannot read verification documents
//  7. admin can access verification documents
//  8. public RPC does not expose verification documents
//  9. public RPC exposes only intended verified boolean/badge state
// 10. member cannot report self
// 11. member can report another profile
// 12. invalid report reason rejected
// 13. duplicate report handled correctly
// 14. reporter identity hidden from target/member APIs
// 15. member can block another member
// 16. member cannot block self
// 17. duplicate block idempotent
// 18. unblock works
// 19. blocked profile excluded from search
// 20. blocked profile excluded from Daily 5
// 21. blocked profile excluded from featured results
// 22. blocked profile cannot bypass through public profile RPC
// 23. blocked relationship prevents messaging
// 24. admin-only verification RPCs reject normal members
// 25. admin-only report moderation rejects normal members
// 26. admin-only block inspection rejects normal members
// 27. verification approval creates correct activity event
// 28. verification rejection creates correct activity event
// 29. no sensitive document path appears in public payloads
// 30. admin actions create audit records

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
    try {
      await db.exec(`RESET ROLE;
                     SELECT set_config('request.jwt.claim.role', '', false);`)
    } catch { /* aborted transaction fallback */ }
  }
}

async function createAdmin(db, { email, name, mobile }) {
  const userId = await signUp(db, { email, name, mobile })
  await db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [userId])
  return userId
}

async function countEvents(db, userId, event) {
  return scalar(
    db,
    `SELECT count(*)::int AS n FROM public.activity_events WHERE user_id = $1 AND event = $2`,
    [userId, event]
  )
}

export default async function verificationTrustSafetySuite(db) {
  const t = new Checks('verification-trust-safety')

  // Setup actors
  const adminId = await createAdmin(db, {
    email: 'admin.trust@malivivah.test',
    name: 'Admin Moderator',
    mobile: '9800000001',
  })

  const alice = await signUp(db, {
    email: 'alice.trust@malivivah.test',
    name: 'Alice Member',
    mobile: '9800000002',
  })
  await completeProfile(db, alice, { gender: 'female' })
  await activatePackage(db, alice, 'smart-3-month')

  const bob = await signUp(db, {
    email: 'bob.trust@malivivah.test',
    name: 'Bob Member',
    mobile: '9800000003',
  })
  await completeProfile(db, bob, { gender: 'male' })
  await activatePackage(db, bob, 'premium-6-month')

  const charlie = await signUp(db, {
    email: 'charlie.trust@malivivah.test',
    name: 'Charlie Member',
    mobile: '9800000004',
  })
  await completeProfile(db, charlie, { gender: 'male' })
  await activatePackage(db, charlie, 'smart-3-month')

  // =========================================================================
  console.log(' [1] Verification Request Authorization')
  // =========================================================================

  // 1. anon cannot create verification request
  const anonErr = await expectError(() =>
    asAnon(db, () =>
      db.query(
        `INSERT INTO public.verification_requests (user_id, type, status) VALUES ($1, 'photo', 'pending')`,
        [alice]
      )
    )
  )
  t.check('anon cannot create verification request', /permission denied/.test(anonErr), anonErr)

  // 2. member can create own verification request
  const vReq1 = await asUser(db, alice, () =>
    one(
      db,
      `INSERT INTO public.verification_requests (user_id, type, status, storage_path)
       VALUES ($1, 'photo', 'pending', $2) RETURNING id`,
      [alice, `${alice}/selfie.jpg`]
    )
  )
  t.check('member can create own verification request', Boolean(vReq1?.id))

  // Verify submission notification was pushed
  const subNotif = await scalar(
    db,
    `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND title = 'Verification request submitted'`,
    [alice]
  )
  t.equal('submission creates member notification', subNotif, 1)

  // 3. member cannot create verification request for another user
  const forgedErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(
        `INSERT INTO public.verification_requests (user_id, type, status) VALUES ($1, 'photo', 'pending')`,
        [alice]
      )
    )
  )
  t.check('member cannot create verification request for another user', /violates row-level security/.test(forgedErr), forgedErr)

  // 4. member cannot approve own verification
  const approveErr = await expectError(() =>
    asUser(db, alice, () =>
      db.query(`UPDATE public.matrimony_profiles SET verified_at = now() WHERE user_id = $1`, [alice])
    )
  )
  t.check('member cannot approve own verification', /CANNOT_MODIFY_VERIFICATION_STATUS/.test(approveErr), approveErr)

  // 5. member cannot modify verification status directly
  // 5a: Cannot insert request with status = 'verified'
  const forgedStatusErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(
        `INSERT INTO public.verification_requests (user_id, type, status) VALUES ($1, 'photo', 'verified')`,
        [bob]
      )
    )
  )
  t.check('member cannot insert verified status directly', /violates row-level security/.test(forgedStatusErr), forgedStatusErr)

  // 5b: Cannot set mobile_verified = true directly
  const forgedMobileErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(`UPDATE public.profiles SET mobile_verified = TRUE WHERE id = $1`, [bob])
    )
  )
  t.check('member cannot directly set mobile_verified = TRUE', /CANNOT_MODIFY_VERIFICATION_STATUS/.test(forgedMobileErr), forgedMobileErr)

  // 5c: Cannot set is_admin = true directly
  const forgedAdminErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(`UPDATE public.profiles SET is_admin = TRUE WHERE id = $1`, [bob])
    )
  )
  t.check('member cannot directly set is_admin = TRUE', /CANNOT_MODIFY_ADMIN_ROLE/.test(forgedAdminErr), forgedAdminErr)

  // 5d: Changing mobile resets mobile_verified
  await db.query(`UPDATE public.profiles SET mobile_verified = TRUE WHERE id = $1`, [bob])
  await asUser(db, bob, () =>
    db.query(`UPDATE public.profiles SET mobile = '9800000099' WHERE id = $1`, [bob])
  )
  const bobMobileVerified = await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id = $1`, [bob])
  t.equal('changing mobile invalidates mobile_verified', bobMobileVerified, false)

  // =========================================================================
  console.log(' [2] Document Privacy & Public Payloads')
  // =========================================================================

  // Setup storage schema & verification-docs policies if running in test environment
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS storage;
    GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;

    CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
    RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;

    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT NOT NULL,
      name TEXT NOT NULL,
      owner UUID
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT ON storage.objects TO authenticated;
    GRANT ALL ON storage.objects TO service_role;

    DROP POLICY IF EXISTS "Members read own verification docs" ON storage.objects;
    CREATE POLICY "Members read own verification docs"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'verification-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  `)

  // Insert mock storage objects for verification-docs
  await db.query(`
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('verification-docs', $1, $2)
    ON CONFLICT DO NOTHING
  `, [`${alice}/selfie.jpg`, alice])

  // 6. non-admin cannot read verification documents in storage
  const docReadBob = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'verification-docs' AND name = $1`, [`${alice}/selfie.jpg`])
  )
  t.equal('non-admin cannot read verification documents', docReadBob, 0)

  // 7. admin can access verification documents (via service role / signed url generation)
  const docReadAdmin = await asService(db, () =>
    scalar(db, `SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'verification-docs' AND name = $1`, [`${alice}/selfie.jpg`])
  )
  t.equal('admin can access verification documents', docReadAdmin, 1)

  // 8. public RPC does not expose verification documents
  const pubProfileAlice = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_public_profile($1) AS p`, [alice])
  )
  t.check('public RPC does not expose verification document path', !JSON.stringify(pubProfileAlice).includes('selfie.jpg'))
  t.check('public RPC does not expose verification_requests table data', !JSON.stringify(pubProfileAlice).includes('verification_requests'))

  // 9. public RPC exposes only intended verified boolean/badge state
  t.equal('public RPC exposes unverified state as false', pubProfileAlice.verified, false)

  // Admin approves alice's verification via RPC
  await asService(db, () =>
    db.query(
      `SELECT public.admin_decide_verification($1, $2, 'verified', 'Photo matches profile')`,
      [adminId, vReq1.id]
    )
  )

  const pubProfileAliceAfter = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_public_profile($1) AS p`, [alice])
  )
  t.equal('public RPC exposes verified state as true after approval', pubProfileAliceAfter.verified, true)

  // 27. verification approval creates correct activity events
  t.equal('verification_approved recorded', await countEvents(db, alice, 'verification_approved'), 1)
  t.equal('profile_verified recorded', await countEvents(db, alice, 'profile_verified'), 1)

  // 28. verification rejection creates correct activity event
  const vReqCharlie = await asUser(db, charlie, () =>
    one(
      db,
      `INSERT INTO public.verification_requests (user_id, type, status, storage_path)
       VALUES ($1, 'id_document', 'pending', $2) RETURNING id`,
      [charlie, `${charlie}/id.jpg`]
    )
  )
  await asService(db, () =>
    db.query(
      `SELECT public.admin_decide_verification($1, $2, 'rejected', 'Document blurry, please resubmit')`,
      [adminId, vReqCharlie.id]
    )
  )
  t.equal('verification_rejected recorded', await countEvents(db, charlie, 'verification_rejected'), 1)

  // 29. no sensitive document path appears in public payloads
  const searchPayload = await asUser(db, bob, () =>
    scalar(db, `SELECT public.search_matches('female') AS matches`)
  )
  t.check('no document path appears in search payload', !JSON.stringify(searchPayload).includes('.jpg') || !JSON.stringify(searchPayload).includes('selfie'))
  const dailyPayload = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_daily_matches() AS d5`)
  )
  t.check('no verification document path appears in Daily 5', !JSON.stringify(dailyPayload).includes('selfie.jpg'))

  // =========================================================================
  console.log(' [3] Profile Reporting')
  // =========================================================================

  // 10. member cannot report self
  const repSelfErr = await expectError(() =>
    asUser(db, alice, () =>
      db.query(`SELECT public.report_profile($1, 'spam')`, [alice])
    )
  )
  t.check('member cannot report self', /CANNOT_REPORT_SELF/.test(repSelfErr), repSelfErr)

  // 11. member can report another profile
  const repRes = await asUser(db, alice, () =>
    scalar(db, `SELECT public.report_profile($1, 'fake_profile', 'Photos appear stock') AS r`, [bob])
  )
  t.equal('member can report another profile', repRes.status, 'filed')

  // 12. invalid report reason rejected
  const invReasonErr = await expectError(() =>
    asUser(db, alice, () =>
      db.query(`SELECT public.report_profile($1, 'nonexistent_reason')`, [bob])
    )
  )
  t.check('invalid report reason rejected', /invalid input value for enum report_reason/.test(invReasonErr), invReasonErr)

  // 13. duplicate report handled correctly (deduplicated, no error)
  const repDupRes = await asUser(db, alice, () =>
    scalar(db, `SELECT public.report_profile($1, 'fake_profile', 'Duplicate attempt') AS r`, [bob])
  )
  t.equal('duplicate report handled cleanly as already_reported', repDupRes.status, 'already_reported')
  t.equal('report id matches existing report', repDupRes.report_id, repRes.report_id)

  // 14. reporter identity hidden from target/member APIs
  const bobReadsReports = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int FROM public.reports WHERE reported_id = $1`, [bob])
  )
  t.equal('target cannot see reports filed against them', bobReadsReports, 0)

  // =========================================================================
  console.log(' [4] Blocking & Cross-Surface Enforcement')
  // =========================================================================

  // Baseline: Alice and Bob can see each other in search before blocking
  const aliceFindsBobBefore = await asUser(db, alice, () =>
    scalar(db, `SELECT public.search_matches('male') AS matches`)
  )
  t.check('bob is discoverable before block', JSON.stringify(aliceFindsBobBefore).includes(bob))

  // 16. member cannot block self
  const blockSelfErr = await expectError(() =>
    asUser(db, alice, () =>
      db.query(`SELECT public.block_member($1)`, [alice])
    )
  )
  t.check('member cannot block self', /CANNOT_BLOCK_SELF/.test(blockSelfErr), blockSelfErr)

  // 15. member can block another member
  const blockRes = await asUser(db, alice, () =>
    scalar(db, `SELECT public.block_member($1, 'Unwanted contact') AS b`, [bob])
  )
  t.equal('member can block another member', blockRes.status, 'blocked')

  // 17. duplicate block idempotent
  const blockDupRes = await asUser(db, alice, () =>
    scalar(db, `SELECT public.block_member($1, 'Duplicate block call') AS b`, [bob])
  )
  t.equal('duplicate block is idempotent', blockDupRes.status, 'blocked')

  // 19. blocked profile excluded from search (in both directions)
  const aliceFindsBobAfter = await asUser(db, alice, () =>
    scalar(db, `SELECT public.search_matches('male') AS matches`)
  )
  t.check('blocked member excluded from blocker search', !JSON.stringify(aliceFindsBobAfter).includes(bob))

  const bobFindsAlice = await asUser(db, bob, () =>
    scalar(db, `SELECT public.search_matches('female') AS matches`)
  )
  t.check('blocker excluded from blocked member search', !JSON.stringify(bobFindsAlice).includes(alice))

  // 20. blocked profile excluded from Daily 5
  const bobDaily = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_daily_matches() AS d5`)
  )
  t.check('blocker excluded from Daily 5', !JSON.stringify(bobDaily).includes(alice))

  // 21. blocked profile excluded from featured results
  await db.query(
    `INSERT INTO public.featured_profiles (profile_id, position) VALUES ($1, 1) ON CONFLICT (profile_id) DO UPDATE SET position = 1`,
    [alice]
  )
  const bobFeatured = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_featured_profiles() AS f`)
  )
  t.check('blocked profile excluded from featured results', !JSON.stringify(bobFeatured).includes(alice))

  // 22. blocked profile cannot bypass through public profile RPC or direct table select
  const bobViewsAliceRpc = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_public_profile($1) AS p`, [alice])
  )
  t.check('blocked profile cannot bypass via get_public_profile', bobViewsAliceRpc === null)

  const bobDirectTableRead = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int FROM public.matrimony_profiles WHERE user_id = $1`, [alice])
  )
  t.equal('blocked profile cannot be read directly via table RLS', bobDirectTableRead, 0)

  const bobDirectPhotoRead = await asUser(db, bob, () =>
    scalar(db, `SELECT count(*)::int FROM public.profile_photos WHERE profile_id = $1`, [alice])
  )
  t.equal('blocked photos cannot be read directly via table RLS', bobDirectPhotoRead, 0)

  // 23. blocked relationship prevents messaging
  const chatElig = await asUser(db, bob, () =>
    scalar(db, `SELECT public.chat_eligibility($1)`, [alice])
  )
  t.equal('blocked relationship prevents messaging', chatElig.allowed, false)

  const canChat = await scalar(db, `SELECT public.can_chat_with($1, $2)`, [bob, alice])
  t.equal('blocked relationship can_chat_with returns false', canChat, false)

  // Phone reveal gate: get_profile_contact returns NULL when blocked
  const contactRevealed = await asUser(db, bob, () =>
    scalar(db, `SELECT public.get_profile_contact($1)`, [alice])
  )
  t.equal('blocked relationship suppresses contact reveal', contactRevealed, null)

  // 18. unblock works
  const unblockRes = await asUser(db, alice, () =>
    scalar(db, `SELECT public.unblock_member($1) AS u`, [bob])
  )
  t.equal('unblock works', unblockRes.status, 'unblocked')

  const aliceFindsBobRestored = await asUser(db, alice, () =>
    scalar(db, `SELECT public.search_matches('male') AS matches`)
  )
  t.check('unblocked member reappears in search', JSON.stringify(aliceFindsBobRestored).includes(bob))

  // =========================================================================
  console.log(' [5] Admin RPC Security & Audit Logging')
  // =========================================================================

  // 24. admin-only verification RPCs reject normal members
  const memberDecideErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(`SELECT public.admin_decide_verification($1, $2, 'verified')`, [bob, vReq1.id])
    )
  )
  t.check('admin verification RPC rejects normal member', /permission denied|ADMIN_ONLY/.test(memberDecideErr), memberDecideErr)

  // 25. admin-only report moderation rejects normal members
  const memberReportErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(`SELECT public.admin_resolve_report($1, $2, 'resolved')`, [bob, repRes.report_id])
    )
  )
  t.check('admin report moderation RPC rejects normal member', /permission denied|ADMIN_ONLY/.test(memberReportErr), memberReportErr)

  // 26. admin-only block inspection rejects normal members
  const memberBlockInspectErr = await expectError(() =>
    asUser(db, bob, () =>
      db.query(`SELECT public.admin_list_blocks($1)`, [bob])
    )
  )
  t.check('admin block inspection RPC rejects normal member', /permission denied|ADMIN_ONLY/.test(memberBlockInspectErr), memberBlockInspectErr)

  // 30. admin actions create audit records
  // Execute admin resolve report
  await asService(db, () =>
    db.query(`SELECT public.admin_resolve_report($1, $2, 'resolved', 'Verified and closed')`, [adminId, repRes.report_id])
  )

  const auditCount = await scalar(
    db,
    `SELECT count(*)::int FROM public.admin_audit_log WHERE admin_id = $1 AND action = 'report_resolved'`,
    [adminId]
  )
  t.equal('admin resolve report writes audit record', auditCount, 1)

  const verifyAuditCount = await scalar(
    db,
    `SELECT count(*)::int FROM public.admin_audit_log WHERE admin_id = $1 AND action = 'verification_verified'`,
    [adminId]
  )
  t.equal('admin decide verification writes audit record', verifyAuditCount, 1)

  return t
}
