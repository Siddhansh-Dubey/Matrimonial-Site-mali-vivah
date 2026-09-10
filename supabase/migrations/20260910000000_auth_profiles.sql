-- ============================================================================
-- Mali Vivah · Supabase auth storage
-- Migration: profiles + login history for login / registration
--
-- What this creates (all in the `public` schema):
--   1. public.for_whom        — enum: 'self' | 'son' | 'daughter'
--   2. public.profiles        — one row per registered user (FK → auth.users)
--   3. public.login_history   — audit trail of successful logins
--   4. Trigger on auth.users  — auto-creates a profile row on every sign-up
--   5. Trigger on auth.users  — marks email_verified once email is confirmed
--   6. public.record_login()  — RPC the app calls after every successful login
--   7. Row Level Security     — users can only read/write their OWN rows
--
-- Passwords are NEVER stored here — Supabase Auth (auth.users) owns password
-- hashing and verification. This schema stores everything else the app
-- collects during registration, plus login audit data.
--
-- Source of truth for the fields: src/lib/auth/register-schema.ts,
-- src/lib/auth/login-schema.ts, src/components/auth/*.tsx
--
-- How to apply: Supabase Dashboard → SQL Editor → paste this file → Run.
-- Safe to re-run: every statement is idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS / ON CONFLICT).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Enum for "registering for" (mirrors `forWhomOptions` in register-schema.ts)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'for_whom'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.for_whom AS ENUM ('self', 'son', 'daughter');
  END IF;
END
$$;

COMMENT ON TYPE public.for_whom IS
  'Who the account holder is registering: themselves, their son or their daughter.';


-- ----------------------------------------------------------------------------
-- 1. profiles — registration data, exactly one row per auth user
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email             TEXT NOT NULL UNIQUE,
  full_name         TEXT NOT NULL,
  -- 10-digit Indian mobile ([6-9]xxxxxxxxx). Nullable ONLY so the
  -- auto-create trigger can never break sign-up; the app always provides it
  -- (register-schema.ts requires it) and backfills it on next login.
  mobile            TEXT UNIQUE,
  for_whom          public.for_whom NOT NULL DEFAULT 'self',
  terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  mobile_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at     TIMESTAMPTZ,
  login_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT profiles_full_name_len CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 80),
  CONSTRAINT profiles_mobile_format CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT profiles_email_format CHECK (email LIKE '%@%.%'),
  CONSTRAINT profiles_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT profiles_login_count_nonneg CHECK (login_count >= 0)
);

COMMENT ON TABLE public.profiles IS
  'Registration + account data for every Mali Vivah user. One row per auth.users id, auto-created by the handle_new_user trigger. Passwords live only in auth.users (Supabase Auth).';
COMMENT ON COLUMN public.profiles.id IS 'PK + FK to auth.users.id; row is deleted automatically if the auth user is deleted.';
COMMENT ON COLUMN public.profiles.email IS 'Lowercase login email, unique across all users.';
COMMENT ON COLUMN public.profiles.full_name IS 'Account holder full name (2–80 chars).';
COMMENT ON COLUMN public.profiles.mobile IS '10-digit Indian mobile, digits only, e.g. 9876543210. Unique when present.';
COMMENT ON COLUMN public.profiles.for_whom IS 'Who the account holder registered: self / son / daughter.';
COMMENT ON COLUMN public.profiles.terms_accepted_at IS 'When the Terms of Use + Privacy Policy were accepted (required at registration).';
COMMENT ON COLUMN public.profiles.email_verified IS 'True once the Supabase email confirmation link has been opened.';
COMMENT ON COLUMN public.profiles.mobile_verified IS 'Reserved for future OTP verification of the mobile number.';
COMMENT ON COLUMN public.profiles.is_active IS 'Soft on/off switch; set FALSE to suspend an account without deleting data.';
COMMENT ON COLUMN public.profiles.last_login_at IS 'Timestamp of the most recent successful login (via record_login RPC).';
COMMENT ON COLUMN public.profiles.login_count IS 'Lifetime count of successful logins (via record_login RPC).';

-- Helpful indexes for admin filtering / lookups.
CREATE INDEX IF NOT EXISTS profiles_for_whom_idx ON public.profiles (for_whom);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON public.profiles (created_at DESC);
CREATE INDEX IF NOT EXISTS profiles_last_login_at_idx ON public.profiles (last_login_at DESC);


-- ----------------------------------------------------------------------------
-- 2. login_history — audit trail of successful logins
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success     BOOLEAN NOT NULL DEFAULT TRUE,
  note        TEXT
);

COMMENT ON TABLE public.login_history IS
  'Audit trail: one row per successful login, written only by the record_login() RPC (security definer). Users can read their own rows.';
COMMENT ON COLUMN public.login_history.user_id IS 'FK to public.profiles.id (which is the auth user id).';

CREATE INDEX IF NOT EXISTS login_history_user_idx ON public.login_history (user_id, logged_in_at DESC);


-- ----------------------------------------------------------------------------
-- 3. Auto-maintain profiles.updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 4. Auto-create a profile row whenever a user signs up
--
-- Reads the metadata the app sends via supabase.auth.signUp options.data:
--   { full_name, phone, for_whom }
-- Never throws: if anything unexpected happens it logs a WARNING and lets
-- sign-up succeed — the app self-heals the missing row on next login.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta     JSONB := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_phone    TEXT;
  v_name     TEXT;
  v_for_whom public.for_whom := 'self';
BEGIN
  IF NEW.email IS NULL THEN
    RAISE WARNING '[handle_new_user] skipping profile creation: auth user % has no email', NEW.id;
    RETURN NEW;
  END IF;

  -- Keep only the last 10 digits ("+91 98765 43210" -> "9876543210").
  v_phone := nullif(
    right(regexp_replace(coalesce(v_meta ->> 'phone', v_meta ->> 'mobile', ''), '\D', '', 'g'), 10),
    ''
  );

  v_name := left(
    coalesce(
      nullif(btrim(v_meta ->> 'full_name'), ''),
      nullif(btrim(split_part(NEW.email, '@', 1)), ''),
      'Mali Vivah Member'
    ),
    80
  );
  IF char_length(v_name) < 2 THEN
    v_name := 'Mali Vivah Member';
  END IF;

  IF (v_meta ->> 'for_whom') IN ('self', 'son', 'daughter') THEN
    v_for_whom := (v_meta ->> 'for_whom')::public.for_whom;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, email, full_name, mobile, for_whom, terms_accepted_at, email_verified, created_at)
    VALUES (
      NEW.id,
      lower(NEW.email),
      v_name,
      v_phone,
      v_for_whom,
      coalesce(NEW.created_at, now()),
      NEW.email_confirmed_at IS NOT NULL,
      coalesce(NEW.created_at, now())
    )
    ON CONFLICT (id) DO UPDATE SET
      email          = EXCLUDED.email,
      full_name      = EXCLUDED.full_name,
      mobile         = coalesce(EXCLUDED.mobile, public.profiles.mobile),
      for_whom       = EXCLUDED.for_whom,
      email_verified = public.profiles.email_verified OR EXCLUDED.email_verified,
      updated_at     = now();
  EXCEPTION WHEN OTHERS THEN
    -- Never break sign-up because of the profile row; the app self-heals on login.
    RAISE WARNING '[handle_new_user] profile creation for % failed: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger function: creates/updates the public.profiles row from auth.users + sign-up metadata.';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 5. Mark email_verified once the user opens the confirmation link
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_email_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles
    SET email_verified = TRUE,
        updated_at     = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_email_verified() IS
  'Trigger function: sets profiles.email_verified when auth.users.email_confirmed_at is first set.';

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_email_verified();


-- ----------------------------------------------------------------------------
-- 6. record_login() — called by the app after every successful login.
--    Bumps last_login_at / login_count and appends a login_history row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_login()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'record_login: not authenticated';
  END IF;

  UPDATE public.profiles
  SET last_login_at = now(),
      login_count   = login_count + 1,
      updated_at    = now()
  WHERE id = auth.uid();

  -- Only write history when the profile row exists (it normally always does;
  -- the app self-heals a missing row before calling this RPC).
  IF FOUND THEN
    INSERT INTO public.login_history (user_id, success)
    VALUES (auth.uid(), TRUE);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.record_login() IS
  'Called after each successful login: updates profiles.last_login_at/login_count and appends a login_history row.';

REVOKE ALL ON FUNCTION public.record_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;


-- ----------------------------------------------------------------------------
-- 7. Backfill: create profile rows for users who signed up BEFORE this
--    migration was applied (the trigger only fires for NEW sign-ups).
--    Safe to re-run (ON CONFLICT DO NOTHING).
--
--    Note: rows whose mobile is already taken by another profile are skipped
--    (mobile must stay unique) — fix those manually in the Dashboard.
-- ----------------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, mobile, for_whom, terms_accepted_at, email_verified, created_at)
SELECT
  u.id,
  lower(u.email),
  CASE
    WHEN char_length(
      left(
        coalesce(
          nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(split_part(u.email, '@', 1)), ''),
          'Mali Vivah Member'
        ),
        80
      )
    ) >= 2
    THEN left(
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(split_part(u.email, '@', 1)), ''),
        'Mali Vivah Member'
      ),
      80
    )
    ELSE 'Mali Vivah Member'
  END,
  nullif(
    right(
      regexp_replace(
        coalesce(u.raw_user_meta_data ->> 'phone', u.raw_user_meta_data ->> 'mobile', ''),
        '\D', '', 'g'
      ),
      10
    ),
    ''
  ),
  CASE
    WHEN (u.raw_user_meta_data ->> 'for_whom') IN ('self', 'son', 'daughter')
    THEN (u.raw_user_meta_data ->> 'for_whom')::public.for_whom
    ELSE 'self'
  END,
  coalesce(u.created_at, now()),
  u.email_confirmed_at IS NOT NULL,
  coalesce(u.created_at, now())
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------------------------
-- 8. Row Level Security — users can only touch their OWN rows.
--    (service_role / admin client bypasses RLS automatically.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

-- Least-privilege table grants (RLS policies below further restrict rows).
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.login_history TO authenticated;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- No INSERT/UPDATE/DELETE policy on login_history on purpose: only the
-- record_login() RPC (security definer) and service_role can write to it.
DROP POLICY IF EXISTS "Users can view own login history" ON public.login_history;
CREATE POLICY "Users can view own login history"
  ON public.login_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
