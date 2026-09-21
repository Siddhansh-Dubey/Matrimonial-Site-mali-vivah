# Step 15 — OTP delivery, Admin Analytics authorization, Membership revocation

**Branch:** `arena/01a0bffd-matrimonial-site-mali-vivah` · **Commit:** `4d36bf2`
**Date:** 2026-09-20

Three reported defects. Each was traced through the whole flow —
browser → Next.js API route / server action → Supabase RPC → RLS & GRANTs →
external provider — and fixed at the layer where the cause actually was, never
at the layer where the symptom appeared. No parallel systems were introduced:
the OTP flow still uses Supabase phone auth, analytics still uses
`admin_analytics()`, revocation reuses `admin_assert_actor()`, the membership
advisory lock, the audit log, the activity stream and the notification helper.

**Verification summary**

| Gate | Result |
| --- | --- |
| `npm --prefix mv-db-tests test` | **2067 checks / 18 suites — all pass** (baseline was 1318 / 15) |
| `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| `npm run lint` (`next lint`) | **0 warnings, 0 errors** |
| `npm run build` (`next build`) | **succeeds** (was failing — see §3.4) |
| Live endpoint smoke test (`next dev`) | see §1.6 — truthful refusals, no false "OTP sent" |

New migrations, in existing numbering order (newest pre-existing file was
`20260920190000`):

```
supabase/migrations/20260921000000_admin_analytics_authorization.sql
supabase/migrations/20260921010000_mobile_otp_delivery_diagnostics.sql
supabase/migrations/20260921020000_admin_revoke_membership.sql
```

All three apply cleanly on an empty database in both multi-statement and
transaction mode, are idempotent, and re-applying the newest one twice is a
no-op. No historical migration was edited.

---

## 1. ISSUE 1 — "Send SMS Code" sends no OTP

### 1.1 Root cause (found by tracing, not guessing)

It was **not** a missing route, **not** a wrong endpoint, **not** a swallowed
frontend error. `POST /api/mobile-otp/request` existed and was reachable. The
SMS itself has always been delegated to Supabase phone auth (GoTrue
`signInWithOtp` with the service role) — this app never generates, stores or
fakes a code, and that is unchanged.

What was actually broken was that **nothing in the stack could tell a working
deployment from a broken one**, and the failure was answered as if it were a
different failure:

1. `request_mobile_otp()` inserted the attempt row and spent one of the
   member's 5-per-hour slots **before** anyone knew whether the Supabase
   project could send an SMS at all. On a project with phone auth disabled, no
   `GOTRUE_SMS_PROVIDER`, or GoTrue's local `test` provider (which *accepts*
   the send and delivers nothing), the member burned their entire hourly budget
   on phantom sends and was then told "too many verification attempts" — which
   reads as user error, not as a broken deployment.
2. The ledger recorded nothing about the provider's verdict. A row looked
   identical whether the SMS went out or the provider refused it, so an
   operator could not distinguish "member never got the code" from "delivery is
   broken".
3. `complete_mobile_otp_verification()` accepted **any** outstanding request
   row inside the ten-minute window — including one whose send had failed.
4. The API route collapsed every provider failure into a single
   "SMS delivery is not configured" 503 and caught the provider's own reason in
   a silent `try/catch`. A rate limit, a rejected number and a provider outage
   were indistinguishable, and nothing was logged.
5. The UI keyed off `res.ok` / a generic catch, so a failure path could still
   leave the member looking at a "code sent" state.

### 1.2 What changed — CODE COMPLETE

**Migration `20260921010000_mobile_otp_delivery_diagnostics.sql`**

- §1 `mobile_otp_requests` gains `delivery_status`
  (`'requested'` → `'sent'` | `'failed'`, `NOT NULL DEFAULT 'requested'`,
  CHECK-constrained), `failure_code` and `provider`, plus a
  `(delivery_status, requested_at DESC)` index. Existing rows default to
  `'requested'` — no history is rewritten.
- §2 `request_mobile_otp()` keeps its **exact** existing posture (`auth.uid()`
  only, the member's own stored mobile, 60-second cooldown, 5 per rolling hour,
  the same `OTP_COOLDOWN` / `OTP_LIMIT_EXCEEDED` / `MOBILE_NOT_ON_FILE` codes,
  the same GRANTs) and additionally returns `request_id`, `cooldown_seconds`,
  `verify_window_minutes`, `max_per_hour`, `requests_last_hour` and a **masked**
  number, so the browser renders the server's countdown instead of a
  hard-coded 60.
- §3 **new** `record_mobile_otp_delivery(p_request_id, p_user_id, p_status,
  p_failure_code, p_provider)` — `service_role`-only EXECUTE, re-checks the
  role in its body, SECURITY DEFINER with a pinned `search_path`, bound to the
  requesting member, idempotent, never downgrades a recorded `sent`, refuses
  any status other than `sent`/`failed`, can never set `verified_at` and can
  never touch `profiles.mobile_verified`. Diagnostics only.
- §4 `complete_mobile_otp_verification()` is byte-for-byte the hardened Step 13
  function plus one extra condition: the outstanding request must **not** be a
  recorded delivery failure. Still service-role only, still locks and binds the
  member to the number just proved, still inside the ten-minute window.

The rate limits were **not** weakened. A failed provider send still counts as an
attempt, because the provider really was contacted. The improvement is that the
route now pre-flights before any budget is spent.

**`src/lib/sms/otp-outcomes.ts` (new, dependency-free)** — the failure-code
vocabulary (`OtpFailureCode`), `maskMobile()`, `PREFLIGHT_MESSAGES` and the
provider-error classifiers `classifySendFailure()` / `classifyVerifyFailure()`.
It imports nothing at all: no `server-only`, no env, no `fetch`. That is
deliberate, so the database harness can `import` the **same module the routes
run** instead of re-implementing the contract in a test that could silently
drift. GoTrue's stable error codes (`phone_provider_disabled`,
`over_sms_send_rate_limit`, `sms_send_failed`, `validation_failed`, …) are
matched first; HTTP status and message text are fallbacks for older GoTrue
builds. An unrecognised failure falls through to `OTP_PROVIDER_ERROR` — never
to anything the route could mistake for success.

**`src/lib/sms/otp-provider.ts`** — server-only. Reads GoTrue's **own**
published capability endpoint `GET /auth/v1/settings`
(`{ external: { phone }, sms_provider }`), with a 5-second `AbortSignal`
timeout and a 60-second cache. Refuses, with a precise code, when phone auth is
disabled, when `sms_provider` is an empty string, when the project reports a
provider other than the one this deployment expects, and when the provider is
GoTrue's local `test` provider unless an operator has explicitly opted in — and
even then the answer is `delivery: 'simulated'`, never `'real'`.
`logOtp()` emits one structured line per outcome: stage, result code, member id,
**masked** number, provider name and the provider's own reason. Never an OTP
value, never a full number, never a key.

**Both routes rewritten.** `POST /api/mobile-otp/request` now:
checks `isSupabaseConfigured` → 401 if unauthenticated → **pre-flights SMS
capability** → only then calls `request_mobile_otp()` → reads the member's own
stored mobile server-side (the route takes **no request body at all**) → sends
via `admin.auth.signInWithOtp({ phone, options: { channel: 'sms' } })` →
records the verdict with `record_mobile_otp_delivery()` → answers. There is
exactly **one** `ok: true` in the file and it is reachable only after the
provider accepted. `POST /api/mobile-otp/verify` re-reads the number
server-side, delegates the code check to GoTrue, requires the returned phone
identity to match the stored number, and flips `mobile_verified` **only**
through the service-only RPC on a fresh admin client.

**`src/components/profile/verification-card.tsx`** — success requires
`res.ok && body.ok === true`; any other answer clears the "OTP sent" state,
shows the server's sentence and starts the server's countdown
(`retry_after_seconds ?? cooldown_seconds`). `delivery: 'simulated'` renders an
explicit banner saying a test provider is in use and no real SMS was sent.

**Credentials.** No SMS credential is read by this app, and none can leak to the
browser. `smsEnv` in `src/lib/env.ts` holds only three *contract* variables —
`SUPABASE_SMS_PROVIDER`, `SUPABASE_SMS_SENDER_ID`,
`MOBILE_OTP_ALLOW_TEST_PROVIDER` — none of them `NEXT_PUBLIC_`. `.env.example`
documents at length that the real credentials are GoTrue settings of the
Supabase project and must never be Next.js environment variables.

### 1.3 Diagnostics without leaking anything

Three layers, all non-secret:

- **server log** — one `[MOBILE_OTP] <stage> <outcome> {json}` line per
  attempt, carrying the stable code, member id, masked number, provider name
  and the provider's raw reason. Confirmed live: `[MOBILE_OTP] request rejected
  {"code":"NOT_SIGNED_IN"}`.
- **database** — `mobile_otp_requests.delivery_status` / `failure_code` /
  `provider`, so "member never got the code" and "delivery is broken" are now
  separable with one query. The suite asserts only `^OTP_[A-Z_]+$`-shaped codes
  are ever stored.
- **browser** — a stable code and a fixed member-facing sentence. Every
  configuration-refusal sentence says plainly that **no code was sent**; the
  suite asserts this for all five refusal codes and asserts the provider's raw
  message is never echoed.

### 1.4 Tests — `mv-db-tests/tests/mobile-otp.test.mjs`, 295 checks

- **A · the pure outcome contract (84 checks).** Every GoTrue stable code maps to the
  right `OtpFailureCode` and HTTP status; twelve legacy message/status
  combinations classify correctly; an empty or unrecognised error is still a
  failure and never a 2xx; each preflight sentence states no code was sent and
  never claims success; a leaky provider message containing a fake account SID,
  auth token and sender number produces a sentence containing **none** of them;
  expired vs invalid vs rate-limited verify are distinguished while a wrong code
  gets one generic message; `maskMobile` never returns the full number and
  reports `'not-on-file'` rather than `''` for missing input.
- **B · the rate-limit gate (43 checks).** Anonymous cannot execute it; an authenticated request with
  no user claim is refused; no mobile → `MOBILE_NOT_ON_FILE` with **nothing**
  recorded; the schema itself refuses to store a malformed number, so the RPC's
  own regex is defence in depth; the success result carries the server's real
  cooldown/window/limit and never an OTP, a full number or a secret-shaped key;
  the function takes **zero arguments** so no number can be injected, and when
  member B calls it the attempt is recorded for member B with member B's masked
  number; RLS is on with **no** permissive policy, so a member can neither
  `SELECT` nor `UPDATE` the ledger; the cooldown refusal carries the real
  remaining seconds and records no extra attempt; the limit is exactly 5 and the
  window really is a rolling hour.
- **C · the diagnostics writer (54 checks).** Member and anonymous get `permission denied`
  and the function body re-checks the role; a genuine accept is recorded with
  `verified_at` still NULL and `mobile_verified` still false; replays are
  no-ops; a late failure cannot downgrade a recorded send; only stable codes are
  stored; `requested` / `verified` / `ok` / `success` / `delivered` / NULL are
  all refused with `OTP_INVALID_STATUS`; another member's request id and a
  non-existent id are refused; a recorded failure can be corrected to `sent` on
  a successful retry; recording outcomes cannot launder the hourly budget; all
  three OTP functions are SECURITY DEFINER with pinned `search_path` and exactly
  the right per-role EXECUTE grants.
- **D · server-authoritative verify (22 checks).** Member and anonymous cannot call
  `complete_mobile_otp_verification()`; a member cannot set `mobile_verified` on
  their own row; **a FAILED delivery window can never complete verification** —
  refused with `OTP_REQUEST_REQUIRED`, `mobile_verified` stays false, no
  `verification_requests` row is fabricated; no request at all is refused; a
  number not on the profile is refused; a stale (>10 min) window is refused; the
  genuine happy path verifies, closes every open window, writes the verification
  queue row, notifies the member and logs the activity event; a legacy
  `'requested'` row from before this migration can still complete, so nobody is
  locked out by the upgrade.
- **E · the routes and the UI (source contract, 77 checks).** The endpoints the
  browser calls exist and are `force-dynamic`; the request route takes no body;
  `checkSmsCapability()` appears **before** `rpc('request_mobile_otp')` and
  before `.auth.signInWithOtp(`; there is exactly one `ok: true` and it sits
  after `recordDelivery('sent')`; the thrown-error branch also records a
  failure; classification (not one blanket message) drives the sentence, the
  code and the HTTP status; the provider's raw reason reaches the server log but
  not the browser; the verify route never compares digits itself and never holds
  an expected OTP; the UI needs `body.ok === true`, clears the sent state on
  failure, renders the server's countdown and surfaces `simulated`; `otp-provider`
  is server-only while `otp-outcomes` imports nothing, reads no env and does no
  I/O; no SMS credential is referenced anywhere in the touched source; no
  client component reads `process.env`.
- **F · migration & types hygiene (15 checks).** Columns, defaults, NOT NULL, the CHECK constraint, the index,
  the migration's own prerequisite guard and "rate limits are NOT weakened"
  note, and the regenerated `database.types.ts` entries.

### 1.5 What this does **not** prove — stated plainly

**No real SMS was delivered to a real handset, and none could have been.** That
depends entirely on the Supabase project's GoTrue configuration, which lives
outside this repository and outside the Next.js environment (see §5). The suite
proves that every misconfigured state is **refused precisely and reported
truthfully**, and that no code path can present a failure as a success. It never
asserts that a delivery happened.

### 1.6 Live smoke test actually performed

`next dev` was started and the endpoints were hit with `curl`.

With no Supabase configured at all (repository default):

```
POST /api/mobile-otp/request  → 503 {"error":"Supabase is not configured.","code":"NOT_CONFIGURED"}
POST /api/mobile-otp/verify   → 503 {"error":"Supabase is not configured.","code":"NOT_CONFIGURED"}
GET  /api/mobile-otp/request  → 405
```

With Supabase "configured" (dummy URL/keys, no session cookie):

```
POST /api/mobile-otp/request                                    → 401 {"error":"Please sign in.","code":"NOT_SIGNED_IN"}
POST /api/mobile-otp/verify {"otp":"123456"}                    → 401 {"error":"Please sign in.","code":"NOT_SIGNED_IN"}
POST /api/mobile-otp/verify  (malformed body)                   → 400 {"error":"Invalid request.","code":"BAD_REQUEST"}
POST /api/mobile-otp/verify {"otp":"123456","mobile":"98765…",
                             "user_id":"00000000-…"}             → 401 (forged fields ignored)
server log: [MOBILE_OTP] request rejected {"code":"NOT_SIGNED_IN"}
            [MOBILE_OTP] verify  rejected {"code":"NOT_SIGNED_IN"}
```

So: the endpoint is reached (not a 404), authorization is enforced before
anything else, a forged `mobile` / `user_id` in the body is ignored because the
route never reads one, and no response ever claims a code was sent. The dummy
`.env.local` was deleted afterwards; it is git-ignored and was never committed.

---

## 2. ISSUE 2 — Admin Analytics: "Could not load analytics: admin_analytics: admin only"

### 2.1 Root cause

The user could reach `/admin` — that was not the inconsistency, it was the clue.

`/admin` authorizes with `profiles.is_admin` **on the member's own session**
(`src/lib/admin/server.ts` → `rpc('is_admin')`). The analytics page then called
`admin_analytics()` through the **service-role** client. A service-role request
carries no user JWT, so inside the RPC `auth.uid()` was `NULL`, `is_admin()` was
`FALSE`, and the function raised `admin only` — rejecting the very admin the
page had already authorized. Two different notions of "admin" were in play: one
session-scoped, one `auth.uid()`-scoped, and the page was crossing between them.

### 2.2 What changed — CODE COMPLETE

**Migration `20260921000000_admin_analytics_authorization.sql`**

- `admin_analytics(p_days, p_admin_id)` now authorizes through
  `public.admin_assert_actor(p_admin_id)` — the **one** authoritative admin
  check that every other admin RPC in this codebase already uses. It verifies
  that the supplied actor id is an active admin in `profiles`, so the definition
  of "admin" is identical for analytics, suspension, hiding, approval,
  rejection, editing, deletion and now revocation.
- Posture unchanged and unweakened: `SECURITY DEFINER`, pinned
  `search_path = public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`,
  `GRANT EXECUTE … TO service_role`. Ordinary users still cannot reach it, and
  RLS was not disabled anywhere.
- No hard-coded admin email or user id, anywhere in the function body.
- Adds the KPIs the page was already trying to show — package mix and revenue
  by package — and **fixes an IST day-axis off-by-one**: an outer
  `AT TIME ZONE 'Asia/Kolkata'` on the `generate_series` bounds was re-rendered
  in the session timezone (UTC), shifting the whole axis back one day so
  *today's* data disappeared. The corrected version keeps plain IST timestamps;
  verified that the old function ended yesterday and the new one ends today.
- The first `package_mix` CTE design was rejected by Postgres/PGlite
  (`check_ungrouped_columns` — a correlated aggregate keyed off a grouped
  column). Replaced with separate `package_active` / `package_revenue` CTEs
  joined together.

**`src/app/admin/analytics/page.tsx`** — passes `p_admin_id` from the authorized
session, and renders **every** KPI including genuine zeros. An empty range shows
`0` / an empty state; nothing is hidden and nothing is fabricated. The 7 / 14 /
30 / 90-day ranges are real query parameters, not client-side reslices.

### 2.3 Tests — `mv-db-tests/tests/admin-analytics-authz.test.mjs`, 134 checks

- An admin reaches analytics **through the same path the panel uses** and gets
  real data.
- Denied: an ordinary member, an anonymous caller, the service role **without**
  an actor id, a **bad** actor id, a non-existent ("ghost") actor id, and an
  admin who has since been **demoted** (`is_admin = false`) — the last one is
  the case that proves the check is live rather than cached at page load.
- All four ranges (7/14/30/90) genuinely change the result set, and the day
  axis ends **today** in IST.
- Revenue and user counts are compared against the authoritative tables
  (`payments`, `subscriptions`, `profiles`, `activity_events`) rather than
  asserted against literals, so the numbers cannot be fabricated by the test.
- Empty datasets render as `0` and empty arrays — not NULL, not missing keys,
  not invented rows.
- Security posture: SECURITY DEFINER, pinned `search_path`, service-role-only
  EXECUTE, RLS still enabled on every table the function reads.

`activity-analytics.test.mjs` was also extended from 63 to **104** checks to
cover the new package-mix KPIs and the corrected day axis.

---

## 3. ISSUE 3 — Admin "Revoke / disable membership"

### 3.1 What changed — CODE COMPLETE

**Migration `20260921020000_admin_revoke_membership.sql`** —
`admin_revoke_membership(p_admin_id, p_user_id, p_reason, p_note,
p_subscription_id)`:

- **Admin-only, server-authoritative.** Opens with
  `public.admin_assert_actor(p_admin_id)` — the same single definition of admin
  as §2. Refuses `MEMBER_NOT_FOUND`, refuses `ADMIN_SELF_ACTION`, validates
  `p_reason` against its **own** allow-list (`REASON_REQUIRED`,
  `INVALID_REASON`), truncates an over-long note. SECURITY DEFINER, pinned
  `search_path`, `service_role`-only EXECUTE, exactly one definition (no
  overloads).
- **Concurrency-safe.** Takes `pg_advisory_xact_lock(hashtext('membership:' ||
  p_user_id))` — the *same* lock `activate_membership()` and
  `refund_membership()` take — and `SELECT … FOR UPDATE` on the profile, so a
  revocation cannot race a Razorpay webhook activation or a refund for one
  member.
- **Entitlement only, payment preserving.** The function never writes to
  `payments` — no `UPDATE`, no `DELETE`, no `INSERT` (asserted against the live
  `prosrc`). `razorpay_order_id`, `razorpay_payment_id`, `amount_inr`,
  `currency`, `status` (`'captured'`) and `created_at` survive byte-for-byte,
  and are copied into `admin_audit_log` so the money trail stays readable after
  the entitlement is gone. Historical amounts are never rewritten and no refund
  is implied.
- **Multiple entitlements handled.** Promotional Platinum grants (the
  first-100 launch offer and the 24-hour demo) are **excluded** from revocation
  and are left running. Revoking one paid entitlement while another is live
  keeps the member paid and visible; only when nothing live remains does the
  profile leave the directory, landing on `'expired'` exactly like the existing
  expiry sweeps — so visibility, search, matches and Express Interest all fall
  away through the machinery that already governs them. Boosts and featured
  rows are never touched.
- **Idempotent.** A replay answers `already_revoked`; nothing to revoke answers
  `no_active_paid_membership` (and says so specifically when the member only
  holds a free Platinum grant). No duplicate audit rows, no double-notification.
- **Audited + announced.** Writes its own `admin_audit_log` row, logs an
  `admin_membership_revoked` activity event (added to the authoritative
  `canonical_activity_events` vocabulary) and notifies the member.

**`revokeMembership` server action** (`src/app/admin/actions.ts`) — goes through
`requireAdminAction()` and `memberAction()`, validates the member UUID and the
reason before calling the RPC with `ctx.admin.rpc('admin_revoke_membership', {
p_admin_id: ctx.userId, … })`, and translates `already_revoked` /
`no_active_paid_membership` into honest sentences instead of pretending
something changed.

**Admin UI** (`src/app/admin/members/[id]/page.tsx`) — a "Revoke membership"
panel on the member detail page, shown only when a revocable paid subscription
exists. It lists package, tier, expiry and the payment reference; when several
entitlements are live it asks **which** one to revoke; when a free Platinum
grant exists it says explicitly that the grant is **not** revoked; the reason is
a **required** `<select>` whose empty option is `disabled` (no silent default);
the admin note is optional and labelled "audit log only, never shown to the
member"; and a `ConfirmButton` states that the entitlement is removed, that the
historical payment record will **NOT** be deleted (Razorpay order id, payment id
and amount stay exactly as captured), that this is **not** a refund, and points
at Admin → Payments for refunds.

**Refunds stay separate.** `refundPayment` → `refund_membership(payment_id)` is
untouched and remains the only financial reversal.

**Pricing untouched.** The suite asserts against the live `packages` table:
Smart ₹999 / 90 days, Premium ₹2,499 / 180 days, VIP ₹4,999 / 365 days, and
that no row has reverted to the old ₹5,999 VIP price.

### 3.2 Tests — `mv-db-tests/tests/membership-revocation.test.mjs`, 279 checks

Authorization boundaries (member, anonymous, service-without-actor, bad actor,
self-revocation, invalid/unknown reason, missing member) and the six required
scenarios:

| | Scenario | Proven |
| --- | --- | --- |
| A | Free user with a 24-hour Platinum **demo** | nothing to revoke; the demo stays live |
| B | **Platinum + Premium**, revoke Premium | Platinum stays live, member stays paid and visible |
| C | **Premium only**, revoke Premium | every paid capability is lost, profile leaves the directory |
| D | **Platinum only**, "revoke Premium" | nothing Platinum-related is deleted |
| E | **Platinum expires** | the existing sweeps / visibility rules apply |
| F | Premium bought **while Platinum is live** | revoking Premium never touches Platinum |

Plus: idempotent replay; payment byte-preservation (every column compared
before/after, including `package_id`, `metadata` and both membership
timestamps); audit + activity + notification rows; boosts and featured status
counted before and after and unchanged; stacked renewals; the manual
(service-role, no-payment) activation path; client-forgery attempts
(a member cannot write `subscriptions` or `payments`, cannot flip their own
status to public — the publish-gate trigger corrects it); migration hygiene;
and pricing.

### 3.3 A real bug the new tests caught

The first revocation form shipped **without** its hidden `user_id` and
`return_to` inputs, so `requireUuid(str(formData, 'user_id'))` would have thrown
`Invalid member` on every click — the button would never have reached the RPC.
The suite's UI-contract section caught it; both inputs are now present and
asserted.

### 3.4 A real build break the new tests caught

`REVOCATION_REASONS` was first exported from `src/app/admin/actions.ts`, which
is a `'use server'` module. Next.js allows only async-function exports there, so
`next build` failed at *Collecting page data* with
`A "use server" file can only export async functions, found object.` The
constant now lives in the plain `src/lib/admin/members.ts` module (alongside the
other shared admin label maps) with an `isRevocationReason()` guard, imported by
both the action and the page. The suite now scans **every** `'use server'` file
in `src/` and fails if any of them exports a non-async value, so this class of
build break cannot come back.

---

## 4. Regression status

Full harness, `npm --prefix mv-db-tests test` — **2067 checks, 18 suites, 0
failures**:

```
activity                     104   admin-analytics-authz        134 (new)
admin-members                236   audit-authorization           32
boosts                       156   business-name                 62
community                     56   daily5                        73
featured-boost-exposure      101   membership-revocation        279 (new)
mobile-otp                   295 (new)
payment-membership-lifecycle  93   platinum-launch              193
privacy-lifecycle             80   profile-views                 54
search-lifestyle              39   step14-hardening              33
verification-trust-safety     47
```

Baseline before this work: 1318 checks / 15 suites, all passing. Every one of
those still passes; the delta is 3 new suites and 41 added checks in
`activity-analytics`.

Specifically re-verified as unbroken: the payment → membership lifecycle and the
Razorpay webhook path (no Razorpay code was rewritten and
`RAZORPAY_KEY_SECRET` is still server-only); the Platinum launch offer, its
first-100 promo and the 24-hour demo; boosts and featured exposure; the Step 13
audit-authorization boundaries, including `complete_mobile_otp_verification`
staying service-role only; the Step 14 hardening; and `admin-members` §13, which
asserts a hard-coded list of admin RPCs are SECURITY DEFINER with a pinned
`search_path` and service-role-only EXECUTE — the new `admin_analytics` and
`admin_revoke_membership` satisfy the same rule and are covered by the same
technique.

`npm run typecheck` → 0 errors. `npm run lint` → 0 warnings, 0 errors.
`npm run build` → succeeds, with both `/api/mobile-otp/*` routes present in the
output manifest. `src/lib/supabase/database.types.ts` was regenerated by hand
for the three migrations (new `admin_analytics(p_days?, p_admin_id?)` and
`admin_revoke_membership` signatures, the three new `mobile_otp_requests`
columns, `record_mobile_otp_delivery`).

**Known harness caveat:** `mobile-otp.test.mjs` section A imports the app's
`src/lib/sms/otp-outcomes.ts` directly, which needs Node ≥ 22.6 type stripping.
`mv-db-tests/package.json` scripts now pass `--experimental-strip-types`; a bare
`node run.mjs` works on Node ≥ 22.18 where stripping is on by default. If
stripping is unavailable, section A fails loudly with an explanatory message
rather than silently skipping.

---

## 5. Remaining EXTERNAL CONFIG REQUIRED

Everything below is **configuration of systems outside this repository**. No
amount of code here can supply it, and nothing in the code assumes it exists —
each missing item produces a precise, logged refusal instead of a false success.

### 5.1 SMS delivery — REQUIRED before any OTP can arrive

Set on the **Supabase project** (Dashboard → Authentication → Sign In / Up →
Phone, i.e. this project's GoTrue configuration):

```
GOTRUE_EXTERNAL_PHONE_ENABLED = true
GOTRUE_SMS_PROVIDER           = twilio | msg91 | textlocal | vonage | hook
GOTRUE_SMS_MAX_FREQUENCY      = 60s      # keep >= the DB cooldown
GOTRUE_SMS_OTP_EXP            = 600      # keep >= the 10-minute DB window
GOTRUE_SMS_TEMPLATE           = "Your Mali Vivah verification code is {{ .Code }}"
```

…plus the chosen provider's own credentials, e.g. for Twilio:

```
GOTRUE_SMS_TWILIO_ACCOUNT_SID
GOTRUE_SMS_TWILIO_AUTH_TOKEN
GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID
```

**These are NOT Next.js environment variables and must never be copied into
this app or exposed to the browser.** The Next.js side only holds three optional
*contract* variables (documented in `.env.example`, all server-side):

```
SUPABASE_SMS_PROVIDER=twilio        # if set, the route refuses when the project reports a different provider
SUPABASE_SMS_SENDER_ID=MALIVH       # diagnostics only
MOBILE_OTP_ALLOW_TEST_PROVIDER=false  # LOCAL DEVELOPMENT ONLY; even when true the UI says "simulated"
```

Until 5.1 is done, `POST /api/mobile-otp/request` answers 503 with
`OTP_PHONE_DISABLED`, `OTP_SMS_NOT_CONFIGURED`, `OTP_SMS_TEST_PROVIDER`,
`OTP_SMS_PROVIDER_MISMATCH` or `OTP_SMS_UNREACHABLE`, logs the reason, spends
**no** rate-limit budget, and the UI states plainly that no code was sent.

### 5.2 Apply the three migrations

Run, in order, on the target Supabase project (Dashboard → SQL Editor → paste →
Run; each file is idempotent and safe to re-run):

```
20260921000000_admin_analytics_authorization.sql
20260921010000_mobile_otp_delivery_diagnostics.sql
20260921020000_admin_revoke_membership.sql
```

`20260921010000` guards its own prerequisites and raises
`mobile_otp_delivery_diagnostics: prerequisite migrations are not applied` if
`20260919000000_mobile_otp_verification.sql` or
`20260920160000_audit_authorization_boundaries.sql` are missing.

### 5.3 App environment on the host

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and the existing Razorpay variables — unchanged by
this work, but without them every OTP and analytics route answers
`NOT_CONFIGURED`.

### 5.4 At least one admin

Analytics and revocation both authorize through `admin_assert_actor`, which
requires an active `profiles.is_admin = true` row. There is deliberately no
hard-coded admin email or id anywhere; promote the first admin with the existing
admin-management path.

### 5.5 Refunds remain a manual, separate process

`admin_revoke_membership` never moves money and never implies a refund. If a
revocation is for reason `refund`, the actual refund is still performed under
Admin → Payments (`refund_membership`) or in the Razorpay dashboard. Nothing
here automates that, by design.

### 5.6 GitHub push is blocked

`git push` and `gh` fail with *"could not read Username"* / *"the github.com
token in GH_TOKEN is no longer valid"*. The work is committed locally as
`4d36bf2` on `arena/01a0bffd-matrimonial-site-mali-vivah` and the files are
saved, but it could not be pushed and no pull request could be opened. The
GitHub connection needs to be reconnected in Arena, after which
`git push -u origin arena/01a0bffd-matrimonial-site-mali-vivah` will publish it.
