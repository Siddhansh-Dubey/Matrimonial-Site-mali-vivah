-- ============================================================================
-- Mali Vivah · Packages + mutual-interest phone reveal
-- Migration: paid memberships, contact gating and mutual-interest helpers.
--
-- What this creates:
--   1. public.packages      — membership plans (seeded with 3 plans)
--   2. public.subscriptions — one row per purchase (user → package)
--   3. public.has_active_subscription() — TRUE when a user holds any live plan
--   4. public.mutual_interest_exists()  — TRUE only when BOTH sides showed
--      interest (accepted either way, or pending in BOTH directions)
--   5. public.get_profile_contact()     — returns the mobile number ONLY when
--      the viewer is paid AND interest is mutual; otherwise NULL
--   6. search_matches() / get_public_profile() are extended (additive only)
--      to also return gender + viewer_is_paid + mutual_interest so the app can
--      decide what to mask. Old fields are unchanged (backwards compatible).
--
-- Visibility rules enforced by the app (see src/lib/profile/visibility.ts):
--   • Free viewer  → only occupation + photo are visible, everything else masked
--   • Paid viewer  → every detail visible EXCEPT the phone number
--   • Phone number → visible iff viewer is paid AND mutual interest exists
--
-- How to apply: Supabase Dashboard → SQL Editor → paste this file → Run.
-- Safe to re-run: every statement is idempotent.
-- DEPENDS ON 20260910000000_auth_profiles.sql and
-- 20260911000000_matrimony_profiles.sql (run those first).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Enum for subscription status
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.subscription_status AS ENUM ('active', 'expired', 'cancelled');
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- 1. packages — membership plans
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.packages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price_inr     INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 90,
  features      TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT packages_price_nonneg CHECK (price_inr >= 0),
  CONSTRAINT packages_duration_pos CHECK (duration_days > 0)
);

COMMENT ON TABLE public.packages IS 'Membership packages members can purchase. Phone reveal still requires mutual interest.';

-- Keep updated_at fresh.
DROP TRIGGER IF EXISTS set_packages_updated_at ON public.packages;
CREATE TRIGGER set_packages_updated_at
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed plans (idempotent — keyed on slug).
INSERT INTO public.packages (slug, name, description, price_inr, duration_days, features, sort_order)
VALUES
  ('silver-3-month', 'Silver · 3 Months', 'View full profiles and express unlimited interests.', 999, 90,
   ARRAY['View all profile details (except phone)', 'Unlimited Express Interest', 'Shortlist profiles', 'See who viewed you'], 1),
  ('gold-6-month', 'Gold · 6 Months', 'Our most popular plan for serious families.', 1799, 180,
   ARRAY['Everything in Silver', 'Priority listing of your profile', 'Mutual-match phone reveal', 'Featured badge for 30 days'], 2),
  ('platinum-12-month', 'Platinum · 12 Months', 'A full year of stress-free searching.', 2999, 365,
   ARRAY['Everything in Gold', 'Dedicated relationship manager', 'Profile review assistance'], 3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_inr = EXCLUDED.price_inr,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();


-- ----------------------------------------------------------------------------
-- 2. subscriptions — purchases (user → package)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id  BIGINT REFERENCES public.packages (id) ON DELETE SET NULL,
  package_slug TEXT,
  status      public.subscription_status NOT NULL DEFAULT 'active',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscriptions IS 'One row per package purchase. A member is “paid” while ANY row is active and unexpired.';
COMMENT ON COLUMN public.subscriptions.package_slug IS 'Denormalised package slug at purchase time (survives package deletion).';

CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON public.subscriptions (user_id, status, expires_at DESC);

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 3. RLS for packages / subscriptions
-- ----------------------------------------------------------------------------
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.packages TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;

-- Everyone (even logged-out visitors) can read active packages.
DROP POLICY IF EXISTS "Anyone reads active packages" ON public.packages;
CREATE POLICY "Anyone reads active packages"
  ON public.packages FOR SELECT TO authenticated, anon
  USING (is_active = TRUE);

-- Members read + create their OWN subscriptions. Updates limited to own rows
-- (used for cancel flows; purchase is an INSERT).
DROP POLICY IF EXISTS "Owner reads own subscriptions" ON public.subscriptions;
CREATE POLICY "Owner reads own subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner creates own subscription" ON public.subscriptions;
CREATE POLICY "Owner creates own subscription"
  ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner updates own subscription" ON public.subscriptions;
CREATE POLICY "Owner updates own subscription"
  ON public.subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 4. has_active_subscription(p_user_id) — TRUE when any live plan exists
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_active_subscription(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := coalesce(p_user_id, auth.uid());
BEGIN
  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = v_user
      AND s.status = 'active'
      AND s.expires_at > now()
  );
END;
$$;

COMMENT ON FUNCTION public.has_active_subscription(uuid) IS
  'TRUE when the given user (default: caller) holds any active, unexpired subscription.';

REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 5. mutual_interest_exists(p_a, p_b) — TRUE only when BOTH sides showed interest
--
-- Mutual means EITHER:
--   (a) any row between the pair is ACCEPTED (A→B accepted, or B→A accepted) — A
--       sent interest and B accepted (or vice versa); OR
--   (b) BOTH directions have a live row (pending/accepted each way) — both
--       bride and groom pressed “Express Interest” on each other.
-- Declined / withdrawn rows never count.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mutual_interest_exists(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RETURN FALSE;
  END IF;

  -- Case (a): an accepted row in either direction.
  IF EXISTS (
    SELECT 1 FROM public.interests i
    WHERE ((i.sender_id = p_a AND i.receiver_id = p_b)
        OR (i.sender_id = p_b AND i.receiver_id = p_a))
      AND i.status = 'accepted'
  ) THEN
    RETURN TRUE;
  END IF;

  -- Case (b): live rows in BOTH directions.
  IF EXISTS (
    SELECT 1 FROM public.interests i1
    WHERE i1.sender_id = p_a AND i1.receiver_id = p_b
      AND i1.status IN ('pending', 'accepted')
  ) AND EXISTS (
    SELECT 1 FROM public.interests i2
    WHERE i2.sender_id = p_b AND i2.receiver_id = p_a
      AND i2.status IN ('pending', 'accepted')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.mutual_interest_exists(uuid, uuid) IS
  'TRUE only when both members showed interest: an accepted row either way, or live rows in both directions.';

REVOKE ALL ON FUNCTION public.mutual_interest_exists(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutual_interest_exists(uuid, uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. get_profile_contact(p_user_id) — phone reveal gate
-- Returns the member mobile ONLY when:
--   • the caller holds an active subscription, AND
--   • mutual interest exists between caller and the target.
-- Otherwise returns NULL (never raises — safe for UI gating).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_contact(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer UUID := auth.uid();
BEGIN
  IF v_viewer IS NULL OR p_user_id IS NULL OR v_viewer = p_user_id THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_active_subscription(v_viewer) THEN
    RETURN NULL;
  END IF;

  IF NOT public.mutual_interest_exists(v_viewer, p_user_id) THEN
    RETURN NULL;
  END IF;

  RETURN (SELECT p.mobile FROM public.profiles p WHERE p.id = p_user_id);
END;
$$;

COMMENT ON FUNCTION public.get_profile_contact(uuid) IS
  'Returns a member mobile only when the caller is paid AND interest is mutual; otherwise NULL.';

REVOKE ALL ON FUNCTION public.get_profile_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_contact(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 7. Extend search_matches() — additive: also return gender + gating flags.
--    Old clients ignore the new keys. Masking itself stays in the app layer
--    (see src/lib/profile/visibility.ts) so behaviour is identical with or
--    without this upgrade; the flags just let the UI avoid extra queries.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_matches(
  p_looking_for   public.gender DEFAULT NULL,
  p_min_age       INTEGER DEFAULT NULL,
  p_max_age       INTEGER DEFAULT NULL,
  p_city          TEXT DEFAULT NULL,
  p_sub_community TEXT DEFAULT NULL,
  p_limit         INTEGER DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_is_paid BOOLEAN := public.has_active_subscription(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'search_matches: not authenticated';
  END IF;

  SELECT jsonb_agg(card ORDER BY sort_at DESC)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'user_id', mp.user_id,
        'name', CASE
          WHEN char_length(btrim(p.full_name)) > 1
            THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
          ELSE 'Member'
        END,
        'name_full', CASE WHEN v_is_paid THEN p.full_name ELSE NULL END,
        'age', floor(date_part('year', age(mp.date_of_birth)))::int,
        'gender', mp.gender,
        'height_cm', mp.height_cm,
        'sub_community', mp.sub_community,
        'marital_status', mp.marital_status,
        'education', mp.education,
        'occupation', mp.occupation,
        'city', mp.city,
        'state', mp.state,
        'diet', mp.diet,
        'photo', pp.storage_path,
        'has_photo', (pp.storage_path IS NOT NULL),
        'viewer_is_paid', v_is_paid
      ) AS card,
      mp.updated_at AS sort_at
    FROM public.matrimony_profiles mp
    JOIN public.profiles p ON p.id = mp.user_id
    LEFT JOIN LATERAL (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ) pp ON TRUE
    WHERE mp.status = 'active'
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND mp.user_id <> auth.uid()
      AND mp.gender = coalesce(p_looking_for, mp.gender)
      AND (p_min_age IS NULL OR date_part('year', age(mp.date_of_birth)) >= p_min_age)
      AND (p_max_age IS NULL OR date_part('year', age(mp.date_of_birth)) <= p_max_age)
      AND (p_city IS NULL OR lower(mp.city) = lower(btrim(p_city)))
      AND (p_sub_community IS NULL OR lower(mp.sub_community) = lower(btrim(p_sub_community)))
    ORDER BY mp.updated_at DESC
    LIMIT greatest(least(p_limit, 200), 1)
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) IS
  'Security-definer browse RPC: masked, contact-free cards for active members. Additive v2: also returns gender, name_full (paid viewers only) and viewer_is_paid.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) TO authenticated;


-- ----------------------------------------------------------------------------
-- 8. Extend get_public_profile() — additive: gating flags + contact-when-allowed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_is_paid BOOLEAN := public.has_active_subscription(auth.uid());
  v_mutual BOOLEAN := public.mutual_interest_exists(auth.uid(), p_user_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_public_profile: not authenticated';
  END IF;

  SELECT jsonb_build_object(
    'id', mp.user_id,
    'name', CASE
      WHEN char_length(btrim(p.full_name)) > 1
        THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
      ELSE 'Member'
    END,
    'name_full', CASE WHEN v_is_paid THEN p.full_name ELSE NULL END,
    'gender', mp.gender,
    'age', floor(date_part('year', age(mp.date_of_birth)))::int,
    'height_cm', mp.height_cm,
    'religion', mp.religion,
    'sub_community', mp.sub_community,
    'mother_tongue', mp.mother_tongue,
    'marital_status', mp.marital_status,
    'education', mp.education,
    'education_details', mp.education_details,
    'occupation', mp.occupation,
    'annual_income', mp.annual_income,
    'city', mp.city,
    'state', mp.state,
    'country', mp.country,
    'diet', mp.diet,
    'gotra', mp.gotra,
    'about_me', mp.about_me,
    'hobbies', mp.hobbies,
    'photos', COALESCE(
      (SELECT jsonb_agg(ph.storage_path ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC)
       FROM public.profile_photos ph WHERE ph.profile_id = mp.user_id),
      '[]'::jsonb
    ),
    'viewer_is_paid', v_is_paid,
    'mutual_interest', v_mutual,
    'contact_phone', CASE WHEN (v_is_paid AND v_mutual) THEN p.mobile ELSE NULL END
  )
  INTO v_result
  FROM public.matrimony_profiles mp
  JOIN public.profiles p ON p.id = mp.user_id
  WHERE mp.user_id = p_user_id
    AND mp.status = 'active'
    AND mp.user_id <> auth.uid();

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Security-definer RPC: masked, contact-free profile for the detail page + additive v2 flags (name_full when paid, viewer_is_paid, mutual_interest, contact_phone when paid+mutual).';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;
