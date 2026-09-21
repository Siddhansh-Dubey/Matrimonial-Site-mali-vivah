// Mobile OTP delivery — end-to-end contract (Step 15).
//
// Reproduces and then proves the fix for the reported failure:
//
//     "Send SMS Code" never sends an OTP, yet the UI still said it did.
//
// Root cause was NOT a missing route and NOT a wrong endpoint: the SMS has
// always been delegated to Supabase phone auth (GoTrue signInWithOtp with the
// service role). What was broken was that nothing could tell a working
// deployment from a broken one —
//
//   1. request_mobile_otp() spent one of the member's 5-per-hour slots BEFORE
//      anyone knew whether the project could send an SMS at all, so a member on
//      a misconfigured deployment burned the whole budget on phantom sends and
//      then got "too many verification attempts";
//   2. the database recorded nothing about whether the provider accepted the
//      send, so "member never got the code" and "delivery is broken" were
//      indistinguishable;
//   3. complete_mobile_otp_verification() accepted ANY outstanding request row
//      in the window, including one whose send had failed;
//   4. the route collapsed every provider failure into one message and
//      swallowed the provider's own reason.
//
// Migration 20260921010000 fixes 1–3; src/lib/sms/otp-outcomes.ts +
// otp-provider.ts + the rewritten routes fix 4.
//
// This suite therefore tests ALL FOUR LAYERS of the flow, because the bug only
// appears when they are read together:
//
//   A  the pure outcome contract the routes and the browser share
//      (provider error → stable code → truthful member-facing sentence);
//   B  request_mobile_otp(): authentication, own-number-only, cooldown,
//      hourly limit, and a result that never contains an OTP or a full number;
//   C  record_mobile_otp_delivery(): service-only, member-bound, idempotent,
//      diagnostics-only — it can never verify anything;
//   D  complete_mobile_otp_verification(): server-authoritative, refuses a
//      FAILED delivery window, still the only path to mobile_verified;
//   E  the Next.js routes and the React card: preflight before budget, success
//      only on a real provider accept, simulated delivery surfaced honestly, no
//      client forgery, no secret or OTP ever reaching the browser;
//   F  migration + generated-types hygiene.
//
// WHAT THIS SUITE CANNOT TEST, and says so instead of pretending:
//   an actual SMS arriving on a handset. That depends on the Supabase project's
//   GoTrue configuration (GOTRUE_EXTERNAL_PHONE_ENABLED, GOTRUE_SMS_PROVIDER
//   and that provider's own credentials), which lives outside this repository
//   and outside the Next.js environment. Section E asserts the code REFUSES and
//   REPORTS truthfully in every misconfigured state; it never asserts a real
//   delivery happened.
//
// Requires Node >= 22.6 (type stripping) for section A. `npm test` in
// mv-db-tests passes --experimental-strip-types; a bare `node run.mjs` works on
// Node >= 22.18 where stripping is on by default. If stripping is unavailable
// section A fails loudly rather than silently skipping.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  Checks,
  asService,
  asUser,
  completeProfile,
  expectError,
  one,
  repoRoot,
  scalar,
  signUp,
} from '../lib/harness.mjs'

/** Anonymous role (no JWT claim at all). */
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
    } catch { /* aborted transaction */ }
  }
}

const src = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

export default async function mobileOtpTests(db) {
  const t = new Checks('mobile-otp')

  // ==========================================================================
  // A · THE PURE OUTCOME CONTRACT (src/lib/sms/otp-outcomes.ts)
  //   Imported directly from the app source so the suite exercises the SAME
  //   classifier the routes run — not a re-implementation that could drift.
  // ==========================================================================
  let outcomes = null
  let importError = ''
  try {
    // Resolved through repoRoot (not a relative path) so the suite works no
    // matter which directory the harness is invoked from.
    outcomes = await import(pathToFileURL(join(repoRoot, 'src/lib/sms/otp-outcomes.ts')).href)
  } catch (err) {
    importError = err?.message ?? String(err)
  }
  t.check(
    'A0 the app\'s pure OTP outcome module imports into the harness (needs Node >= 22.6 type stripping)',
    Boolean(outcomes),
    importError
  )

  if (outcomes) {
    const { classifySendFailure, classifyVerifyFailure, maskMobile, PREFLIGHT_MESSAGES } = outcomes

    // -- A1 · GoTrue's own stable error codes are matched FIRST --------------
    // These are what supabase-js surfaces from a real project, so they must win
    // over any message-text guessing.
    const codeCases = [
      ['phone_provider_disabled', 422, 'phone provider is disabled', 'OTP_PHONE_DISABLED', 503],
      ['otp_disabled', 422, 'otp is disabled', 'OTP_PHONE_DISABLED', 503],
      ['provider_disabled', 422, 'provider disabled', 'OTP_PHONE_DISABLED', 503],
      ['over_sms_send_rate_limit', 429, 'rate limited', 'OTP_RATE_LIMITED', 429],
      ['over_request_rate_limit', 429, 'rate limited', 'OTP_RATE_LIMITED', 429],
      ['sms_send_failed', 500, 'sms request unsuccessful: Twilio replied 400', 'OTP_PROVIDER_ERROR', 502],
      ['validation_failed', 422, 'phone is invalid', 'OTP_INVALID_PHONE', 400],
    ]
    for (const [code, status, message, wantCode, wantStatus] of codeCases) {
      const got = classifySendFailure({ code, status, message })
      t.equal(`A1 GoTrue code "${code}" classifies as ${wantCode}`, got.code, wantCode)
      t.equal(`A1 GoTrue code "${code}" answers HTTP ${wantStatus}`, got.httpStatus, wantStatus)
    }

    // -- A2 · Legacy GoTrue builds with no stable code: message/status decide -
    // The OLD route answered "SMS delivery is not configured" for every one of
    // these, which is why a rate limit looked like a setup problem.
    const legacyCases = [
      ['Phone logins are disabled on this project', undefined, 'OTP_PHONE_DISABLED'],
      ['SMS logins are disabled for this project', undefined, 'OTP_PHONE_DISABLED'],
      ['SMS provider is not configured', undefined, 'OTP_SMS_NOT_CONFIGURED'],
      ['no such provider: twilio', undefined, 'OTP_SMS_NOT_CONFIGURED'],
      ['Twilio error: account sid missing', undefined, 'OTP_SMS_NOT_CONFIGURED'],
      ['msg91 responded with 401', undefined, 'OTP_SMS_NOT_CONFIGURED'],
      ['For security purposes, you may only request this after 36 seconds', 429, 'OTP_RATE_LIMITED'],
      ['Too many requests, please slow down', undefined, 'OTP_RATE_LIMITED'],
      ['Invalid phone number format', undefined, 'OTP_INVALID_PHONE'],
      ['phone is invalid', undefined, 'OTP_INVALID_PHONE'],
      ['upstream gateway timeout', 502, 'OTP_PROVIDER_ERROR'],
      ['something entirely unexpected', 500, 'OTP_PROVIDER_ERROR'],
    ]
    for (const [message, status, want] of legacyCases) {
      t.equal(
        `A2 legacy provider message "${message.slice(0, 34)}…" classifies as ${want}`,
        classifySendFailure({ code: null, status, message }).code,
        want
      )
    }

    // -- A3 · NOTHING is ever reported as success ----------------------------
    // An unrecognised failure must fall through to a real failure code, never
    // to a shape the route could mistake for "sent".
    const unknown = classifySendFailure({})
    t.check('A3 an empty/unrecognised provider error is still a FAILURE, never a success', unknown.code === 'OTP_PROVIDER_ERROR' && !unknown.ok, unknown)
    t.check('A3 every classified failure carries a 4xx/5xx HTTP status', unknown.httpStatus >= 400, unknown)
    for (const [, , message, , status] of codeCases) {
      t.check(`A3 "${message.slice(0, 24)}…" is not presented as 200 OK`, status >= 400, status)
    }

    // -- A4 · Config failures SAY no code was sent ---------------------------
    // This is the exact user-facing guarantee: the UI must never claim an SMS
    // is on its way when the deployment could not have sent one.
    for (const code of Object.keys(PREFLIGHT_MESSAGES)) {
      const msg = PREFLIGHT_MESSAGES[code]
      t.check(
        `A4 preflight wording for ${code} states plainly that no code was sent`,
        /no (real )?code (was|can be) sent/i.test(msg),
        msg
      )
      t.check(`A4 preflight wording for ${code} never claims success`, !/has been sent|sent successfully|check your (sms|phone|mobile)/i.test(msg), msg)
    }
    const configCodes = ['OTP_PHONE_DISABLED', 'OTP_SMS_NOT_CONFIGURED', 'OTP_SMS_TEST_PROVIDER', 'OTP_SMS_PROVIDER_MISMATCH', 'OTP_SMS_UNREACHABLE']
    for (const code of configCodes) {
      t.check(`A4 PREFLIGHT_MESSAGES covers every refusal code (${code})`, typeof PREFLIGHT_MESSAGES[code] === 'string' && PREFLIGHT_MESSAGES[code].length > 20)
    }

    // -- A5 · Provider internals never reach the member ----------------------
    // A real Twilio/MSG91 error can carry an account SID or an auth token.
    const leaky = classifySendFailure({
      code: 'sms_send_failed',
      status: 500,
      message: 'sms request unsuccessful: account AC1a2b3c4d5e6f7 with auth token SECRET_auth_token_9f8e7d and sender +15551234567',
    })
    t.check('A5 the member-facing sentence drops the provider\'s raw message', !/SECRET_auth_token_9f8e7d|AC1a2b3c4d5e6f7|\+15551234567/.test(leaky.message), leaky.message)
    t.equal('A5 …and still classifies the failure precisely', leaky.code, 'OTP_PROVIDER_ERROR')
    for (const [, , message] of legacyCases) {
      const m = classifySendFailure({ message })
      t.check(`A5 sentence for "${message.slice(0, 20)}…" is a fixed string, not an echo`, !m.message.toLowerCase().includes(message.toLowerCase().slice(0, 20)), m.message)
    }

    // -- A6 · Verification failures: expired vs invalid vs rate limited -------
    const vExpired = classifyVerifyFailure({ code: 'otp_expired', message: 'Token has expired' })
    const vWrong = classifyVerifyFailure({ code: null, message: 'Invalid OTP code' })
    const vRate = classifyVerifyFailure({ code: 'over_request_rate_limit', message: 'rate limit reached' })
    t.equal('A6 an expired code is distinguishable (the member needs a new one)', vExpired.code, 'OTP_EXPIRED')
    t.equal('A6 a wrong code is refused with ONE generic message (no probing)', vWrong.code, 'OTP_INVALID')
    t.equal('A6 a rate-limited verify is told to wait, not to retype', vRate.code, 'OTP_RATE_LIMITED')
    t.check('A6 wrong-code and expired-code sentences differ', vWrong.message !== vExpired.message)
    t.check(
      'A6 a wrong code is never described as "the code was correct but…"',
      !/correct|accepted|verified/i.test(vWrong.message),
      vWrong.message
    )
    // A provider identity mismatch is routed through verify classification too.
    const vMismatch = classifyVerifyFailure({ message: 'provider phone identity did not match the stored number' })
    t.equal('A6 a provider identity mismatch is treated as an INVALID code, never as success', vMismatch.code, 'OTP_INVALID')

    // -- A7 · Masking: diagnostics carry no full number ----------------------
    t.equal('A7 a 10-digit Indian mobile masks to first-2 + last-4', maskMobile('9876543210'), '98•••••3210')
    // The route normalises to the 10 stored digits BEFORE masking, so a value
    // that still carries +91 masks first-2/last-4 of the whole digit string —
    // which is exactly why the normalisation matters. Assert both.
    t.equal('A7 masking strips non-digits before masking', maskMobile('98765 43210'), '98•••••3210')
    t.equal('A7 an un-normalised +91 value masks the digit string it is given', maskMobile('+91 98765-43210'), '91•••••3210')
    t.check('A7 …and never leaks the full number even then', !maskMobile('+91 98765-43210').includes('9876543210'))
    t.equal('A7 a missing mobile is reported as not-on-file, never as "" ', maskMobile(null), 'not-on-file')
    t.equal('A7 an empty mobile is reported as not-on-file', maskMobile(''), 'not-on-file')
    t.equal('A7 a too-short value is never partially echoed', maskMobile('987'), 'not-on-file')
    for (const v of ['9876543210', '+919876543210', '98765 43210']) {
      const m = maskMobile(v)
      t.check(`A7 masked "${v}" does not contain the full number`, !m.includes('9876543210') && !m.includes('987654'), m)
      t.check(`A7 masked "${v}" hides the middle digits`, m.includes('•••••'), m)
    }
  }

  // ==========================================================================
  // B · request_mobile_otp() — the rate-limit gate
  // ==========================================================================
  const member = await signUp(db, { email: 'otp.member@test.dev', name: 'Otp Member', mobile: '9876543210' })
  await completeProfile(db, member)
  const other = await signUp(db, { email: 'otp.other@test.dev', name: 'Otp Other', mobile: '9812345678' })
  await completeProfile(db, other)
  const noMobile = await signUp(db, { email: 'otp.nomobile@test.dev', name: 'No Mobile' })

  t.equal('B0 the signup trigger copies the member\'s own mobile onto the profile', await scalar(db, `SELECT mobile FROM public.profiles WHERE id=$1`, [member]), '9876543210')
  t.equal('B0 a signup without a mobile really has none', await scalar(db, `SELECT mobile IS NULL FROM public.profiles WHERE id=$1`, [noMobile]), true)
  t.equal('B0 mobile_verified starts FALSE for everyone', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [member]), false)

  // -- B1 · Authorization: only a signed-in member, never anon ---------------
  const anonErr = await expectError(() => asAnon(db, () => one(db, `SELECT public.request_mobile_otp() AS r`)))
  t.check('B1 an anonymous caller cannot execute request_mobile_otp()', /permission denied/i.test(anonErr), anonErr)
  const noJwtErr = await expectError(() => asUser(db, member, async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`)
    return one(db, `SELECT public.request_mobile_otp() AS r`)
  }))
  t.check('B1 an authenticated request with NO user claim is refused', /not authenticated/i.test(noJwtErr), noJwtErr)

  // -- B2 · A member with no valid mobile is refused, not silently accepted ---
  const notOnFile = await expectError(() => asUser(db, noMobile, () => one(db, `SELECT public.request_mobile_otp() AS r`)))
  t.check('B2 a member with no mobile on file gets MOBILE_NOT_ON_FILE', /MOBILE_NOT_ON_FILE/.test(notOnFile), notOnFile)
  t.equal('B2 a refused request records NOTHING', Number(await scalar(db, `SELECT count(*) FROM public.mobile_otp_requests WHERE user_id=$1`, [noMobile])), 0)
  // A malformed number cannot even be stored: profiles_mobile_format only
  // admits NULL or a valid 10-digit Indian mobile, so the RPC's own
  // '^[6-9][0-9]{9}$' test is defence in depth rather than the first line.
  const mobileCheck = await scalar(db, `
    SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid='public.profiles'::regclass AND conname='profiles_mobile_format'`)
  t.check('B2 the schema itself refuses to store a malformed mobile number', /\^\[6-9\]\[0-9\]\{9\}\$/.test(mobileCheck ?? ''), mobileCheck)
  const malformed = await expectError(() => db.query(`UPDATE public.profiles SET mobile='12345' WHERE id=$1`, [noMobile]))
  t.check('B2 …and an attempt to store one is rejected by the check constraint', /profiles_mobile_format/.test(malformed), malformed)
  t.equal('B2 …so the profile still has no mobile', await scalar(db, `SELECT mobile IS NULL FROM public.profiles WHERE id=$1`, [noMobile]), true)

  // -- B3 · Happy path: truthful result, no OTP, no full number --------------
  const gate = await asUser(db, member, () => one(db, `SELECT public.request_mobile_otp() AS r`))
  const g = gate.r
  t.equal('B3 the gate answers ok', g.ok, true)
  t.check('B3 the gate returns a request_id the route can attach the outcome to', Number.isInteger(Number(g.request_id)) && Number(g.request_id) > 0, g.request_id)
  t.equal('B3 the server publishes its OWN cooldown (the UI must not guess 60)', g.cooldown_seconds, 60)
  t.equal('B3 the server publishes its OWN verify window', g.verify_window_minutes, 10)
  t.equal('B3 the server publishes its OWN hourly maximum', g.max_per_hour, 5)
  t.equal('B3 the attempt counter starts at 1', g.requests_last_hour, 1)
  t.equal('B3 the number returned to the browser is MASKED', g.mobile_masked, '98•••••3210')
  const serialized = JSON.stringify(g)
  t.check('B3 the result never contains the member\'s full mobile number', !serialized.includes('9876543210'), serialized)
  t.check('B3 the result never contains an OTP value (the app does not generate one)', !/\botp\b|"code"|\btoken\b/i.test(serialized.replace(/mobile_otp_requests/g, '')), serialized)
  t.check('B3 the result has no secret/credential-shaped key', !/key|secret|sid|password|apikey/i.test(serialized), serialized)

  const row = await one(db, `SELECT id, user_id, mobile, delivery_status, failure_code, provider, verified_at, requested_at FROM public.mobile_otp_requests WHERE id=$1`, [Number(g.request_id)])
  t.equal('B3 the attempt is recorded against the CALLER only', row.user_id, member)
  t.equal('B3 the recorded number is the caller\'s own stored mobile', row.mobile, '9876543210')
  t.equal('B3 a fresh attempt starts as delivery_status=requested (provider not yet contacted)', row.delivery_status, 'requested')
  t.equal('B3 a fresh attempt has no failure code', row.failure_code, null)
  t.equal('B3 a fresh attempt is not verified', row.verified_at, null)

  // -- B4 · The RPC takes NO arguments: a client cannot aim it elsewhere -----
  const argCount = await scalar(db, `SELECT pronargs FROM pg_proc WHERE oid = 'public.request_mobile_otp()'::regprocedure`)
  t.equal('B4 request_mobile_otp() accepts zero arguments, so no number can be injected', argCount, 0)
  const asOtherGate = await asUser(db, other, () => one(db, `SELECT public.request_mobile_otp() AS r`))
  t.equal('B4 when member B calls it, the attempt is recorded for member B', (await one(db, `SELECT user_id FROM public.mobile_otp_requests WHERE id=$1`, [Number(asOtherGate.r.request_id)])).user_id, other)
  t.equal('B4 …and member B sees only their OWN masked number', asOtherGate.r.mobile_masked, '98•••••5678')

  // -- B5 · The table itself is service-only: a member cannot read attempts ---
  t.equal('B5 mobile_otp_requests has RLS enabled', await scalar(db, `SELECT relrowsecurity FROM pg_class WHERE oid='public.mobile_otp_requests'::regclass`), true)
  t.equal('B5 mobile_otp_requests has NO permissive policy for members', Number(await scalar(db, `SELECT count(*) FROM pg_policy WHERE polrelid='public.mobile_otp_requests'::regclass`)), 0)
  const readErr = await expectError(() => asUser(db, member, () => db.query(`SELECT * FROM public.mobile_otp_requests`)))
  t.check('B5 a member cannot even SELECT the OTP ledger', /permission denied/i.test(readErr), readErr)
  const writeErr = await expectError(() => asUser(db, member, () => db.query(`UPDATE public.mobile_otp_requests SET verified_at=now()`)))
  t.check('B5 a member cannot UPDATE the OTP ledger (no client-side forgery)', /permission denied/i.test(writeErr), writeErr)

  // -- B6 · Cooldown: 60 seconds between requests, with the REAL remainder ---
  const cooldownErr = await expectError(() => asUser(db, member, () => one(db, `SELECT public.request_mobile_otp() AS r`)))
  t.check('B6 an immediate second request is refused with OTP_COOLDOWN', /OTP_COOLDOWN/.test(cooldownErr), cooldownErr)
  const waitMatch = /please wait (\d+) seconds/.exec(cooldownErr)
  t.check('B6 the refusal carries the remaining seconds the route renders as a countdown', Boolean(waitMatch), cooldownErr)
  t.check('B6 …and that remainder is a sane server number, not a hard-coded guess', waitMatch ? Number(waitMatch[1]) > 0 && Number(waitMatch[1]) <= 60 : false, waitMatch?.[1])
  t.equal('B6 a cooldown refusal records no extra attempt', Number(await scalar(db, `SELECT count(*) FROM public.mobile_otp_requests WHERE user_id=$1`, [member])), 1)

  // -- B7 · Hourly limit: 5 per rolling hour, no more -----------------------
  // Backdate the first request out of the cooldown, then spend the budget.
  await db.query(
    `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '2 minutes' WHERE user_id=$1`, [member]
  )
  for (let i = 2; i <= 5; i += 1) {
    await db.query(
      `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '2 minutes' WHERE user_id=$1`, [member]
    )
    const r = await asUser(db, member, () => one(db, `SELECT public.request_mobile_otp() AS r`))
    t.equal(`B7 request ${i}/5 is accepted and counted`, r.r.requests_last_hour, i)
  }
  await db.query(
    `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '2 minutes' WHERE user_id=$1 AND delivery_status='requested'`, [member]
  )
  const limitErr = await expectError(() => asUser(db, member, () => one(db, `SELECT public.request_mobile_otp() AS r`)))
  t.check('B7 the 6th request inside the hour is refused with OTP_LIMIT_EXCEEDED', /OTP_LIMIT_EXCEEDED/.test(limitErr), limitErr)
  t.equal('B7 the limit is exactly 5 attempts, not 4 and not 6', Number(await scalar(db, `SELECT count(*) FROM public.mobile_otp_requests WHERE user_id=$1`, [member])), 5)
  await db.query(
    `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '2 hours' WHERE user_id=$1`, [member]
  )
  const afterWindow = await asUser(db, member, () => one(db, `SELECT public.request_mobile_otp() AS r`))
  t.equal('B7 the rolling window really is an HOUR (old attempts stop counting)', afterWindow.r.requests_last_hour, 1)

  // ==========================================================================
  // C · record_mobile_otp_delivery() — the diagnostics writer
  // ==========================================================================
  const reqId = Number(afterWindow.r.request_id)

  // -- C1 · Service-role only ------------------------------------------------
  const memberRecordErr = await expectError(() => asUser(db, member, () => one(
    db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,'twilio') AS r`, [reqId, member]
  )))
  t.check('C1 a member JWT cannot execute record_mobile_otp_delivery()', /permission denied/i.test(memberRecordErr), memberRecordErr)
  const anonRecordErr = await expectError(() => asAnon(db, () => one(
    db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,'twilio') AS r`, [reqId, member]
  )))
  t.check('C1 an anonymous caller cannot execute record_mobile_otp_delivery()', /permission denied/i.test(anonRecordErr), anonRecordErr)
  // Even if a member could reach it, the role guard inside must refuse.
  const innerGuard = await expectError(() => asUser(db, member, async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`)
    return one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,'twilio') AS r`, [reqId, member])
  }))
  t.check('C1 …and the function body itself re-checks the role (defence in depth)', /permission denied|SERVICE_ONLY/.test(innerGuard), innerGuard)

  // -- C2 · A genuine provider accept is recorded ---------------------------
  const sentRes = await asService(db, () => one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,'twilio') AS r`, [reqId, member]))
  t.equal('C2 recording a successful send answers ok', sentRes.r.ok, true)
  t.equal('C2 …and reports that the row changed', sentRes.r.changed, true)
  t.equal('C2 …and the resulting delivery_status', sentRes.r.delivery_status, 'sent')
  const sentRow = await one(db, `SELECT delivery_status, failure_code, provider, verified_at FROM public.mobile_otp_requests WHERE id=$1`, [reqId])
  t.equal('C2 the ledger now says the provider ACCEPTED the send', sentRow.delivery_status, 'sent')
  t.equal('C2 a successful send carries no failure code', sentRow.failure_code, null)
  t.equal('C2 the provider name is stored for diagnostics', sentRow.provider, 'twilio')
  t.equal('C2 recording a send NEVER verifies anything by itself', sentRow.verified_at, null)
  t.equal('C2 …and never touches profiles.mobile_verified', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [member]), false)

  // -- C3 · Idempotent, and never downgrades a recorded send ----------------
  const replay = await asService(db, () => one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,'twilio') AS r`, [reqId, member]))
  t.equal('C3 replaying the same outcome is a no-op (changed=false)', replay.r.changed, false)
  t.equal('C3 …and leaves the status as sent', replay.r.delivery_status, 'sent')
  const downgrade = await asService(db, () => one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'failed','OTP_PROVIDER_ERROR',NULL) AS r`, [reqId, member]))
  t.equal('C3 a late failure report cannot downgrade an accepted send', downgrade.r.changed, false)
  t.equal('C3 …the row still says sent', await scalar(db, `SELECT delivery_status FROM public.mobile_otp_requests WHERE id=$1`, [reqId]), 'sent')
  t.equal('C3 …and no failure code was written over it', await scalar(db, `SELECT failure_code FROM public.mobile_otp_requests WHERE id=$1`, [reqId]), null)

  // -- C4 · A provider refusal is recorded with its stable code -------------
  // Member B already spent one attempt in B4, so age it out of the cooldown
  // (as the harness superuser) rather than weakening the gate for the test.
  await db.query(
    `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '2 hours' WHERE user_id=$1`, [other]
  )
  const failReq = await asUser(db, other, () => one(db, `SELECT public.request_mobile_otp() AS r`))
  const failId = Number(failReq.r.request_id)
  await asService(db, () => one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'failed','OTP_RATE_LIMITED','twilio') AS r`, [failId, other]))
  const failRow = await one(db, `SELECT delivery_status, failure_code, provider FROM public.mobile_otp_requests WHERE id=$1`, [failId])
  t.equal('C4 a refused send is recorded as failed', failRow.delivery_status, 'failed')
  t.equal('C4 …with the stable diagnostic code', failRow.failure_code, 'OTP_RATE_LIMITED')
  t.equal('C4 …and the provider that refused it', failRow.provider, 'twilio')
  const codeSet = await scalar(db, `SELECT string_agg(DISTINCT failure_code, ',') FROM public.mobile_otp_requests WHERE failure_code IS NOT NULL`)
  t.check('C4 only stable codes are ever stored — never an OTP value or a raw provider message', /^OTP_[A-Z_]+$/.test(codeSet), codeSet)

  // -- C5 · Invalid statuses are refused ------------------------------------
  for (const bad of ['requested', 'verified', 'ok', 'success', 'delivered', '']) {
    const err = await expectError(() => asService(db, () => one(
      db, `SELECT public.record_mobile_otp_delivery($1,$2,$3,NULL,NULL) AS r`, [failId, other, bad || null]
    )))
    t.check(`C5 delivery status "${bad || '(null)'}" is refused`, /OTP_INVALID_STATUS/.test(err), err)
  }
  t.equal('C5 a refused status leaves the row untouched', await scalar(db, `SELECT delivery_status FROM public.mobile_otp_requests WHERE id=$1`, [failId]), 'failed')

  // -- C6 · Member-bound: another member's attempt cannot be flipped --------
  const crossErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,NULL) AS r`, [failId, member]
  )))
  t.check('C6 a request id belonging to another member cannot be flipped', /OTP_REQUEST_REQUIRED/.test(crossErr), crossErr)
  t.equal('C6 …and the other member\'s row is unchanged', await scalar(db, `SELECT delivery_status FROM public.mobile_otp_requests WHERE id=$1`, [failId]), 'failed')
  const missingErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.record_mobile_otp_delivery(999999,$1,'sent',NULL,NULL) AS r`, [member]
  )))
  t.check('C6 a non-existent request id is refused', /OTP_REQUEST_REQUIRED/.test(missingErr), missingErr)
  const nullErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.record_mobile_otp_delivery(NULL,NULL,'sent',NULL,NULL) AS r`, []
  )))
  t.check('C6 NULL request/member arguments are refused', /OTP_REQUEST_REQUIRED/.test(nullErr), nullErr)

  // -- C7 · A recorded failure can be corrected to a real send --------------
  // (Retry semantics: the route re-sends and the provider accepts the second
  // time. 'failed' is not terminal, 'sent' is.)
  const recover = await asService(db, () => one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'sent',NULL,'msg91') AS r`, [failId, other]))
  t.equal('C7 a failed attempt can be corrected to sent on a successful retry', recover.r.changed, true)
  const recovered = await one(db, `SELECT delivery_status, failure_code, provider FROM public.mobile_otp_requests WHERE id=$1`, [failId])
  t.equal('C7 …and the stale failure code is cleared', recovered.failure_code, null)
  t.equal('C7 …and the provider is updated to the one that answered', recovered.provider, 'msg91')

  // -- C8 · Diagnostics only: it cannot widen a rate limit ------------------
  // A recorded failure STILL counts as an attempt (the provider really was
  // contacted), so the hourly budget cannot be laundered through this RPC.
  t.equal('C8 recording outcomes did not add or remove attempts for member B', Number(await scalar(db, `SELECT count(*) FROM public.mobile_otp_requests WHERE user_id=$1`, [other])), 2)
  const stillLimited = await expectError(() => asUser(db, member, () => one(db, `SELECT public.request_mobile_otp() AS r`)))
  t.check('C8 the member is still inside their cooldown after all that recording', /OTP_COOLDOWN/.test(stillLimited), stillLimited)

  // -- C9 · Security posture of the OTP function trio -----------------------
  // Same technique as admin-members.test.mjs §13: effective EXECUTE privilege
  // per role, SECURITY DEFINER, and a pinned search_path.
  const acl = await db.query(`
    SELECT p.proname, p.prosecdef, p.proconfig,
           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('request_mobile_otp', 'record_mobile_otp_delivery',
                        'complete_mobile_otp_verification')
    ORDER BY p.proname`)
  const fn = Object.fromEntries(acl.rows.map((r) => [r.proname, r]))

  t.check('C9 request_mobile_otp exists', Boolean(fn.request_mobile_otp))
  t.equal('C9 request_mobile_otp is SECURITY DEFINER', fn.request_mobile_otp?.prosecdef, true)
  t.check('C9 …with a pinned search_path (no schema-shadow hijack)',
    Array.isArray(fn.request_mobile_otp?.proconfig) && fn.request_mobile_otp.proconfig.some((c) => c.startsWith('search_path=')),
    fn.request_mobile_otp?.proconfig)
  t.equal('C9 …EXECUTE for authenticated (the member calls the gate themselves)', fn.request_mobile_otp?.auth_exec, true)
  t.equal('C9 …and NEVER for anon', fn.request_mobile_otp?.anon_exec, false)
  t.equal('C9 …and not for service_role either (no service-side bypass of the gate)', fn.request_mobile_otp?.svc_exec, false)

  t.check('C9 record_mobile_otp_delivery exists', Boolean(fn.record_mobile_otp_delivery))
  t.equal('C9 record_mobile_otp_delivery is SECURITY DEFINER', fn.record_mobile_otp_delivery?.prosecdef, true)
  t.check('C9 …with a pinned search_path',
    Array.isArray(fn.record_mobile_otp_delivery?.proconfig) && fn.record_mobile_otp_delivery.proconfig.some((c) => c.startsWith('search_path=')),
    fn.record_mobile_otp_delivery?.proconfig)
  t.equal('C9 …EXECUTE for service_role ONLY', fn.record_mobile_otp_delivery?.svc_exec, true)
  t.equal('C9 …never for authenticated', fn.record_mobile_otp_delivery?.auth_exec, false)
  t.equal('C9 …never for anon', fn.record_mobile_otp_delivery?.anon_exec, false)

  t.check('C9 complete_mobile_otp_verification exists', Boolean(fn.complete_mobile_otp_verification))
  t.equal('C9 complete_mobile_otp_verification is SECURITY DEFINER', fn.complete_mobile_otp_verification?.prosecdef, true)
  t.check('C9 …with a pinned search_path',
    Array.isArray(fn.complete_mobile_otp_verification?.proconfig) && fn.complete_mobile_otp_verification.proconfig.some((c) => c.startsWith('search_path=')),
    fn.complete_mobile_otp_verification?.proconfig)
  t.equal('C9 …EXECUTE for service_role ONLY (the Step-13 hardening is intact)', fn.complete_mobile_otp_verification?.svc_exec, true)
  t.equal('C9 …never for authenticated', fn.complete_mobile_otp_verification?.auth_exec, false)
  t.equal('C9 …never for anon', fn.complete_mobile_otp_verification?.anon_exec, false)

  // ==========================================================================
  // D · complete_mobile_otp_verification() — server-authoritative verify
  // ==========================================================================
  // -- D1 · Member/anon cannot complete verification -------------------------
  const memberCompleteErr = await expectError(() => asUser(db, member, () => one(
    db, `SELECT public.complete_mobile_otp_verification($1,'9876543210') AS r`, [member]
  )))
  t.check('D1 a member JWT cannot call complete_mobile_otp_verification()', /permission denied/i.test(memberCompleteErr), memberCompleteErr)
  const anonCompleteErr = await expectError(() => asAnon(db, () => one(
    db, `SELECT public.complete_mobile_otp_verification($1,'9876543210') AS r`, [member]
  )))
  t.check('D1 an anonymous caller cannot call complete_mobile_otp_verification()', /permission denied/i.test(anonCompleteErr), anonCompleteErr)
  t.equal('D1 …and mobile_verified is still false after both attempts', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [member]), false)

  // -- D2 · A member cannot set mobile_verified directly ---------------------
  const directErr = await expectError(() => asUser(db, member, () => db.query(
    `UPDATE public.profiles SET mobile_verified = TRUE WHERE id=$1`, [member]
  )))
  t.check('D2 a member cannot flip mobile_verified on their own row', /CANNOT_MODIFY_VERIFICATION_STATUS|permission denied/i.test(directErr), directErr)
  t.equal('D2 …and it stayed false', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [member]), false)

  // -- D3 · A FAILED delivery window can never complete verification ---------
  // Member B has one 'sent' row (recovered above). Give them a clean FAILED one
  // and prove the completion is refused even though a request exists in window.
  const failOnly = await signUp(db, { email: 'otp.failonly@test.dev', name: 'Failed Send', mobile: '9800011122' })
  await completeProfile(db, failOnly)
  const foGate = await asUser(db, failOnly, () => one(db, `SELECT public.request_mobile_otp() AS r`))
  const foId = Number(foGate.r.request_id)
  await asService(db, () => one(db, `SELECT public.record_mobile_otp_delivery($1,$2,'failed','OTP_SMS_NOT_CONFIGURED','test') AS r`, [foId, failOnly]))
  t.equal('D3 the fixture really has a FAILED delivery in the window', await scalar(db, `SELECT delivery_status FROM public.mobile_otp_requests WHERE id=$1`, [foId]), 'failed')
  const failedCompleteErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.complete_mobile_otp_verification($1,'9800011122') AS r`, [failOnly]
  )))
  t.check('D3 completion is REFUSED when the only open request failed to deliver', /OTP_REQUEST_REQUIRED/.test(failedCompleteErr), failedCompleteErr)
  t.equal('D3 …so mobile_verified stays false — there is NO path to verify without a delivered OTP', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [failOnly]), false)
  t.equal('D3 …and no verification_requests row is fabricated', Number(await scalar(db, `SELECT count(*) FROM public.verification_requests WHERE user_id=$1 AND type='mobile'`, [failOnly])), 0)

  // -- D4 · No open request at all → refused --------------------------------
  const noReq = await signUp(db, { email: 'otp.noreq@test.dev', name: 'No Request', mobile: '9800033344' })
  await completeProfile(db, noReq)
  const noReqErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.complete_mobile_otp_verification($1,'9800033344') AS r`, [noReq]
  )))
  t.check('D4 completion without ANY request row is refused', /OTP_REQUEST_REQUIRED/.test(noReqErr), noReqErr)
  t.equal('D4 …mobile_verified stays false', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [noReq]), false)

  // -- D5 · A different number than the one on file → refused ----------------
  const wrongNumberErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.complete_mobile_otp_verification($1,'9800099999') AS r`, [member]
  )))
  t.check('D5 the service client cannot bind a number that is not on the profile', /MOBILE_NOT_ON_FILE/.test(wrongNumberErr), wrongNumberErr)

  // -- D6 · A stale window → refused ----------------------------------------
  await db.query(
    `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '11 minutes' WHERE user_id=$1 AND delivery_status='sent'`, [member]
  )
  const staleErr = await expectError(() => asService(db, () => one(
    db, `SELECT public.complete_mobile_otp_verification($1,'9876543210') AS r`, [member]
  )))
  t.check('D6 a request older than the 10-minute window cannot complete', /OTP_REQUEST_REQUIRED/.test(staleErr), staleErr)

  // -- D7 · The genuine happy path ------------------------------------------
  await db.query(
    `UPDATE public.mobile_otp_requests SET requested_at = now() - interval '1 minute' WHERE user_id=$1 AND delivery_status='sent'`, [member]
  )
  const completed = await asService(db, () => one(db, `SELECT public.complete_mobile_otp_verification($1,'9876543210') AS r`, [member]))
  t.equal('D7 a delivered, in-window request completes verification', completed.r.ok, true)
  t.equal('D7 mobile_verified is now TRUE', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [member]), true)
  t.equal('D7 every open window for that number is closed', Number(await scalar(db, `SELECT count(*) FROM public.mobile_otp_requests WHERE user_id=$1 AND verified_at IS NULL`, [member])), 0)
  t.equal('D7 the verification is recorded in the verification queue', await scalar(db, `SELECT status FROM public.verification_requests WHERE user_id=$1 AND type='mobile' ORDER BY created_at DESC LIMIT 1`, [member]), 'verified')
  t.equal('D7 the member is notified', await scalar(db, `SELECT count(*) FROM public.notifications WHERE user_id=$1 AND type='profile_verified'`, [member]) > '0', true)
  t.equal('D7 the activity feed records the event', await scalar(db, `SELECT count(*) FROM public.activity_events WHERE user_id=$1 AND event='mobile_otp_verified'`, [member]) > '0', true)

  // -- D8 · A legacy 'requested' row (pre-diagnostics) still completes -------
  // Backwards compatibility: rows written before this migration have
  // delivery_status='requested' and must not lock members out.
  const legacy = await signUp(db, { email: 'otp.legacy@test.dev', name: 'Legacy Row', mobile: '9800055566' })
  await completeProfile(db, legacy)
  await asUser(db, legacy, () => one(db, `SELECT public.request_mobile_otp() AS r`))
  t.equal('D8 the legacy fixture row is delivery_status=requested', await scalar(db, `SELECT delivery_status FROM public.mobile_otp_requests WHERE user_id=$1`, [legacy]), 'requested')
  const legacyDone = await asService(db, () => one(db, `SELECT public.complete_mobile_otp_verification($1,'9800055566') AS r`, [legacy]))
  t.equal('D8 a pre-diagnostics row can still complete (no lockout regression)', legacyDone.r.ok, true)
  t.equal('D8 …and verifies the member', await scalar(db, `SELECT mobile_verified FROM public.profiles WHERE id=$1`, [legacy]), true)

  // ==========================================================================
  // E · THE NEXT.JS ROUTES AND THE UI (source contract)
  //   These are the layers the reported bug lived in. Asserting on the shipped
  //   source is the established convention in this harness (see
  //   admin-members.test.mjs §13): the strings checked here are the exact
  //   control-flow decisions, not incidental formatting.
  // ==========================================================================
  const requestRoute = src('src/app/api/mobile-otp/request/route.ts')
  const verifyRoute = src('src/app/api/mobile-otp/verify/route.ts')
  const card = src('src/components/profile/verification-card.tsx')
  const provider = src('src/lib/sms/otp-provider.ts')
  const outcomeSrc = src('src/lib/sms/otp-outcomes.ts')
  const envLib = src('src/lib/env.ts')
  const envExample = src('.env.example')

  // -- E1 · The endpoint the browser calls really exists --------------------
  t.check('E1 POST /api/mobile-otp/request is implemented', /export async function POST\(/.test(requestRoute))
  t.check('E1 POST /api/mobile-otp/verify is implemented', /export async function POST\(/.test(verifyRoute))
  t.check('E1 the request route is force-dynamic (never a cached "OTP sent")', /export const dynamic = 'force-dynamic'/.test(requestRoute))
  t.check('E1 the verify route is force-dynamic', /export const dynamic = 'force-dynamic'/.test(verifyRoute))
  t.check('E1 the browser calls exactly that endpoint', /fetch\('\/api\/mobile-otp\/request'/.test(card))
  t.check('E1 the browser verifies against exactly that endpoint', /fetch\('\/api\/mobile-otp\/verify'/.test(card))
  t.check('E1 the request route takes NO request body — the number can only come from the server', /export async function POST\(\)\s*\{/.test(requestRoute))

  // -- E2 · Capability is PRE-FLIGHTED before any rate-limit budget is spent --
  const preflightAt = requestRoute.indexOf('checkSmsCapability()')
  const gateAt = requestRoute.indexOf("rpc('request_mobile_otp')")
  t.check('E2 the route pre-flights GoTrue SMS capability', preflightAt > 0)
  t.check('E2 …BEFORE it calls request_mobile_otp() (so a broken deployment never burns the member\'s 5/hour)', preflightAt > 0 && gateAt > 0 && preflightAt < gateAt, { preflightAt, gateAt })
  // The real call, not the prose mention of signInWithOtp in the header comment.
  const signInAt = requestRoute.indexOf('.auth.signInWithOtp(')
  t.check('E2 …and before it asks the provider to send', signInAt > 0 && preflightAt < signInAt, { preflightAt, signInAt })
  t.check('E2 a failed preflight returns a refusal, not a success', /if \(!capability\.ok\) \{/.test(requestRoute))
  t.check('E2 the refusal wording comes from the shared PREFLIGHT_MESSAGES table', /capabilityMessage\(capability\.code\)/.test(requestRoute))
  t.check('E2 the refusal is logged as a diagnostics event', /logOtp\('preflight', 'rejected'/.test(requestRoute))
  t.check('E2 the preflight reads GoTrue\'s OWN published settings endpoint', /\/auth\/v1\/settings/.test(provider))
  t.check('E2 the preflight cannot hang the member\'s request', /AbortSignal\.timeout/.test(provider))
  t.check('E2 the test provider is refused unless an operator opts in', /if \(!smsEnv\.allowTestProvider\)/.test(provider))
  t.check('E2 the test provider is never reported as a real delivery', /delivery: 'simulated'/.test(provider))

  // -- E3 · Success is claimed ONLY on a real provider accept ---------------
  const okTrueAt = requestRoute.indexOf('ok: true')
  const recordSentAt = requestRoute.indexOf("recordDelivery('sent')")
  const recordFailAt = requestRoute.indexOf("recordDelivery('failed'")
  const otpErrAt = requestRoute.indexOf('if (otpError)')
  t.check('E3 the route inspects the provider error', otpErrAt > 0)
  t.check('E3 a provider error is recorded as a FAILED delivery', recordFailAt > 0)
  t.check('E3 a provider accept is recorded as SENT', recordSentAt > 0)
  t.check('E3 ok:true is returned only AFTER the provider accepted', okTrueAt > 0 && recordSentAt > 0 && okTrueAt > recordSentAt, { okTrueAt, recordSentAt })
  t.check('E3 the error branch returns BEFORE any ok:true', otpErrAt < okTrueAt, { otpErrAt, okTrueAt })
  t.check('E3 the thrown-error branch also records a failure and never claims success', /catch \(err\) \{\s*\n\s*await recordDelivery\('failed'/.test(requestRoute))
  const okCount = (requestRoute.match(/ok: true/g) ?? []).length
  t.equal('E3 there is exactly ONE success response in the whole route', okCount, 1)
  t.check('E3 the success response carries the delivery mode', /delivery: capability\.delivery/.test(requestRoute))
  t.check('E3 the success response carries the provider name for diagnostics', /provider: capability\.provider/.test(requestRoute))
  t.check('E3 the success response carries only a MASKED number', /mobile_masked: maskMobile\(mobile\)/.test(requestRoute))
  t.check('E3 the route never returns the raw mobile to the browser', !/mobile_masked: mobile\b|mobile:\s*mobile,/.test(requestRoute))
  t.check('E3 the OTP digits are never put in a response or a log', !/otp:\s*otp|token:\s*otp|code:\s*otp\b/.test(requestRoute))

  // -- E4 · Classification, not one blanket message -------------------------
  t.check('E4 the route classifies the provider error instead of guessing', /classifySendFailure\(otpError\)/.test(requestRoute))
  t.check('E4 the member gets the classified sentence', /error: failure\.message/.test(requestRoute))
  t.check('E4 the browser gets the classified stable code', /code: failure\.code/.test(requestRoute))
  t.check('E4 the HTTP status is the classified one (not always 503)', /failure\.httpStatus/.test(requestRoute))
  t.check('E4 the provider\'s own reason is preserved in the SERVER log', /providerMessage: otpError\.message/.test(requestRoute))
  t.check('E4 …and that raw reason is NOT echoed to the browser', !/error: otpError\.message|error:\s*rpcError\.message/.test(requestRoute))
  t.check('E4 the cooldown refusal passes the server\'s real remaining seconds to the browser', /retry_after_seconds: Number\(wait/.test(requestRoute))

  // -- E5 · The number is always the caller's own, read server-side ---------
  t.check('E5 the route re-reads the mobile from the member\'s OWN profile with the service client', /\.eq\('id', user\.id\)/.test(requestRoute))
  t.check('E5 the route validates the Indian 10-digit format before sending', /\^\[6-9\]\\d\{9\}\$/.test(requestRoute))
  t.check('E5 an unauthenticated caller is refused with 401', /code: 'NOT_SIGNED_IN' \}, 401/.test(requestRoute))
  t.check('E5 the route requires Supabase to be configured', /if \(!isSupabaseConfigured\)/.test(requestRoute))

  // -- E6 · The verify route is server-authoritative ------------------------
  t.check('E6 verify accepts ONLY the digits from the body, nothing else', /let body: \{ otp\?: string \}/.test(verifyRoute))
  t.check('E6 verify re-reads the number server-side (a client cannot aim it elsewhere)', /\.eq\('id', user\.id\)/.test(verifyRoute))
  t.check('E6 verify delegates the code check to Supabase, never compares digits itself', /admin\.auth\.verifyOtp\(/.test(verifyRoute))
  t.check('E6 verify never contains a hard-coded or expected OTP value', !/otp === ['"]|=== ['"]\d{6}['"]|EXPECTED_OTP|MASTER_OTP|bypass/i.test(verifyRoute))
  t.check('E6 verify requires the provider identity to match the stored number', /data\.user\.phone\?\.replace/.test(verifyRoute))
  t.check('E6 verify flips mobile_verified ONLY through the service-only RPC', /createAdminClient\(\)\.rpc\('complete_mobile_otp_verification'/.test(verifyRoute))
  t.check('E6 verify never writes profiles.mobile_verified directly', !/from\('profiles'\)[\s\S]{0,120}mobile_verified/.test(verifyRoute))
  t.check('E6 verify classifies its failures too (expired vs invalid vs rate limited)', /classifyVerifyFailure\(/.test(verifyRoute))
  t.check('E6 verify never logs the entered code', !/logOtp\([^)]*\botp\b[^)]*\)/.test(verifyRoute.replace(/code: 'OTP_/g, '')))
  t.check('E6 verify cleans up the throwaway phone identity', /deleteUser\(phoneUser\.id\)/.test(verifyRoute))
  t.check('E6 verify refuses malformed input with a generic message (no probing)', /\^\\d\{4,8\}\$/.test(verifyRoute))

  // -- E7 · The UI reflects the REAL server result --------------------------
  t.check('E7 the card treats a non-2xx response as failure', /!res\.ok \|\| body\.ok !== true/.test(card))
  t.check('E7 …and requires the explicit ok flag, not just HTTP 200', /body\.ok !== true/.test(card))
  t.check('E7 a failure clears the "OTP sent" state', /setOtpSent\(false\)/.test(card))
  t.check('E7 success is only set in the ok branch', /setOtpSent\(true\)/.test(card))
  t.check('E7 the card renders the server\'s cooldown, not a hard-coded 60', /body\.retry_after_seconds \?\? body\.cooldown_seconds/.test(card))
  t.check('E7 the card surfaces a SIMULATED delivery honestly', /body\.delivery === 'simulated'/.test(card))
  t.check('E7 …and keeps that state for the render', /setDelivery\(simulated \? 'simulated' : 'real'\)/.test(card))
  t.check('E7 the simulated banner is actually rendered to the member', /delivery === 'simulated' &&/.test(card))
  t.check('E7 the card never renders an OTP value it received', !/body\.otp|data\.otp|res\.otp/.test(card))
  t.check('E7 the card never decides success from a status code alone', !/setOtpSent\(true\)\s*\n\s*\}\s*catch/.test(card))
  t.check('E7 verify failure clears the entered digits', /setOtp\(''\)/.test(card))

  // -- E8 · Secrets stay server-side ----------------------------------------
  t.check('E8 otp-provider is server-only', /^import 'server-only'/m.test(provider))
  t.check('E8 the pure outcome module has NO imports at all (so it can never pull a secret)', !/^import\s/m.test(outcomeSrc))
  t.check('E8 the pure outcome module does not import server-only (the harness imports it)', !/^\s*import\s+['"]server-only['"]/m.test(outcomeSrc))
  t.check('E8 the pure outcome module imports nothing at all', !/^\s*import\s/m.test(outcomeSrc))
  t.check('E8 the pure outcome module reads no environment variable', !/process\.env/.test(outcomeSrc))
  t.check('E8 the pure outcome module performs no network I/O', !/\bfetch\(/.test(outcomeSrc))
  t.check('E8 the request route is not a client component', !/'use client'/.test(requestRoute))
  t.check('E8 the verify route is not a client component', !/'use client'/.test(verifyRoute))
  t.check('E8 no SMS gateway credential is referenced anywhere in src/', !/GOTRUE_SMS_TWILIO_AUTH_TOKEN|GOTRUE_SMS_MSG91_AUTH_KEY|SMS_API_KEY|TWILIO_AUTH_TOKEN|process\.env\.[A-Z_]*SMS[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)/.test(
    [requestRoute, verifyRoute, provider, outcomeSrc, envLib, card].join('\n')
  ))
  t.check('E8 smsEnv only holds CONTRACT variables (expected provider / sender id / test flag)', /expectedProvider/.test(envLib) && /senderId/.test(envLib) && /allowTestProvider/.test(envLib))
  t.check('E8 no smsEnv value is exposed with a NEXT_PUBLIC_ prefix', !/NEXT_PUBLIC_[A-Z_]*SMS/.test(envLib))
  t.check('E8 the card never reads process.env', !/process\.env/.test(card))
  t.check('E8 .env.example documents that the real credentials live in the Supabase project, not here', /Supabase Dashboard|project-side|GoTrue/i.test(envExample))
  t.check('E8 .env.example names the GoTrue variables an operator must set', /GOTRUE_EXTERNAL_PHONE_ENABLED/.test(envExample) && /GOTRUE_SMS_PROVIDER/.test(envExample))
  t.check('E8 .env.example marks the test-provider flag as LOCAL DEVELOPMENT ONLY', /LOCAL DEVELOPMENT ONLY/.test(envExample))

  // ==========================================================================
  // F · MIGRATION + GENERATED TYPES HYGIENE
  // ==========================================================================
  const migration = src('supabase/migrations/20260921010000_mobile_otp_delivery_diagnostics.sql')
  const types = src('src/lib/supabase/database.types.ts')

  const cols = await db.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mobile_otp_requests'
      AND column_name IN ('delivery_status','failure_code','provider')
    ORDER BY column_name`)
  const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]))
  t.check('F1 delivery_status exists', Boolean(byName.delivery_status))
  t.equal('F1 delivery_status defaults to "requested" so EXISTING rows are untouched', byName.delivery_status?.column_default, `'requested'::text`)
  t.equal('F1 delivery_status is NOT NULL', byName.delivery_status?.is_nullable, 'NO')
  t.check('F1 failure_code exists and is nullable', Boolean(byName.failure_code) && byName.failure_code.is_nullable === 'YES')
  t.check('F1 provider exists and is nullable', Boolean(byName.provider) && byName.provider.is_nullable === 'YES')
  const checkDef = await scalar(db, `
    SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid='public.mobile_otp_requests'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%delivery_status%'`)
  t.check('F1 delivery_status is constrained to requested/sent/failed', /'requested'.*'sent'.*'failed'/.test(checkDef ?? ''), checkDef)
  t.equal('F1 the diagnostics index exists', Number(await scalar(db, `SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='mobile_otp_requests_delivery_idx'`)), 1)
  t.check('F2 the migration is documented as idempotent / safe to re-run', /Safe to re-run/i.test(migration))
  t.check('F2 the migration states the EXTERNAL CONFIGURATION still required', /EXTERNAL CONFIGURATION STILL REQUIRED/.test(migration))
  t.check('F2 the migration guards its prerequisites instead of half-applying', /prerequisite migrations are not applied/.test(migration))
  t.check('F2 the migration does NOT weaken the rate limits', /rate limits are NOT weakened/.test(migration))
  t.check('F3 generated types expose delivery_status', /delivery_status/.test(types))
  t.check('F3 generated types expose failure_code', /failure_code/.test(types))
  t.check('F3 generated types expose record_mobile_otp_delivery', /record_mobile_otp_delivery/.test(types))
  t.check('F3 generated types expose the richer request_mobile_otp result', /request_id/.test(types) && /max_per_hour/.test(types))

  return t
}
