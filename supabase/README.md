# Supabase database — Mali Vivah

This folder holds everything the app needs to store **accounts, matrimony
profiles and the matchmaking flow** (browse, express interest, shortlist,
profile views) in Supabase.

Thirty-five migrations, run in filename order:

1. `20260910000000_auth_profiles.sql` — login & registration (accounts).
2. `20260911000000_matrimony_profiles.sql` — the "next flow": the detailed
   member profile, photos, partner preferences, interests, shortlists, views,
   plus the `search_matches()` / `get_public_profile()` browse RPCs.
3. `20260911120000_repair_missing_profiles.sql` — repairs accounts silently
   left without a `profiles` row (the cause of the wizard's
   `matrimony_profiles_user_id_fkey` error) and adds the
   `ensure_my_profile()` self-heal RPC.
4. `20260911130000_photo_storage_policies.sql` — the Storage write policies
   for the `profile-photos` bucket. Without it, uploading a photo in the
   wizard fails with `[photo] new row violates row-level security policy`
   (Supabase Storage enforces its own RLS on `storage.objects`, separate
   from the `profile_photos` table policies).
5. `20260912000000_packages_mutual.sql` — membership packages + subscriptions,
   the `has_active_subscription()` / `mutual_interest_exists()` /
   `get_profile_contact()` gating RPCs, and additive v2 flags on the browse
   RPCs (`gender`, `name_full` for paid viewers, `viewer_is_paid`,
   `mutual_interest`, `contact_phone` when paid + mutual).
6. `20260912130000_public_profile_browse.sql` — lets anonymous visitors see a
   safe five-profile preview on Brides and Grooms, and includes a member's own
   published profile in the gender-specific browse results.

Migrations 7–10 are the **Phase 1 completion pass** (database foundation):

7. `20260915000000_enum_extensions.sql` — adds `suspended` / `expired` to
   `profile_status` and creates the Phase 1 enums (`photo_kind`,
   `notification_type`, `payment_status`, `membership_tier`, …). This is its own
   file on purpose: PostgreSQL forbids *using* an enum value in the same
   transaction that creates it, and the SQL Editor runs a file as one
   transaction. **Do not merge it into another file.**
8. `20260915010000_profile_model_family_photo.sql` — `communities` /
   `sub_communities` hierarchy, the missing PRD profile fields (native place,
   company, lifestyle, the whole family block, privacy settings, WhatsApp
   consent), `profile_photos.kind`, and the `enforce_publishable_profile()`
   trigger that makes the **family photo mandatory server-side**.
9. `20260915020000_packages_pricing.sql` — the authoritative price list
   (Smart ₹999 / Premium ₹2,499 / VIP ₹4,999), the `tier` + `benefits` columns,
   and the `get_membership()` / `has_benefit()` resolvers every gate uses.
10. `20260915030000_notifications.sql` — the `notifications` table behind the
    navbar bell, with column-level grants so a member can flip `is_read` but
    can never insert a notification or rewrite its title.

Migrations 11–17 complete the platform (visibility, payments, safety,
engagement, activity, messaging):

11. `20260915100000_visibility.sql` — `has_live_membership()` (the time-aware
    paid check), `is_profile_public()`, `profile_visibility_reason()` and the
    membership-expiry sweeps. This is where the "free ⇒ hidden" rule lives.
12. `20260915110000_payments.sql` — Razorpay `payments`, the single
    `activity_events` stream, and the subscriptions **lockdown** (the browser
    can no longer INSERT/UPDATE `subscriptions`).
13. `20260915120000_safety_interests.sql` — `blocks` / `reports`,
    `is_blocked()`, `express_interest()` (the only interest-write path),
    hardened interest UPDATE policies, and account-deletion requests.
14. `20260915130000_engagement_admin.sql` — Daily 5 matches, boosts, featured
    profiles, verification requests, Mali Moments, success stories, admin.
15. `20260915140000_activity_login_register.sql` — registration + login events
    folded into the same activity stream.
16. `20260917000000_notification_enum_message_received.sql` — adds
    `message_received` to `notification_type`. Own file for the same
    PostgreSQL reason as #7: a new enum value cannot be *used* in the
    transaction that creates it, and migration 17 uses it. **Do not merge.**
17. `20260917010000_chat.sql` — in-app messaging: `conversations`,
    `conversation_members`, `messages`, their RLS, the ten chat RPCs, the
    triggers and the Realtime publication. Details below.

Migrations 18–24 are the **Phase 2 deepening** (verification, monetisation,
operator-managed content, safety + analytics — run after 1–17):

18. `20260918000000_success_stories_submissions.sql` — member story
    submissions queue behind `/success-stories/submit` (admin approves in
    `/admin/stories`).
19. `20260919000000_mobile_otp_verification.sql` — `mobile_otp_requests`
    ledger plus the `request_mobile_otp()` (60s cooldown, 5/hour cap) and
    `complete_mobile_otp_verification()` RPCs. The SMS itself is delivered
    by Supabase phone auth — configure an SMS provider in the project.
20. `20260919010000_boost_purchases.sql` — `profile_boost_config`
    (admin-priced à la carte boosts), the `activate_boost_purchase()` RPC
    the payments webhook calls after capture, and boost-aware refunds.
    > The first published version of this file (and of 21 and 22) did not
    > parse — a double-quoted `COMMENT` string / an INSERT column mismatch —
    > so the SQL Editor rolled the whole file back. If you applied them
    > before this note existed, re-run the corrected files: they are
    > idempotent.
21. `20260919020000_site_content_whatsapp.sql` — operator-managed website
    copy (`site_content`) and WhatsApp configuration (`whatsapp_config`)
    with the `get_site_content()` / `get_whatsapp_config()` readers the
    About page, homepage and footer use (compiled fallbacks included).
22. `20260919030000_moment_reports_activity.sql` — `reports.target_type` /
    `target_id` so a report can point at a moment, the `report_moment()`
    member RPC (deduped, self-reports rejected), and moment activity events.
23. `20260919040000_activity_completeness.sql` — completes the
    `activity_events` stream (contact reveals, interest responses,
    verification + story submissions) and ships `get_public_profile()` v3
    with privacy-settings honoring.
24. `20260919050000_whatsapp_optin_gate.sql` — adds the `whatsapp_allowed`
    key to `get_public_profile()` (paid + mutual + owner opt-in), so the
    profile page can honour the member's WhatsApp toggle. Additive and
    idempotent; existing rows default to opted-out.
25. `20260919060000_boost_entitlements.sql` — Profile Boost corrections.
    `profile_boost_config.duration_days` becomes the single boost length
    (`boost_duration_days()`; package, admin and purchased boosts all read
    it, no 7-day fallback anywhere — the `profile_boosts.expires_at` column
    default is dropped). New ledger `profile_boost_entitlements`: one row per
    grant with its source (`package` / `admin` / `purchase`), its own time
    slice of the visible period and — for purchases — a UNIQUE `payment_id`.
    `boost_my_profile()` counts only package entitlements against
    `boosts_included`; `activate_boost_purchase()` stacks by appending a new
    slice (earlier purchases keep their identity); new service-role
    `admin_grant_boost()`; `refund_membership()` revokes only the entitlement
    the refunded payment bought (unconsumed remainder only, later slices
    slide earlier) and is idempotent; the expiry notification states the
    period's real length. Refuses to run until 20 is applied. Backfills one
    entitlement per existing boost row. See "Profile Boost model" below.
26. `20260919070000_profile_views_access.sql` — profile-view access model.
27. `20260919080000_community_hierarchy_integrity.sql` — makes the existing
    `communities → sub_communities` hierarchy **authoritative**. New
    `enforce_community_hierarchy()` trigger on `matrimony_profiles`: a
    `sub_community_id` must belong to `community_id` (`COMMUNITY_MISMATCH`),
    inactive rows cannot be newly selected (`COMMUNITY_INACTIVE`),
    `community_id` is derived from the sub-community when absent, and the
    legacy `sub_community` text is kept equal to the linked row's name (or
    resolved to a row when an old client writes only text). Partner
    preference arrays (`preferred_communities`, `preferred_sub_communities`)
    stay `TEXT[]` but are canonicalised to real, active row names by
    `normalise_partner_community_prefs()`. One-off backfill repairs
    mismatched / missing links. `search_matches()` v4 resolves the
    `p_sub_community` TEXT filter through `sub_community_id` (legacy text
    only for rows without an ID) and `get_public_profile()` v5 / search cards
    gain an additive `community` key. No table is created and the text
    column is NOT dropped.
28. `20260919090000_profile_business_name.sql` — optional
    `matrimony_profiles.business_name` (separate from `company`);
    `get_public_profile()` v6 exposes it behind the same paid gate.
29. `20260919100000_search_lifestyle_filters.sql` — `search_matches()` v5:
    typed optional diet / smoking / drinking filters behind the existing
    advanced-search benefit gate.
30. `20260919110000_activity_tracking_analytics.sql` — canonical activity
    vocabulary, idempotent lifecycle events, `log_account_deletion()` and the
    admin-only `admin_analytics()` RPC.
31. `20260919120000_admin_member_management.sql` — **Admin Members module
    (Step 7).** Adds an orthogonal **admin hold** (`admin_hidden_at/_by/
    _reason`) and suspension bookkeeping (`suspended_at/_by`,
    `suspension_reason`, `status_before_suspension`) to `matrimony_profiles`
    — no new `profile_status` values. `is_profile_public()` v2 requires the
    hold to be clear (so search, Daily 5, featured, `get_public_profile()`,
    interest and profile views all drop a hidden profile at once); the two
    "members read active…" RLS policies are tightened the same way;
    `profile_visibility_reason()` v2 gains the `admin_hidden` reason.
    Service-role-only RPCs, each re-verifying the acting admin
    (`admin_assert_actor`): `admin_member_state`, `admin_set_profile_suspended`
    (state-aware unsuspend), `admin_set_profile_hidden`,
    `admin_reactivate_profile`, `admin_approve_profile`, `admin_reject_profile`,
    `admin_update_member_profile` (strict column allow-list),
    `admin_prepare_member_deletion` (self-protection, other admins protected,
    typed e-mail confirmation, audit + activity before the auth user is
    removed) and `admin_list_members` (server-side filters + paging). Every
    state change writes one `admin_audit_log` row (internal reason) and one
    scrubbed `activity_events` row. See "Admin member management" below.
32. `20260920000000_featured_boost_ordering.sql` — **Featured/boost exposure
    ordering (Step 8).** `get_featured_profiles()` v2 and `search_matches()`
    v5.1: identical signatures and gates, deterministic total order. Featured
    cards sort by admin `position` ASC, then `created_at` ASC, then
    `profile_id` ASC (equal positions — e.g. two members featured from the
    Members list at the default 100 — never shuffle). Search keeps its
    existing boost-first rule (`boosted DESC, updated_at DESC`) and gains
    `user_id ASC` as the final tie-breaker. Boost still affects ORDER only,
    never visibility. See "Featured profiles & boosted exposure" below.
33. `20260920120000_daily5_candidate_limit.sql` — **Daily 5 candidate
    limiting fix (Step 9).** `get_daily_matches()` used to put
    `LIMIT v_count` on the outer aggregate query — the LIMIT therefore hit
    the aggregate's single output row (i.e. nothing) and every
    threshold-passing candidate was returned no matter what
    `matching_config.daily_count` said. The engine now ranks the surviving
    candidate ROWS (`score DESC → boost DESC → md5(user_id ‖ current_date)`
    — the deterministic daily shuffle is unchanged), keeps only the
    configured `daily_count` of them, THEN aggregates into the JSONB array.
    An explicit `p_limit` RPC argument may only ask for FEWER matches than
    configured, never more. Signature, weights, scoring, reasons, threshold
    semantics and all visibility gates are unchanged; there is still NO
    padding. See "Daily 5 matching engine" below.
34. `20260920130000_verification_trust_safety.sql` — **Verification + Trust
    & Safety (Step 10).** Server-authoritative verification, reports and
    blocks. Not rebuilt in Step 11.
35. `20260920140000_privacy_account_lifecycle.sql` — **Privacy, account
    deletion and data lifecycle (Step 11).** Fail-safe `delete_my_account()`
    / `retire_account_data()` (hide first), payment/subscription/report
    retention (`ON DELETE SET NULL`), privacy RLS (owner-only matrimony
    SELECT, family photos owner-or-RPC), `update_my_privacy_settings()`,
    contact gates that refuse deactivated viewers, moments restricted to
    publicly-listed authors. See "Personal-data lifecycle" below.

> ⚠️ **Deploy ordering.** `20260915010000_profile_model_family_photo.sql`
> makes a family photo a hard requirement for publishing. Do not apply it to a live database until the profile wizard's
> family-photo step has shipped, otherwise members cannot publish at all — the
> trigger will raise `PROFILE_INCOMPLETE: family photo` with no way to satisfy
> it from the UI.

## What the scan found

The whole repo was scanned. Before this change there was **no database table at
all** — authentication lived only in Supabase Auth (`auth.users`), with the
registration fields kept as unstructured `user_metadata`:

| Field the app collects | Where it lived before | Where it lives now |
|---|---|---|
| Full name (`register.name`) | `user_metadata.full_name` | `profiles.full_name` + metadata |
| Email ID (`register.email`) | `auth.users.email` | `auth.users.email` + `profiles.email` |
| Mobile (`register.mobile`, 10-digit Indian) | `user_metadata.phone` | `profiles.mobile` + metadata |
| Password (min 8 chars + digit) | `auth.users` (hashed by Supabase) | **unchanged — never copied anywhere** |
| Registering for (`self`/`son`/`daughter`) | `user_metadata.for_whom` | `profiles.for_whom` + metadata |
| Terms accepted (required checkbox) | nowhere | `profiles.terms_accepted_at` |
| Login timestamps / counts | nowhere | `profiles.last_login_at`, `profiles.login_count`, `login_history` |

> **Passwords are never stored in our tables.** Supabase Auth owns hashing and
> verification (`auth.users`). Copying passwords into `public` tables would be a
> serious security bug — so this schema deliberately has no password column.

## Schema overview

```
auth.users  (managed by Supabase Auth — email, encrypted password, confirmations)
    │ 1:1, ON DELETE CASCADE
    ▼
public.profiles ──────────────────────┐
  id uuid PK (= auth user id)         │ 1:N, ON DELETE CASCADE
  email text unique (lowercase)       │
  full_name text (2–80 chars)         ▼
  mobile text unique ([6-9]xxxxxxxxx) public.login_history
  for_whom enum (self/son/daughter)     id, user_id, logged_in_at, success, note
  terms_accepted_at, email_verified, mobile_verified, is_active
  last_login_at, login_count, created_at, updated_at
```

Automation included in the migration:

- `on_auth_user_created` trigger → creates the `profiles` row on every sign-up,
  reading the metadata the app sends (`full_name`, `phone`, `for_whom`).
  It never throws, so sign-up can never break because of it.
- `on_auth_user_email_confirmed` trigger → sets `email_verified = true`.
- `record_login()` RPC → called by the app after each login; bumps
  `last_login_at` / `login_count` and appends a `login_history` row.
- Backfill `INSERT … ON CONFLICT DO NOTHING` → creates rows for users who
  signed up before the migration. (If two old accounts share one mobile number,
  the duplicate is skipped to protect the unique constraint — fix it manually.)
- Row Level Security → a logged-in user can only `SELECT`/`INSERT`/`UPDATE`
  their **own** profile row and read their **own** login history.
  `service_role` (the admin client) bypasses RLS.

## Setup (5 minutes)

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Copy the **Project URL** and **anon public key** (Project Settings → API).

### 2. Add environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY   # server only, never NEXT_PUBLIC_*
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Restart `npm run dev` after changing env vars.

### 3. Run the migration (creates the schema + tables)

**Option A — Dashboard (easiest):**

1. Supabase Dashboard → **SQL Editor** → New query.
2. Paste the full contents of
   `supabase/migrations/20260910000000_auth_profiles.sql`, press **Run**.
3. Then paste the remaining migration files in filename order
   (`20260911000000_matrimony_profiles.sql`,
   `20260911120000_repair_missing_profiles.sql`,
   `20260911130000_photo_storage_policies.sql`,
   `20260912000000_packages_mutual.sql`,
   `20260912130000_public_profile_browse.sql`) and press **Run** after each.
4. You should see `Success. No rows returned` for each.
5. Re-running any of the scripts is safe (all statements are idempotent).

**Option B — Supabase CLI:**

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

### 4. Verify it worked

In the Dashboard → **Table Editor** you should now see:

- `profiles`, `login_history` (accounts)
- `matrimony_profiles`, `profile_photos`, `partner_preferences` (the profile)
- `interests`, `shortlists`, `profile_views` (the matchmaking actions)
- `packages`, `subscriptions` (memberships — migration 5)

Quick check in the SQL Editor:

```sql
-- Tables exist?
select tablename from pg_tables where schemaname = 'public' order by 1;

-- RLS enabled?
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by 1;

-- Triggers on auth.users / profiles?
select trigger_name from information_schema.triggers
where (event_object_schema = 'auth' and event_object_table = 'users')
   or (event_object_schema = 'public' and event_object_table = 'profiles');
```

### 5. Recommended Auth settings

Dashboard → **Authentication** → **Providers** → **Email**:

- ✅ **Confirm email** → ON (users verify via the link the app already sends;
  `email_verified` flips to true automatically via the trigger).
- Site URL → your production URL.
- **Redirect URLs → allow-list `{SITE_URL}/verify`** (e.g.
  `https://mali-vivah.com/verify`, plus `http://localhost:3000/verify` for
  local testing). Sign-up sends confirmation links to `/verify`, which
  establishes the session and lands the new member on `/profile`. Supabase
  silently falls back to the Site URL for any destination not allow-listed
  here — so a missing entry means users land on the homepage.

### 6. Test end-to-end

1. `npm run dev` → open `/register` → create an account.
2. Open the confirmation link → it lands on `/verify` and bounces you to
   `/profile` (the registering tab auto-follows within a few seconds). If the
   link takes you to the homepage instead, `/verify` is missing from the
   Redirect URLs allow-list (step 5).
3. Dashboard → Table Editor → `profiles` → your row is there with
   `login_count = 1`, `last_login_at` set, and `email_verified = true`.
4. `login_history` has one row for the login.

## How the app uses the tables

**Registration** (`src/components/auth/register-form.tsx`):

1. Validates with `registerSchema` (zod) → `supabase.auth.signUp({ email, password, options.data: { full_name, phone, for_whom }, options.emailRedirectTo: '<origin>/verify' })`.
2. The `handle_new_user` trigger creates the `profiles` row immediately
   (works even while email confirmation is still pending).
3. If a session already exists (email confirmation OFF), the form also upserts
   the row as a guarantee — failures are only logged, never fatal.

**Login** (`src/components/auth/login-form.tsx`):

1. Validates with `loginSchema` — **email OR mobile** (at least one) +
   password. Email sign-in → `supabase.auth.signInWithPassword({ email, password })`.
   Mobile-only sign-in → `signInWithMobile` server action
   (`src/app/login/actions.ts`): the service role resolves the account from
   the UNIQUE `profiles.mobile` and signs in server-side, so the stored email
   never round-trips the browser and unknown numbers are indistinguishable
   from wrong passwords.
2. When a mobile is typed alongside the email it must match `profiles.mobile`
   (falling back to the auth metadata for pre-migration accounts); mismatch →
   sign out + error.
3. Self-heals a missing profile row / missing mobile from sign-up metadata.
4. Calls `record_login()` RPC for the audit trail (never blocks login).
5. Redirects to `/profile` (the dashboard) — the entry point of the
   matrimony flow.

Type-safe access everywhere via `src/lib/supabase/database.types.ts`
(`createBrowserClient<Database>` etc.).

## Useful admin queries

```sql
-- All users, newest first
select id, email, full_name, mobile, for_whom, email_verified,
       login_count, last_login_at, created_at
from public.profiles
order by created_at desc;

-- Recent logins
select p.email, h.logged_in_at, h.success
from public.login_history h
join public.profiles p on p.id = h.user_id
order by h.logged_in_at desc
limit 50;

-- Suspend an account (soft — keeps all data)
update public.profiles set is_active = false where email = 'user@example.com';

-- Manually verify a mobile number
update public.profiles set mobile_verified = true where email = 'user@example.com';
```

## The matrimony flow (migration 2)

Migration `20260911000000_matrimony_profiles.sql` adds the tables behind the
post-login flow:

```text
public.profiles (accounts)
    │ 1:1
    ▼
public.matrimony_profiles (detailed member profile) ── 1:N ── public.profile_photos
    │ 1:1
    ▼
public.partner_preferences (private "what I'm looking for")

public.interests    (sender_id → receiver_id, status: pending/accepted/…)
public.shortlists   (user_id → target_id)
public.profile_views (viewer_id → viewed_id)
```

Highlights:

- **Contact privacy by design.** `email` / `mobile` live only in
  `public.profiles` and are never returned by the browse RPCs. The
  `search_matches()` and `get_public_profile()` functions return masked names
  (first letter + `*`) and only match-relevant fields.
- **Auto-seed.** A trigger on `public.profiles` creates a draft
  `matrimony_profiles` + `partner_preferences` row for every new sign-up, so
  the onboarding wizard (`/profile/edit`) always has a row to upsert into.
- **Lifecycle.** `matrimony_profiles.status` is `draft` until the member
  publishes; only `active` rows appear in Browse / Search.
- **RLS.** Owners manage their own rows. Other members cannot `SELECT`
  another member's `matrimony_profiles` row (privacy-gated fields live
  there); public data goes through `get_public_profile` / `search_matches` /
  Daily 5 / featured. Profile photos of currently-active unblocked profiles
  remain readable; family photos are owner-or-RPC. Preferences are strictly
  private.

The UI for this flow lives under `/profile`, `/profile/edit`, `/search`,
`/brides`, `/grooms`, `/profile/[id]`, `/interests`, `/shortlist` and
`/packages`.

## Visibility & phone-reveal rules (migration 5)

Single source of truth: `src/lib/profile/visibility.ts`.

- **Free viewer** → only `occupation` + photo are visible; every other detail is
  masked with an upgrade prompt (browse cards, detail page, interests).
- **Paid viewer** (any active, unexpired `subscriptions` row) → every detail is
  visible **except** the phone number, including the full name.
- **Phone number** → visible **iff** the viewer is paid **and** interest is
  mutual. Mutual means an `accepted` row in either direction, or live
  (`pending`/`accepted`) rows in **both** directions. Check it with
  `select public.mutual_interest_exists('uuid-a', 'uuid-b')` or reveal the
  gated number with `select public.get_profile_contact('target-uuid')`
  (returns `NULL` unless paid + mutual).

`/brides` lists every `active` profile with `gender = 'female'`; `/grooms`
lists every `active` profile with `gender = 'male'` (gender is set in the
profile wizard). `/search` keeps the combined view with a Bride/Groom filter.

`/profile/edit` resumes where the member left off: completed wizard steps are
remembered per user (localStorage) and the first incomplete section opens
automatically; the stepper is clickable so any section can be revisited. The
fallback (no stored progress, e.g. a new device) infers the resume point from
the saved data — Basic → Education → About — and a fully-published profile
opens at Basic for review.

## In-app messaging (migrations 16–17)

Messaging is a **paid, mutual-connection** feature and every rule below is
enforced in the database, not in the UI.

**Tables**

| Table | Purpose |
|---|---|
| `conversations` | one row per pair — `member_a < member_b`, `UNIQUE (member_a, member_b)`, self-pairs refused |
| `conversation_members` | the two participants; also the RLS anchor |
| `messages` | text only (1–2000 chars) + `read_at`. No phone, email or address column exists |

**Who may do what**

* A conversation can be created (`get_or_create_conversation`) only when the
  caller is signed in, **both** members hold a live plan
  (`has_live_membership`), interest is **mutual** (`mutual_interest_exists`)
  and neither has blocked the other (`is_blocked`). Payment alone never opens
  a chat.
* A message can be sent (`send_message`) only under the same conditions — they
  are re-checked on **every** send, so an expired plan or a fresh block stops
  messaging immediately. `sender_id` is always `auth.uid()`.
* Reads (`chat_inbox`, `get_conversation`, `list_messages`) require the caller
  to be a participant **and** to hold a live plan. History is never deleted:
  an expired member simply cannot open chat, and a renewal restores access.
* `mark_conversation_read` / `unread_message_count` keep the read state in
  `messages`, independent of the notification feed.

**Why a malicious client cannot cheat**

* The three tables grant **SELECT only** to `authenticated`. There is no
  INSERT/UPDATE/DELETE policy or grant at all, so a hand-crafted REST call
  cannot create a conversation, join one, send a message or flip a read flag.
  The only write path is the SECURITY DEFINER RPCs, and each re-verifies
  `auth.uid()`, membership, mutual interest, blocks and participation. No
  client-supplied value (`isPaid`, `sender_id`, a conversation id) is trusted.
* RLS on top: members see only their own `conversation_members` rows, only
  conversations they participate in, and only those conversations' messages.
* `chat_eligibility()` returns a deliberately coarse verdict
  (`ok` / `membership_required` / `unavailable`), so the endpoint cannot be
  used to discover who has an account, who is paid, or who blocked whom.
* Exactly one conversation per pair: the ordered unique pair makes duplicate
  "start chat" presses collapse onto the same row (race-safe via
  `ON CONFLICT`), and `CHECK (member_a <> member_b)` forbids self-chat.

**Notifications** reuse the existing bell — the `messages` INSERT trigger calls
`push_notification()` with type `message_received`, title *"New message"* and
body *"You have a new message from &lt;name&gt;."* The **message body is never
stored in the notification**, metadata holds only `conversation_id` /
`sender_id`, and `push_notification()` additionally scrubs any
phone/email/contact/address/password/token key. One unread notification per
conversation keeps an active exchange from flooding the feed. `link` is
`/messages?c=<conversation id>`, so a click opens that thread.

**Realtime.** The migration adds `messages` and `conversations` to the
`supabase_realtime` publication (guarded, so it is a no-op on a project
without one). The app treats a Realtime event purely as a *wake-up signal* and
re-reads through the authorised RPCs — so live delivery works even if a
project's Realtime RLS enforcement is switched off, and the browser never
renders a row it was not entitled to read. No polling is used.

> **Optional hardening (Dashboard).** Database → Realtime: confirm
> `public.messages` and `public.conversations` are listed, and enable RLS
> enforcement for them if your project exposes that toggle. Nothing in the app
> depends on it, because the payloads are never rendered directly.

## Profile Boost model (migration 25)

```text
profile_boost_config (id=1)      duration_days ─┐  the ONE boost length
                                 price_inr      │  (add-on price)
                                 is_active      │  may the add-on be SOLD? — never gates included/admin boosts
                                                ▼
profile_boosts                   the VISIBLE period: ≤ 1 live row per member
  status active|expired|cancelled, started_at, expires_at, created_via (source that opened it)
        ▲ boost_id
profile_boost_entitlements       the LEDGER: one row per grant
  source package|admin|purchase, payment_id (UNIQUE, purchase ⇔ NOT NULL),
  duration_days (as configured at grant time), starts_at → ends_at (its slice),
  status granted|revoked, granted_by, created_at (quota accounting), revoked_at
```

* **Package boost** — `boost_my_profile()` (member RPC). Paid plan required;
  `benefits.boosts_included` is enforced per membership period by counting
  **only** `source='package'` entitlements created since the plan started.
  Idempotent while a boost is live. Works even when add-on purchases are off.
* **Admin boost** — `admin_grant_boost(p_user_id, p_granted_by)` (service
  role; called by the audited `adminGrantBoost` action). No payment, never
  counts against the quota, refused while a boost is live
  (`BOOST_ALREADY_ACTIVE`).
* **Purchased boost** — order API → Razorpay → signature verify / webhook →
  `activate_boost_purchase(p_payment_id)` (service role, idempotent per
  payment). If a boost is live the purchased days are **appended** as a new
  slice after the current expiry; the period's `expires_at` is extended and
  every earlier entitlement keeps its own `payment_id`.
* **Refund** — `refund_membership(p_payment_id)` on a `kind='boost'` payment
  revokes exactly the entitlement that payment bought: only its **unconsumed
  remainder** is removed from the period, later slices slide earlier (the
  member keeps every other day they hold), package/admin/other purchases are
  untouched, a payment without an entitlement revokes nothing, and a second
  call is a no-op (`already_refunded`).
* **Expiry** — `sweep_expired_memberships()` flips lapsed periods to
  `expired` and tells the member the period's real length (stacked periods
  are longer than one configured duration).
* **Fail-safe** — every activation path calls `boost_duration_days()`, which
  raises `BOOST_CONFIG_MISSING` / `BOOST_CONFIG_INVALID` instead of falling
  back to a hard-coded value.

## Admin member management (migration 31)

The Admin → Members module never edits `matrimony_profiles.status` from the
browser. Every action is a service-role RPC that re-checks the acting admin
and writes the audit trail itself:

| Admin action | What it does | Resulting state |
|---|---|---|
| Approve | `admin_approve_profile()` — only from `draft` / `pending_review` / `rejected`, requires the full publish checklist | `hidden` (APPROVED_FREE) — or `active` only when a **live** membership already exists. Never grants membership. |
| Send back | `admin_reject_profile()` with a mandatory member-facing note | `rejected` |
| Suspend | `admin_set_profile_suspended(…, TRUE)` — remembers the prior status | `suspended` (RLS + `is_profile_public()` drop it everywhere) |
| Unsuspend / Reactivate | `admin_set_profile_suspended(…, FALSE)` / `admin_reactivate_profile()` — computed from the member's **real** membership | live plan → `active` (through the publish gate; an incomplete profile lands on `hidden`), lapsed → `expired`, never paid → `hidden`, never published → previous `draft` / `pending_review` / `rejected` |
| Hide / Unhide | `admin_set_profile_hidden()` — the **admin hold** flag | `status`, membership, subscriptions and payments untouched; `is_profile_public()` is FALSE until the hold is lifted; the member's dashboard says `admin_hidden` |
| Edit | `admin_update_member_profile()` — allow-listed columns (+ partner preferences, `full_name`); the hierarchy trigger validates community ↔ sub-community; `company` and `business_name` stay separate | unchanged status |
| Verify / Feature / Boost / Mark paid | unchanged mechanisms (`verified_at`, `featured_profiles`, `admin_grant_boost()`, `activate_membership()`) | verified ≠ paid ≠ public; only publicly visible profiles can be newly featured; Mark paid never un-suspends |
| Delete | `admin_prepare_member_deletion()` (refuses self and other admins, requires the exact e-mail, **hides the profile immediately**) → storage wipe → `auth.admin.deleteUser()` | personal tables cascade from `profiles.id`; payments / subscriptions / reports / `admin_audit_log` / `activity_events` survive with user_id SET NULL |

Activity events written for admins (`admin_member_*`,
`admin_manual_membership_activation`) carry state facts only — members can
read their own activity stream, so reasons, notes and admin ids live in
`admin_audit_log` (service role only).

## Featured profiles & boosted exposure (migration 32)

**Featured** and **boosted** are different things and stay different:

* **Featured** = admin-curated homepage placement (`featured_profiles`:
  `profile_id`, `position`, `created_by`). It does **not** mean paid,
  verified or boosted by itself. Only the admin panel writes the table
  (service role; no INSERT/UPDATE/DELETE policy exists for clients), the
  `setFeatured` action re-validates the position server-side (whole number
  0–32767) and refuses to newly feature a profile that is not public right
  now.
* **Boosted** = temporary search-exposure boost (the `profile_boost_config` /
  `profile_boosts` / `profile_boost_entitlements` model above). It never
  inserts a member into the homepage Featured section and never reorders it.

**Ordering (deterministic in both directions):**

* `get_featured_profiles()` v2 — `position ASC → created_at ASC →
  profile_id ASC`. The admin position is authoritative (lower shows first);
  the two tie-breakers only make equal positions deterministic. The homepage
  renders this order untouched — boost status is a display badge, never a
  ranking input.
* `search_matches()` v5.1 — `boosted DESC → updated_at DESC → user_id ASC`.
  Boost ranks the profile first in Search/Brides/Grooms; the trailing
  `user_id` tie-breaker removes the last source of non-determinism. Daily 5
  keeps its own semantics (score first; boost only breaks ties between equal
  scores).

**Visibility never bends to exposure:** both functions — and Daily 5 — keep
gating every row on `is_profile_public()` + `is_blocked()`. A profile that is
admin-hidden, suspended, expired, incomplete, or without a live membership is
skipped even while featured and/or boosted; no manual un-feature is needed
when a profile later becomes ineligible. Boost changes ORDER only — it can
never bypass gender/age/city/community/lifestyle filters, the
`advanced_search` plan gate, block rules or the compatibility threshold, and
boosted state is always computed server-side by `has_active_boost()`
(`expires_at > now()` — a lapsed boost is not active even before the sweep
runs).

## Daily 5 matching engine (migrations 14, 33)

`get_daily_matches()` is **rule-based** — component scores, weights and a
threshold; no machine learning and no AI anywhere:

* **Configuration is data** (`matching_config`, single row `id = 1`, read
  live on every call through `matching_settings()`): component `weights`
  (PRD default age 15, location 15, education 10, occupation 10, income 10,
  community 10, partner_prefs 15, lifestyle 10, behaviour 5), `threshold`
  (default **90**) and `daily_count` (default **5**, allowed 1–25). The
  admin panel (`/admin/matching`, service role) edits the row; the engine
  never hard-codes 5 or 90.
* **Selection order** (fixed in migration 33): build eligible candidates →
  score each → drop everyone below `threshold` → rank
  (`score DESC → boost DESC → md5(user_id ‖ current_date)` — the md5 makes
  equal-score order deterministic for the whole day) → keep at most
  `daily_count` candidate rows → aggregate those rows into the JSONB array.
* **No padding.** `daily_count` is a maximum, not a quota: 2 qualifying
  candidates return 2, 0 return `[]`. No placeholders, no duplicates, no
  lowering of the threshold and no filling with weaker profiles.
* **Eligibility is the standard gates** — `is_profile_public()` (active,
  complete, both photos, live membership, no admin hold) and `is_blocked()`
  in either direction, plus the viewer's gender preference. A boosted
  profile gains ordering among *already qualifying* candidates only — it
  still has to clear the threshold and every visibility gate.
* **Free vs paid:** Daily 5 and the compatibility score are visible to free
  members; paid-only fields (full name, age, height, sub-community, marital
  status, education, city, state, diet) stay gated behind
  `has_live_membership(viewer)` as before, and no card carries contact
  details.

## Personal-data lifecycle (migration 35)

Engineering behaviour — **not** a legal-compliance claim. The PRD does not
define retention periods, so this table records what the code actually does.

HIDE, SUSPEND, EXPIRED and DELETE are different states and stay different.
No new `profile_status` value is introduced.

| Record | HIDE (admin hold) | SUSPEND | EXPIRED membership | DELETE (self or admin) |
|---|---|---|---|---|
| Public listing (`is_profile_public`) | false (hold flag) | false (`status=suspended`) | false (`status=expired`, no live plan) | false immediately (`is_active=false`), then the row is removed |
| Search / Daily 5 / featured / boost ranking | excluded | excluded | excluded | excluded (featured row deleted; live boost cancelled) |
| Contact (`get_profile_contact` / `get_public_profile`) | null | null | null | null (anonymised, then gone) |
| Interests / chat | cannot receive new; existing chat `can_chat_with` is false if either account is inactive | same | same (`has_live_membership` false) | rows CASCADE with the profile |
| Profile + family photos | stay on disk; listing hidden | stay on disk; listing hidden | stay on disk; listing hidden | DB rows deleted; storage prefix `<uid>/` wiped in `profile-photos` and `verification-docs` |
| Mali Moments | hidden from `list_moments` (author not public) | same | same | marked removed, then CASCADE; files under `<uid>/` wiped |
| Verification documents | private bucket, owner-only | private bucket, owner-only | private bucket, owner-only | wiped with the storage prefix |
| Payments / subscriptions | untouched | untouched | subscription expires; payment kept | **retained**, `user_id` SET NULL (Razorpay ids / amounts kept) |
| Reports | untouched | untouched | untouched | **retained**, reporter/reported SET NULL |
| `activity_events` / `admin_audit_log` | new events as usual | new events as usual | expiry events | **retained**, user/admin id SET NULL |
| Published success stories | untouched | untouched | untouched | `submitted_by` SET NULL; published copy stays (admin-managed public content) |
| Auth login | still works | still works | still works | `auth.users` removed |

**Fail-safe deletion.** `delete_my_account()` (member, `auth.uid()` only — no
user_id argument) and `admin_prepare_member_deletion()` both call
`retire_account_data()` **before** storage wipe / `auth.admin.deleteUser()`.
Hide cannot roll back if a later detach fails. A partial deletion therefore
cannot remain ACTIVE_PAID, searchable, featured, boosted, contactable or able
to send/receive new interest.

**Privacy settings** (`show_about`, `show_family_details`, `show_family_photo`,
`show_income`) are enforced in `get_public_profile` and
`update_my_privacy_settings()`. Direct table reads of another member's
matrimony row are refused. Contact is never a privacy toggle: phone / email /
WhatsApp still require paid + mutual + both accounts active.

**Storage.** `profile-photos` remains a public-read bucket for genuinely
public ACTIVE_PAID profile photos (intentional). Family photos of other
members are not readable via table RLS. `verification-docs` stays private.
Expired moments are excluded from `list_moments` and from other members'
SELECT; files in the public bucket remain until account deletion. Shared
admin-managed assets (site content, published success-story photos outside
the member prefix) are never wiped by member deletion.

**Remaining limitations.** Orphan payments after deletion cannot be refunded
through `refund_membership()` (no user_id). Expired moment files are not
swept from the public bucket on a timer. Direct GET of a previously known
public photo URL may still succeed until storage wipe completes.

## Useful admin queries (matchmaking)

```sql
-- All live profiles, newest first (age derived from date_of_birth)
select mp.user_id, p.full_name, mp.gender,
       floor(date_part('year', age(mp.date_of_birth)))::int as age,
       mp.city, mp.sub_community, mp.education, mp.occupation, mp.status, mp.updated_at
from public.matrimony_profiles mp
join public.profiles p on p.id = mp.user_id
order by mp.updated_at desc;

-- Pending interests per receiver
select receiver_id, count(*) as pending
from public.interests
where status = 'pending'
group by receiver_id
order by pending desc;

-- Most-viewed profiles
select viewed_id, count(*) as views
from public.profile_views
group by viewed_id
order by views desc
limit 20;
```
