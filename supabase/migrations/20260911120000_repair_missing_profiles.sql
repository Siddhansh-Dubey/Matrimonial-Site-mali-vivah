-- ============================================================================
-- Mali Vivah · REPAIR for the wizard error:
--   insert or update on table "matrimony_profiles" violates foreign key
--   constraint "matrimony_profiles_user_id_fkey"
--
-- WHY YOU SEE THAT ERROR
--   The profile wizard (src/components/profile/profile-wizard.tsx) writes to
--   public.matrimony_profiles, whose user_id column references
--   public.profiles.id. The insert can only fail this way when the signed-in
--   user has NO row in public.profiles.
--
-- HOW A USER ENDS UP WITHOUT A profiles ROW (every path is silent, so that
-- neither sign-up nor login ever appears broken):
--   1. handle_new_user() (the sign-up trigger) swallows ALL failures — most
--      commonly a UNIQUE violation on profiles.mobile, i.e. a second account
--      registered with a phone number another member already claimed (very
--      common while testing), or the mobile CHECK constraint rejecting a
--      phone outside the [6-9]xxxxxxxxx format.
--   2. The login self-heal in login-form.tsx inserts the row with the same
--      mobile and fails the same way (it only logs a console warning).
--   3. The backfill in 20260910000000_auth_profiles.sql uses
--      ON CONFLICT DO NOTHING, which silently skips those users too.
--   And because the on_profile_created trigger only fires when a profiles
--   row is INSERTed, these users never got their matrimony_profiles /
--   partner_preferences rows either — so the wizard's very first upsert
--   trips the foreign key above.
--
-- WHAT THIS MIGRATION DOES (every statement is idempotent — safe to re-run):
--   §0  Diagnostics — read-only queries that show exactly which users are
--       affected and why (run the whole file, or highlight §0 alone).
--   §1  Repair — creates the missing public.profiles rows. A mobile is kept
--       only when it is a valid 10-digit Indian mobile AND not already used
--       by another member; otherwise it is left NULL (never blocks repair).
--       The existing on_profile_created trigger then auto-creates each
--       user's matrimony_profiles + partner_preferences rows.
--   §2  Backfill — adds matrimony_profiles / partner_preferences rows for
--       profiles that existed BEFORE 20260911000000_matrimony_profiles.sql
--       (its trigger only fires for rows created after that migration).
--   §3  Harden handle_new_user() — on a unique violation it now retries
--       WITHOUT the mobile, so a shared phone number can never again leave
--       an account without its profiles row.
--   §4  ensure_my_profile() — a security-definer RPC the app calls before
--       saving the wizard; it guarantees the caller's profiles +
--       matrimony_profiles + partner_preferences rows exist, which makes the
--       foreign key error impossible for a signed-in user.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste this file → Run.
--
-- DEPENDS ON 20260910000000_auth_profiles.sql and
-- 20260911000000_matrimony_profiles.sql (run those first if not applied).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Diagnostics (read-only — safe to run on its own, run again any time)
-- ----------------------------------------------------------------------------

-- 0a. Auth users WITHOUT a public.profiles row — these are the users hitting
--     the foreign key error in the profile wizard:
SELECT u.id,
       u.email,
       u.created_at,
       u.raw_user_meta_data ->> 'full_name'                     AS meta_name,
       coalesce(u.raw_user_meta_data ->> 'phone',
                u.raw_user_meta_data ->> 'mobile')              AS meta_phone
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;

-- 0b. The usual reason §0a is non-empty: the sign-up phone is already claimed
--     by ANOTHER member's profile, so the trigger's insert failed silently:
SELECT u.id,
       u.email,
       right(regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone',
                                     u.raw_user_meta_data ->> 'mobile', ''),
                            '\D', '', 'g'), 10)                 AS wanted_mobile,
       p.email                                                AS taken_by
FROM auth.users u
JOIN public.profiles p
  ON p.mobile = right(regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone',
                                              u.raw_user_meta_data ->> 'mobile', ''),
                                     '\D', '', 'g'), 10)
 AND p.id <> u.id;

-- 0c. Profiles rows that never got a matrimony_profiles row (pre-date the
--     second migration) — repaired by §2 below:
SELECT p.id, p.email, p.created_at
FROM public.profiles p
LEFT JOIN public.matrimony_profiles mp ON mp.user_id = p.id
WHERE mp.user_id IS NULL
ORDER BY p.created_at;


-- ----------------------------------------------------------------------------
-- §1 Repair — create the missing public.profiles rows
-- ----------------------------------------------------------------------------

-- One row per auth user that has none yet. The mobile is only kept when it is
-- a valid 10-digit Indian mobile AND not already used by another member —
-- otherwise NULL, because a missing mobile must never block the repair (the
-- login form backfills it from sign-up metadata when possible).
WITH missing AS (
  SELECT
    u.id,
    lower(u.email)                                                     AS email,
    coalesce(u.raw_user_meta_data, '{}'::jsonb)                        AS meta,
    u.email_confirmed_at IS NOT NULL                                   AS email_verified,
    coalesce(u.created_at, now())                                      AS created_at,
    nullif(
      right(
        regexp_replace(
          coalesce(u.raw_user_meta_data ->> 'phone',
                   u.raw_user_meta_data ->> 'mobile', ''),
          '\D', '', 'g'
        ),
        10
      ),
      ''
    )                                                                  AS wanted_mobile
  FROM auth.users u
  WHERE u.email IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id  = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.email = lower(u.email))
)
INSERT INTO public.profiles (id, email, full_name, mobile, for_whom, terms_accepted_at, email_verified, created_at)
SELECT
  m.id,
  m.email,
  CASE
    WHEN char_length(
      left(coalesce(nullif(btrim(m.meta ->> 'full_name'), ''),
                    nullif(btrim(split_part(m.email, '@', 1)), ''),
                    'Mali Vivah Member'), 80)
    ) >= 2
    THEN left(coalesce(nullif(btrim(m.meta ->> 'full_name'), ''),
                       nullif(btrim(split_part(m.email, '@', 1)), ''),
                       'Mali Vivah Member'), 80)
    ELSE 'Mali Vivah Member'
  END,
  CASE
    WHEN m.wanted_mobile ~ '^[6-9][0-9]{9}$'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.mobile = m.wanted_mobile)
    THEN m.wanted_mobile
    ELSE NULL
  END,
  CASE
    WHEN (m.meta ->> 'for_whom') IN ('self', 'son', 'daughter')
    THEN (m.meta ->> 'for_whom')::public.for_whom
    ELSE 'self'
  END,
  m.created_at,
  m.email_verified,
  m.created_at
FROM missing m
ON CONFLICT (id) DO NOTHING;

-- The on_profile_created trigger (from 20260911000000_matrimony_profiles.sql)
-- fires for every row inserted above and creates the matching
-- matrimony_profiles + partner_preferences rows automatically.


-- ----------------------------------------------------------------------------
-- §2 Backfill — matrimony rows for profiles created BEFORE the second
--    migration ran (its trigger only fires for rows created after it)
-- ----------------------------------------------------------------------------

INSERT INTO public.matrimony_profiles (user_id, profile_for, status, created_at, updated_at)
SELECT p.id, p.for_whom, 'draft', now(), now()
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.matrimony_profiles mp WHERE mp.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.partner_preferences (profile_id, preferred_gender, created_at, updated_at)
SELECT
  mp.user_id,
  CASE WHEN mp.profile_for = 'daughter' THEN 'male'::public.gender ELSE 'female'::public.gender END,
  now(),
  now()
FROM public.matrimony_profiles mp
WHERE NOT EXISTS (SELECT 1 FROM public.partner_preferences pp WHERE pp.profile_id = mp.user_id)
ON CONFLICT (profile_id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- §3 Harden handle_new_user() — a unique violation on the mobile (or email)
--    must never leave a new account without its profiles row. The trigger now
--    retries WITHOUT the mobile; only a total failure is swallowed (and
--    warned), as before. The mobile format is validated up-front so a
--    non-Indian test number can no longer trip the CHECK constraint either.
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

  -- Keep only the last 10 digits ("+91 98765 43210" -> "9876543210")…
  v_phone := nullif(
    right(regexp_replace(coalesce(v_meta ->> 'phone', v_meta ->> 'mobile', ''), '\D', '', 'g'), 10),
    ''
  );
  -- …and only when they form a valid Indian mobile ([6-9]xxxxxxxxx).
  IF v_phone IS NOT NULL AND v_phone !~ '^[6-9][0-9]{9}$' THEN
    v_phone := NULL;
  END IF;

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
  EXCEPTION
    WHEN unique_violation THEN
      -- The mobile (or, extremely unlikely, the email) is already claimed by
      -- ANOTHER member. The account still MUST get its profiles row — retry
      -- without the mobile so the foreign key chain is never broken.
      BEGIN
        INSERT INTO public.profiles (id, email, full_name, mobile, for_whom, terms_accepted_at, email_verified, created_at)
        VALUES (
          NEW.id,
          lower(NEW.email),
          v_name,
          NULL,
          v_for_whom,
          coalesce(NEW.created_at, now()),
          NEW.email_confirmed_at IS NOT NULL,
          coalesce(NEW.created_at, now())
        )
        ON CONFLICT (id) DO UPDATE SET
          email          = EXCLUDED.email,
          full_name      = EXCLUDED.full_name,
          for_whom       = EXCLUDED.for_whom,
          email_verified = public.profiles.email_verified OR EXCLUDED.email_verified,
          updated_at     = now();
      EXCEPTION WHEN OTHERS THEN
        -- Still never break sign-up; ensure_my_profile() (§4) can repair.
        RAISE WARNING '[handle_new_user] profile creation for % failed: %', NEW.id, SQLERRM;
      END;
    WHEN OTHERS THEN
      -- Never break sign-up because of the profile row; the app self-heals
      -- on login and via ensure_my_profile().
      RAISE WARNING '[handle_new_user] profile creation for % failed: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger function: creates/updates the public.profiles row from auth.users + sign-up metadata. Retries without the mobile on a unique violation so an account is never left without its profiles row.';


-- ----------------------------------------------------------------------------
-- §4 ensure_my_profile() — belt-and-braces RPC for the app.
--    The profile wizard calls this before its first save. It guarantees the
--    caller's profiles + matrimony_profiles + partner_preferences rows exist,
--    so the "matrimony_profiles_user_id_fkey" foreign key error cannot happen
--    for a signed-in user. Missing rows are built from auth.users +
--    sign-up metadata; the mobile is only set when valid and unclaimed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta     JSONB;
  v_email    TEXT;
  v_name     TEXT;
  v_phone    TEXT;
  v_for_whom public.for_whom := 'self';
  v_confirmed BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ensure_my_profile: not authenticated';
  END IF;

  SELECT lower(u.email),
         coalesce(u.raw_user_meta_data, '{}'::jsonb),
         (u.email_confirmed_at IS NOT NULL)
    INTO v_email, v_meta, v_confirmed
  FROM auth.users u
  WHERE u.id = auth.uid();

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'ensure_my_profile: auth user % not found', auth.uid();
  END IF;

  -- Normalise the sign-up metadata (same rules as handle_new_user).
  v_phone := nullif(
    right(regexp_replace(coalesce(v_meta ->> 'phone', v_meta ->> 'mobile', ''), '\D', '', 'g'), 10),
    ''
  );
  IF v_phone IS NOT NULL AND (v_phone !~ '^[6-9][0-9]{9}$'
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.mobile = v_phone)) THEN
    v_phone := NULL;  -- invalid, or already claimed by another member
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
    v_name := left(
      coalesce(
        nullif(btrim(v_meta ->> 'full_name'), ''),
        nullif(btrim(split_part(v_email, '@', 1)), ''),
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

    INSERT INTO public.profiles (id, email, full_name, mobile, for_whom, email_verified, created_at)
    VALUES (auth.uid(), v_email, v_name, v_phone, v_for_whom, v_confirmed, now())
    ON CONFLICT (id) DO NOTHING;
  ELSIF v_phone IS NOT NULL THEN
    -- Profile exists but has no mobile on record — backfill it when we can.
    BEGIN
      UPDATE public.profiles
      SET mobile = v_phone
      WHERE id = auth.uid()
        AND mobile IS NULL;
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- lost a race for the mobile — not fatal, stay without a mobile
    END;
  END IF;

  -- Guarantee the matrimony rows as well (same shape as the
  -- ensure_matrimony_profile trigger, but callable on demand).
  INSERT INTO public.matrimony_profiles (user_id, profile_for, status, created_at, updated_at)
  SELECT p.id, p.for_whom, 'draft', now(), now()
  FROM public.profiles p
  WHERE p.id = auth.uid()
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.partner_preferences (profile_id, preferred_gender, created_at, updated_at)
  SELECT
    mp.user_id,
    CASE WHEN mp.profile_for = 'daughter' THEN 'male'::public.gender ELSE 'female'::public.gender END,
    now(),
    now()
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = auth.uid()
  ON CONFLICT (profile_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.ensure_my_profile() IS
  'Called by the profile wizard before saving: guarantees the caller''s public.profiles, matrimony_profiles and partner_preferences rows exist (repairs accounts that were silently left without them, e.g. because their phone number was already claimed).';

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;
