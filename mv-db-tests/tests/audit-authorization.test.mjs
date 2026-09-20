// Step 13: regression tests for directly reproduced audit defects, not new features.
import { Checks, asUser, asService, signUp, completeProfile, activatePackage, one, scalar, expectError } from '../lib/harness.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '../lib/harness.mjs'

export default async function suite(db) {
  const t = new Checks('audit-authorization')
  const users = []
  for (let i = 0; i < 3; i++) {
    const id = await signUp(db, { email: `audit${i}@example.test`, name: `Audit Member ${i}`, mobile: `980123450${i}` })
    await completeProfile(db, id)
    await activatePackage(db, id, 'smart-3-month')
    users.push(id)
  }
  const [a, b, c] = users
  await asUser(db, a, () => one(db, 'select express_interest($1)', [b]))
  const interest = await one(db, 'select id from interests where sender_id=$1 and receiver_id=$2', [a, b])
  const denied = async (name, fn, pattern = /permission denied|PROTECTED_/) => {
    const err = await expectError(fn)
    t.check(name, pattern.test(err), err)
  }
  await denied('receiver cannot forge a different sender and accept', () => asUser(db, b, () => db.query("update interests set sender_id=$1,status='accepted' where id=$2", [c, interest.id])))
  t.equal('forged target contact remains private', await asUser(db, b, () => scalar(db, 'select get_profile_contact($1)', [c])), null)
  await denied('sender cannot rewrite receiver', () => asUser(db, a, () => db.query("update interests set receiver_id=$1,status='withdrawn' where id=$2", [c, interest.id])))
  await denied('timestamps cannot reset interest quotas', () => asUser(db, a, () => db.query("update interests set created_at=now()-interval '60 days',status='withdrawn' where id=$1", [interest.id])))
  await asUser(db, b, () => db.query("update interests set status='accepted' where id=$1", [interest.id]))
  t.equal('legitimate recipient acceptance still reveals consented contact', await asUser(db, b, () => scalar(db, 'select get_profile_contact($1)', [a])), '9801234500')
  t.equal('acceptance still produces notification', await scalar(db, "select count(*)::int from notifications where user_id=$1 and type='interest_accepted'", [a]), 1)
  await asUser(db, a, () => one(db, 'select express_interest($1)', [c]))
  await asUser(db, c, () => one(db, 'select block_member($1)', [a]))
  const blocked = await asUser(db, c, () => db.query("update interests set status='accepted' where sender_id=$1 returning id", [a]))
  t.equal('blocked interest cannot be accepted', blocked.rows.length, 0)

  await denied('old no-argument OTP completion removed', () => asUser(db, a, () => db.query('select complete_mobile_otp_verification()')), /does not exist/)
  await denied('member cannot call new OTP completion', () => asUser(db, a, () => db.query('select complete_mobile_otp_verification($1,$2)', [a, '9801234500'])))
  t.equal('anonymous cannot execute new OTP completion', await scalar(db, "select has_function_privilege('anon', 'public.complete_mobile_otp_verification(uuid,text)', 'EXECUTE')"), false)
  t.equal('denied OTP calls leave flag false', await scalar(db, 'select mobile_verified from profiles where id=$1', [a]), false)
  await denied('service completion requires outstanding request', () => asService(db, () => db.query('select complete_mobile_otp_verification($1,$2)', [a, '9801234500'])), /OTP_REQUEST_REQUIRED/)
  await asUser(db, a, () => db.query('select request_mobile_otp()'))
  await denied('service completion rejects a different verified number', () => asService(db, () => db.query('select complete_mobile_otp_verification($1,$2)', [a, '9801234599'])), /MOBILE_NOT_ON_FILE/)
  await asService(db, () => db.query('select complete_mobile_otp_verification($1,$2)', [a, '9801234500']))
  t.equal('trusted completion with correct binding verifies mobile', await scalar(db, 'select mobile_verified from profiles where id=$1', [a]), true)
  await denied('completion request cannot be replayed', () => asService(db, () => db.query('select complete_mobile_otp_verification($1,$2)', [a, '9801234500'])), /OTP_REQUEST_REQUIRED/)
  await asUser(db, b, () => db.query('select request_mobile_otp()'))
  await db.query("update mobile_otp_requests set requested_at=now()-interval '11 minutes' where user_id=$1", [b])
  await denied('stale OTP window rejected', () => asService(db, () => db.query('select complete_mobile_otp_verification($1,$2)', [b, '9801234501'])), /OTP_REQUEST_REQUIRED/)
  const route = readFileSync(join(repoRoot, 'src/app/api/mobile-otp/verify/route.ts'), 'utf8')
  t.check('route uses fresh service client after provider verification (source assertion)', route.includes("createAdminClient().rpc('complete_mobile_otp_verification'"))
  t.check('route compares provider phone to original requested phone (source assertion)', route.includes('data.user.phone?.replace'))

  await db.query("update matrimony_profiles set status='suspended',admin_hidden_at=now() where user_id=$1", [a])
  await denied('owner cannot unsuspend', () => asUser(db, a, () => db.query("update matrimony_profiles set status='active' where user_id=$1", [a])))
  await denied('owner cannot clear admin hold', () => asUser(db, a, () => db.query('update matrimony_profiles set admin_hidden_at=null where user_id=$1', [a])))
  await denied('owner cannot replace profile to bypass moderation', () => asUser(db, a, () => db.query('delete from matrimony_profiles where user_id=$1', [a])))
  t.equal('suspended profile stays private', await scalar(db, 'select is_profile_public($1)', [a]), false)
  // An owner still edits biodata without mutating protected moderation state.
  await asUser(db, a, () => db.query("update matrimony_profiles set occupation='Teacher' where user_id=$1", [a]))
  t.equal('ordinary biodata edit preserved', await scalar(db, 'select occupation from matrimony_profiles where user_id=$1', [a]), 'Teacher')
  await db.query('update profiles set is_active=false where id=$1', [a])
  await denied('owner cannot reactivate retired account', () => asUser(db, a, () => db.query('update profiles set is_active=true where id=$1', [a])))

  // Simulate a missing-profile repair case: no UPDATE trigger may be relied on for INSERT.
  await db.query('delete from matrimony_profiles where user_id=$1', [b])
  await denied('owner cannot insert preverified profile', () => asUser(db, b, () => db.query('insert into matrimony_profiles(user_id,verified_at) values($1,now())', [b])))
  await denied('owner cannot seed fake moderation bookkeeping', () => asUser(db, b, () => db.query("insert into matrimony_profiles(user_id,suspension_reason) values($1,'forged')", [b])))
  await asUser(db, b, () => db.query('insert into matrimony_profiles(user_id) values($1)', [b]))
  t.equal('ordinary missing draft repair preserved', await scalar(db, 'select status from matrimony_profiles where user_id=$1', [b]), 'draft')
  await asUser(db, c, () => db.query('select delete_my_account()'))
  t.equal('trusted self deletion still hides account', await scalar(db, 'select is_active from profiles where id=$1', [c]), false)
  await denied('deleted account cannot unhide itself', () => asUser(db, c, () => db.query('update profiles set is_active=true where id=$1', [c])))
  const repair = await signUp(db, { email: 'audit-repair@example.test', name: 'Repair Member', mobile: '9801234590' })
  await db.query('delete from profiles where id=$1', [repair])
  await denied('missing-row insert cannot grant admin', () => asUser(db, repair, () => db.query("insert into profiles(id,email,full_name,is_admin) values($1,'audit-repair@example.test','Repair Member',true)", [repair])))
  await denied('missing-row insert cannot forge mobile verification', () => asUser(db, repair, () => db.query("insert into profiles(id,email,full_name,mobile_verified) values($1,'audit-repair@example.test','Repair Member',true)", [repair])))
  await asUser(db, repair, () => db.query("insert into profiles(id,email,full_name) values($1,'audit-repair@example.test','Repair Member')", [repair]))
  t.equal('legitimate missing account row can be repaired', await scalar(db, 'select is_admin from profiles where id=$1', [repair]), false)
  return t
}
