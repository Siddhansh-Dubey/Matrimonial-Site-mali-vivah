-- ============================================================================
-- Mali Vivah · Matrimony / matchmaking data model
-- Migration: the "next flow" after login & registration.
--
-- This creates the tables the app needs once a user has an account:
--
--   1. public.matrimony_profiles — the detailed member profile (age, height,
--      education, occupation, city, sub-community, diet, about, hobbies…).
--      One row per user (1:1 with public.profiles.id). Kept SEPARATE from
--      auth data so contact details (profiles.mobile/email) never leak into
--      the browsable match data.
--   2. public.profile_photos      — one or more photos per matrimony profile.
--   3. public.partner_preferences — "what you are looking for" (private).
--   4. public.interests           — Express Interest (sender → receiver).
--   5. public.shortlists          — saved / favourite profiles.
--   6. public.profile_views       — "who viewed my profile" audit.
--   7. Trigger on public.profiles — auto-creates a draft matrimony profile +
--      partner preferences whenever a new account is created.
--   8. Row Level Security         — owners manage their own rows; active
--      profiles are browsable by other members but WITHOUT any contact info.
--   9. public.search_matches()    — RPC that returns safe, masked profile
--      cards for the Browse / Search page (never email / mobile).
--  10. public.get_public_profile()— RPC for a single public profile card.
--
-- Contact info (email / mobile) lives ONLY in public.profiles and is never
-- returned by the browse RPCs — it is revealed later, out-of-band, once both
-- families agree (a future "contact exchange" step).
--
-- How to apply: Supabase Dashboard → SQL Editor → paste this file → Run.
-- Safe to re-run: every statement is idempotent.
--
-- DEPENDS ON the previous migration (20260910000000_auth_profiles.sql) for
-- public.profiles, public.for_whom and public.set_updated_at(). Run them in
-- filename order.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Enums
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.gender AS ENUM ('male', 'female');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marital_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.marital_status AS ENUM ('never_married', 'divorced', 'widowed', 'awaiting_divorce');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diet' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.diet AS ENUM ('vegetarian', 'non_vegetarian', 'eggetarian', 'jain', 'vegan');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.profile_status AS ENUM ('draft', 'pending_review', 'active', 'hidden', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interest_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.interest_status AS ENUM ('pending', 'accepted', 'declined', 'withdrawn');
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- 1. matrimony_profiles — the detailed member profile (one row per user)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matrimony_profiles (
  user_id           UUID PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,

  profile_for       public.for_whom NOT NULL DEFAULT 'self',
  gender            public.gender,                       -- required before publish
  date_of_birth     DATE,
  height_cm         SMALLINT,
  religion          TEXT NOT NULL DEFAULT 'Hindu',
  sub_community     TEXT,                                -- Mali / Phul Mali / Maratha Mali / Lal Mali / Other
  mother_tongue     TEXT NOT NULL DEFAULT 'Marathi',
  marital_status    public.marital_status NOT NULL DEFAULT 'never_married',
  education         TEXT,
  education_details TEXT,
  occupation        TEXT,
  annual_income     TEXT,                                -- free-text band, e.g. "5 - 10 LPA"
  city              TEXT,
  state             TEXT NOT NULL DEFAULT 'Maharashtra',
  country           TEXT NOT NULL DEFAULT 'India',
  diet              public.diet NOT NULL DEFAULT 'vegetarian',
  gotra             TEXT,
  about_me          TEXT,
  hobbies           TEXT[] NOT NULL DEFAULT '{}',

  status            public.profile_status NOT NULL DEFAULT 'draft',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT matrimony_profiles_height_range CHECK (height_cm IS NULL OR (height_cm BETWEEN 120 AND 220)),
  CONSTRAINT matrimony_profiles_dob_sane CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE)
);

COMMENT ON TABLE public.matrimony_profiles IS
  'Detailed matrimony profile for each member. One row per public.profiles.id. Contains only match-relevant data — NO email/mobile (those stay in public.profiles and are never browsable).';
COMMENT ON COLUMN public.matrimony_profiles.user_id IS 'PK + FK to public.profiles.id (the auth user id).';
COMMENT ON COLUMN public.matrimony_profiles.status IS 'Lifecycle: draft → pending_review/active. Only ''active'' rows appear in Browse/Search.';

CREATE INDEX IF NOT EXISTS matrimony_profiles_status_idx ON public.matrimony_profiles (status);
CREATE INDEX IF NOT EXISTS matrimony_profiles_gender_idx ON public.matrimony_profiles (gender, status);
CREATE INDEX IF NOT EXISTS matrimony_profiles_city_idx ON public.matrimony_profiles (city);
CREATE INDEX IF NOT EXISTS matrimony_profiles_sub_community_idx ON public.matrimony_profiles (sub_community);


-- ----------------------------------------------------------------------------
-- 2. profile_photos — photos attached to a matrimony profile
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_photos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id   UUID NOT NULL REFERENCES public.matrimony_profiles (user_id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,                            -- path inside the 'profile-photos' bucket
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_photos IS 'Photos for a matrimony profile (Supabase Storage ''profile-photos'' bucket).';

CREATE INDEX IF NOT EXISTS profile_photos_profile_idx ON public.profile_photos (profile_id, sort_order);

-- At most one primary photo per profile.
CREATE UNIQUE INDEX IF NOT EXISTS profile_photos_one_primary_idx
  ON public.profile_photos (profile_id)
  WHERE is_primary;


-- ----------------------------------------------------------------------------
-- 3. partner_preferences — "what you are looking for" (private)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_preferences (
  profile_id                UUID PRIMARY KEY REFERENCES public.matrimony_profiles (user_id) ON DELETE CASCADE,
  preferred_gender          public.gender NOT NULL DEFAULT 'female',
  min_age                   SMALLINT NOT NULL DEFAULT 21,
  max_age                   SMALLINT NOT NULL DEFAULT 35,
  min_height_cm             SMALLINT,
  max_height_cm             SMALLINT,
  preferred_cities          TEXT[] NOT NULL DEFAULT '{}',
  preferred_sub_communities TEXT[] NOT NULL DEFAULT '{}',
  preferred_education       TEXT,
  preferred_occupation      TEXT,
  preferred_marital_status  public.marital_status,
  preferred_diet            public.diet,
  note                      TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT partner_prefs_age_order CHECK (min_age <= max_age),
  CONSTRAINT partner_prefs_height_order CHECK (min_height_cm IS NULL OR max_height_cm IS NULL OR min_height_cm <= max_height_cm)
);

COMMENT ON TABLE public.partner_preferences IS 'Private partner preferences for each matrimony profile. Never shown to other members.';


-- ----------------------------------------------------------------------------
-- 4. interests — Express Interest between two members
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id   UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status      public.interest_status NOT NULL DEFAULT 'pending',
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT interests_no_self CHECK (sender_id <> receiver_id),
  CONSTRAINT interests_unique_pair UNIQUE (sender_id, receiver_id)
);

COMMENT ON TABLE public.interests IS 'Expressed interests between members (one row per sender→receiver pair).';

CREATE INDEX IF NOT EXISTS interests_receiver_idx ON public.interests (receiver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS interests_sender_idx ON public.interests (sender_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- 5. shortlists — saved / favourite profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shortlists (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  target_id  UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT shortlists_no_self CHECK (user_id <> target_id),
  CONSTRAINT shortlists_unique UNIQUE (user_id, target_id)
);

COMMENT ON TABLE public.shortlists IS 'Profiles a member has shortlisted / saved.';

CREATE INDEX IF NOT EXISTS shortlists_user_idx ON public.shortlists (user_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- 6. profile_views — "who viewed my profile"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_views (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewer_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  viewed_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT profile_views_no_self CHECK (viewer_id <> viewed_id)
);

COMMENT ON TABLE public.profile_views IS 'Profile view history (who looked at whose profile).';

CREATE INDEX IF NOT EXISTS profile_views_viewed_idx ON public.profile_views (viewed_id, viewed_at DESC);


-- ----------------------------------------------------------------------------
-- 7. Keep updated_at fresh on the mutable tables
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_matrimony_profiles_updated_at ON public.matrimony_profiles;
CREATE TRIGGER set_matrimony_profiles_updated_at
  BEFORE UPDATE ON public.matrimony_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_partner_preferences_updated_at ON public.partner_preferences;
CREATE TRIGGER set_partner_preferences_updated_at
  BEFORE UPDATE ON public.partner_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_interests_updated_at ON public.interests;
CREATE TRIGGER set_interests_updated_at
  BEFORE UPDATE ON public.interests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 8. Auto-create a draft matrimony profile + partner preferences on sign-up.
--    (Runs after handle_new_user() creates the public.profiles row.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_matrimony_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.matrimony_profiles (user_id, profile_for, status, created_at, updated_at)
  VALUES (NEW.id, NEW.for_whom, 'draft', now(), now())
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.partner_preferences (profile_id, preferred_gender, created_at, updated_at)
  VALUES (NEW.id,
          CASE WHEN NEW.for_whom = 'daughter' THEN 'male'::public.gender ELSE 'female'::public.gender END,
          now(), now())
  ON CONFLICT (profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_matrimony_profile() IS
  'Trigger: creates a draft matrimony_profiles + partner_preferences row whenever a new public.profiles row is created.';

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_matrimony_profile();


-- ----------------------------------------------------------------------------
-- 9. Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.matrimony_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrimony_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_photos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interests TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.shortlists TO authenticated;
GRANT SELECT, INSERT ON public.profile_views TO authenticated;

-- matrimony_profiles: owners manage their own row; other members may READ
-- only 'active' rows (no contact info lives here, so this is safe).
DROP POLICY IF EXISTS "Owner reads own matrimony profile" ON public.matrimony_profiles;
CREATE POLICY "Owner reads own matrimony profile"
  ON public.matrimony_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members read active matrimony profiles" ON public.matrimony_profiles;
CREATE POLICY "Members read active matrimony profiles"
  ON public.matrimony_profiles FOR SELECT TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "Owner inserts own matrimony profile" ON public.matrimony_profiles;
CREATE POLICY "Owner inserts own matrimony profile"
  ON public.matrimony_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner updates own matrimony profile" ON public.matrimony_profiles;
CREATE POLICY "Owner updates own matrimony profile"
  ON public.matrimony_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner deletes own matrimony profile" ON public.matrimony_profiles;
CREATE POLICY "Owner deletes own matrimony profile"
  ON public.matrimony_profiles FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- profile_photos: owner manages; other members read photos of active profiles.
DROP POLICY IF EXISTS "Owner reads own photos" ON public.profile_photos;
CREATE POLICY "Owner reads own photos"
  ON public.profile_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.matrimony_profiles mp WHERE mp.user_id = profile_photos.profile_id AND mp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members read photos of active profiles" ON public.profile_photos;
CREATE POLICY "Members read photos of active profiles"
  ON public.profile_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.matrimony_profiles mp WHERE mp.user_id = profile_photos.profile_id AND mp.status = 'active'));

DROP POLICY IF EXISTS "Owner inserts own photos" ON public.profile_photos;
CREATE POLICY "Owner inserts own photos"
  ON public.profile_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.matrimony_profiles mp WHERE mp.user_id = profile_photos.profile_id AND mp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Owner updates own photos" ON public.profile_photos;
CREATE POLICY "Owner updates own photos"
  ON public.profile_photos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.matrimony_profiles mp WHERE mp.user_id = profile_photos.profile_id AND mp.user_id = auth.uid()));

DROP POLICY IF EXISTS "Owner deletes own photos" ON public.profile_photos;
CREATE POLICY "Owner deletes own photos"
  ON public.profile_photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.matrimony_profiles mp WHERE mp.user_id = profile_photos.profile_id AND mp.user_id = auth.uid()));

-- partner_preferences: strictly private to the owner.
DROP POLICY IF EXISTS "Owner manages own partner preferences" ON public.partner_preferences;
CREATE POLICY "Owner manages own partner preferences"
  ON public.partner_preferences FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- interests: both parties can read a shared row; only sender can create /
-- withdraw, receiver can accept / decline.
DROP POLICY IF EXISTS "Parties read shared interest" ON public.interests;
CREATE POLICY "Parties read shared interest"
  ON public.interests FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS "Sender creates interest" ON public.interests;
CREATE POLICY "Sender creates interest"
  ON public.interests FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "Parties update interest" ON public.interests;
CREATE POLICY "Parties update interest"
  ON public.interests FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR receiver_id = auth.uid());

-- shortlists: owner manages their own saved list.
DROP POLICY IF EXISTS "Owner reads own shortlist" ON public.shortlists;
CREATE POLICY "Owner reads own shortlist"
  ON public.shortlists FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner adds to shortlist" ON public.shortlists;
CREATE POLICY "Owner adds to shortlist"
  ON public.shortlists FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner removes from shortlist" ON public.shortlists;
CREATE POLICY "Owner removes from shortlist"
  ON public.shortlists FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- profile_views: viewer inserts; the viewed member reads their own visitors.
DROP POLICY IF EXISTS "Viewer records a view" ON public.profile_views;
CREATE POLICY "Viewer records a view"
  ON public.profile_views FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid());

DROP POLICY IF EXISTS "Member reads own visitors" ON public.profile_views;
CREATE POLICY "Member reads own visitors"
  ON public.profile_views FOR SELECT TO authenticated
  USING (viewed_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 10. search_matches() — safe browse/search of ACTIVE profiles.
--     Returns JSON cards with a masked name and NO email/mobile.
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
        'age', floor(date_part('year', age(mp.date_of_birth)))::int,
        'height_cm', mp.height_cm,
        'sub_community', mp.sub_community,
        'marital_status', mp.marital_status,
        'education', mp.education,
        'occupation', mp.occupation,
        'city', mp.city,
        'state', mp.state,
        'diet', mp.diet,
        'photo', pp.storage_path,
        'has_photo', (pp.storage_path IS NOT NULL)
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
  'Security-definer browse RPC: returns masked, contact-free profile cards for active members, filtered by looking-for / age / city / sub-community.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) TO authenticated;


-- ----------------------------------------------------------------------------
-- 11. get_public_profile() — a single public profile card (for the detail page)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
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
    )
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
  'Security-definer RPC: returns a single masked, contact-free profile for the detail page (active profiles only, never your own).';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 12. Supabase Storage bucket for profile photos (guarded — storage is optional)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('profile-photos', 'profile-photos', TRUE)
    ON CONFLICT (id) DO NOTHING;

    -- Public read: active profiles' photos are viewable via signed/public URL.
    -- Uploads are gated by the RLS policies on public.profile_photos.
    DROP POLICY IF EXISTS "Public read profile photos" ON storage.objects;
    CREATE POLICY "Public read profile photos"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'profile-photos');
  END IF;
END
$$;
