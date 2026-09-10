# Supabase database — Mali Vivah

This folder holds everything the app needs to **store login & registration data
for all users** in Supabase.

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
   `supabase/migrations/20260910000000_auth_profiles.sql`.
3. Press **Run**. You should see `Success. No rows returned`.
4. Re-running the same script is safe (all statements are idempotent).

**Option B — Supabase CLI:**

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

### 4. Verify it worked

In the Dashboard → **Table Editor** you should now see:

- `profiles` (with RLS enabled badge)
- `login_history` (with RLS enabled badge)

Quick check in the SQL Editor:

```sql
-- Tables exist?
select tablename from pg_tables where schemaname = 'public';

-- RLS enabled?
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('profiles', 'login_history');

-- Triggers on auth.users?
select trigger_name from information_schema.triggers
where event_object_schema = 'auth' and event_object_table = 'users';
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
5. Redirects to `/`.

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

## Extending later

The matrimony profile fields (age, city, education, sub-community, photos —
see the `TODO` in `featured-profiles-section.tsx`) belong in a **separate**
table, e.g. `public.matrimony_profiles (user_id → profiles.id)`, so auth data
and matchmaking data stay decoupled. Ask and it can be scaffolded the same way.
