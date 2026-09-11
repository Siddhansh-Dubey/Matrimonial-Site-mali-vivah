# Supabase database — Mali Vivah

This folder holds everything the app needs to store **accounts, matrimony
profiles and the matchmaking flow** (browse, express interest, shortlist,
profile views) in Supabase.

Five migrations, run in filename order:

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
   `20260912000000_packages_mutual.sql`) and press **Run** after each.
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
- Site URL → your production URL (used by `emailRedirectTo`).

### 6. Test end-to-end

1. `npm run dev` → open `/register` → create an account.
2. Confirm the email link, then sign in at `/login`.
3. Dashboard → Table Editor → `profiles` → your row is there with
   `login_count = 1`, `last_login_at` set, and `email_verified = true`.
4. `login_history` has one row for the login.

## How the app uses the tables

**Registration** (`src/components/auth/register-form.tsx`):

1. Validates with `registerSchema` (zod) → `supabase.auth.signUp({ email, password, options.data: { full_name, phone, for_whom } })`.
2. The `handle_new_user` trigger creates the `profiles` row immediately
   (works even while email confirmation is still pending).
3. If a session already exists (email confirmation OFF), the form also upserts
   the row as a guarantee — failures are only logged, never fatal.

**Login** (`src/components/auth/login-form.tsx`):

1. Validates with `loginSchema` → `supabase.auth.signInWithPassword({ email, password })`.
2. Compares the typed mobile against `profiles.mobile` (falling back to the
   auth metadata for pre-migration accounts); mismatch → sign out + error.
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
- **RLS.** Owners manage their own rows; other members can read only `active`
  profiles (and their photos). Preferences are strictly private.

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
