-- ============================================================================
-- Mali Vivah · Phase 1 — profile data model, community hierarchy, family photo
-- Migration 2 of the Phase 1 completion pass.
--
-- WHAT IT DOES
--   §1 communities / sub_communities — the COMMUNITY → SUB-COMMUNITY → PROFILE
--      hierarchy the PRD asks for. Mali is *seeded*, not hard-coded: adding
--      another community later is a row insert, not a schema change.
--   §2 matrimony_profiles — the PRD data model fields that were missing:
--      native place, company/business, lifestyle (smoking/drinking), the whole
--      family block, privacy settings and the WhatsApp consent flag.
--   §3 partner_preferences — preferred income, communities, native place.
--   §4 profile_photos.kind — separates the profile photo from the FAMILY photo.
--      Every existing photo is a 'profile_photo' (column default), so nothing
--      is reinterpreted and no photo is lost.
--   §5 enforce_publishable_profile() — a profile cannot be moved INTO 'active'
--      without gender, date of birth, city, education, occupation AND both a
--      profile photo and a family photo. This is the server-side half of
--      "Family Photo is mandatory"; the wizard is the client-side half.
--   §6 RLS for the new tables + the new columns.
--
-- NON-BREAKING BY DESIGN
--   * Rows already at status='active' are left alone; the trigger only guards
--     the transition INTO 'active'. Publicity is decided separately by
--     is_profile_public() (next migration), so an old profile without a family
--     photo is simply not listed until the member adds one — nothing is
--     deleted and no error is thrown at them.
--   * sub_community (text) is kept; sub_community_id is added alongside it.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run.
-- DEPENDS ON 20260915000000_enum_extensions.sql (photo_kind, family_type,
-- lifestyle_choice) — run that first.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Community hierarchy
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.communities IS
  'Top level of the COMMUNITY → SUB-COMMUNITY → PROFILE hierarchy. Phase 1 ships Mali; the table keeps the model extensible to other communities.';

CREATE TABLE IF NOT EXISTS public.sub_communities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sub_communities_unique_per_community UNIQUE (community_id, slug)
);

COMMENT ON TABLE public.sub_communities IS
  'Second level of the community hierarchy (Mali / Phul Mali / Maratha Mali / Lal Mali / …).';

CREATE INDEX IF NOT EXISTS sub_communities_community_idx ON public.sub_communities (community_id, sort_order);

DROP TRIGGER IF EXISTS set_communities_updated_at ON public.communities;
CREATE TRIGGER set_communities_updated_at
  BEFORE UPDATE ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_sub_communities_updated_at ON public.sub_communities;
CREATE TRIGGER set_sub_communities_updated_at
  BEFORE UPDATE ON public.sub_communities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the Phase 1 community + its sub-communities (keyed on slug).
INSERT INTO public.communities (slug, name, sort_order)
VALUES ('mali', 'Mali', 1)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

INSERT INTO public.sub_communities (community_id, slug, name, sort_order)
SELECT c.id, v.slug, v.name, v.sort_order
FROM public.communities c
CROSS JOIN (VALUES
  ('mali',        'Mali',        1),
  ('phul-mali',   'Phul Mali',   2),
  ('maratha-mali','Maratha Mali',3),
  ('lal-mali',    'Lal Mali',    4),
  ('other',       'Other',       5)
) AS v(slug, name, sort_order)
WHERE c.slug = 'mali'
ON CONFLICT (community_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now();


-- ----------------------------------------------------------------------------
-- §2 matrimony_profiles — PRD data model fields
-- ----------------------------------------------------------------------------
ALTER TABLE public.matrimony_profiles
  ADD COLUMN IF NOT EXISTS community_id      UUID REFERENCES public.communities (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_community_id  UUID REFERENCES public.sub_communities (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS native_place      TEXT,
  ADD COLUMN IF NOT EXISTS company           TEXT,
  ADD COLUMN IF NOT EXISTS smoking           public.lifestyle_choice NOT NULL DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS drinking          public.lifestyle_choice NOT NULL DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS father_occupation TEXT,
  ADD COLUMN IF NOT EXISTS mother_occupation TEXT,
  ADD COLUMN IF NOT EXISTS siblings          TEXT,
  ADD COLUMN IF NOT EXISTS family_type       public.family_type NOT NULL DEFAULT 'joint',
  ADD COLUMN IF NOT EXISTS family_location   TEXT,
  ADD COLUMN IF NOT EXISTS family_details    TEXT,
  ADD COLUMN IF NOT EXISTS privacy_settings  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.matrimony_profiles.community_id IS 'FK to public.communities. Nullable so pre-migration rows keep working; backfilled to Mali below.';
COMMENT ON COLUMN public.matrimony_profiles.privacy_settings IS
  'Per-field visibility overrides, e.g. {"show_income": false, "show_family_photo": true, "show_about": true}. Empty object = package defaults.';
COMMENT ON COLUMN public.matrimony_profiles.whatsapp_opt_in IS 'Optional consent for WhatsApp communication, collected at registration/profile time.';

CREATE INDEX IF NOT EXISTS matrimony_profiles_community_idx ON public.matrimony_profiles (community_id);
CREATE INDEX IF NOT EXISTS matrimony_profiles_sub_community_id_idx ON public.matrimony_profiles (sub_community_id);
CREATE INDEX IF NOT EXISTS matrimony_profiles_native_place_idx ON public.matrimony_profiles (native_place);

-- Backfill the hierarchy links from the free-text values already stored.
UPDATE public.matrimony_profiles mp
SET community_id = c.id
FROM public.communities c
WHERE c.slug = 'mali'
  AND mp.community_id IS NULL;

UPDATE public.matrimony_profiles mp
SET sub_community_id = sc.id
FROM public.sub_communities sc
WHERE mp.sub_community_id IS NULL
  AND lower(btrim(coalesce(mp.sub_community, ''))) = lower(btrim(sc.name));


-- ----------------------------------------------------------------------------
-- §3 partner_preferences — remaining PRD preference fields
-- ----------------------------------------------------------------------------
ALTER TABLE public.partner_preferences
  ADD COLUMN IF NOT EXISTS preferred_income         TEXT,
  ADD COLUMN IF NOT EXISTS preferred_communities    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_native_place   TEXT,
  ADD COLUMN IF NOT EXISTS preferred_family_type    public.family_type;


-- ----------------------------------------------------------------------------
-- §4 profile_photos.kind — profile photo vs. family photo
-- ----------------------------------------------------------------------------
ALTER TABLE public.profile_photos
  ADD COLUMN IF NOT EXISTS kind public.photo_kind NOT NULL DEFAULT 'profile_photo';

COMMENT ON COLUMN public.profile_photos.kind IS
  'profile_photo = the member''s own picture (required). family_photo = the mandatory family picture. The column default backfills every pre-existing photo as a profile photo.';

-- The old "one primary per profile" index must now be per (profile, kind),
-- otherwise adding a primary family photo would collide with the primary
-- profile photo. Drop the old index and replace it.
DROP INDEX IF EXISTS public.profile_photos_one_primary_idx;
CREATE UNIQUE INDEX IF NOT EXISTS profile_photos_one_primary_per_kind_idx
  ON public.profile_photos (profile_id, kind)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS profile_photos_kind_idx ON public.profile_photos (profile_id, kind, sort_order);

-- Every profile needs exactly one row per photo kind to be publishable; this
-- keeps lookups cheap and prevents a duplicate family photo.
CREATE UNIQUE INDEX IF NOT EXISTS profile_photos_one_family_per_profile_idx
  ON public.profile_photos (profile_id)
  WHERE kind = 'family_photo';


-- ----------------------------------------------------------------------------
-- §5 enforce_publishable_profile() — server-side publish gate
--
-- A profile may only MOVE INTO 'active' when every field the public listing
-- and the biodata PDF depend on is present, including BOTH photos. Rows that
-- are already 'active' are never blocked (an admin edit must not explode), and
-- publicity itself is decided by is_profile_public() so the two agree.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_publishable_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- array_append(), not `|| ': `text[] || text` resolves to anyarray||anyarray
  -- and Postgres then parses the string as an array literal
  -- ("malformed array literal"). Verified with a real PostgreSQL run.
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Only guard the transition into 'active'.
  IF NEW.status IS DISTINCT FROM 'active'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'active') THEN
    RETURN NEW;
  END IF;

  IF NEW.gender IS NULL THEN
    v_missing := array_append(v_missing, 'gender');
  END IF;
  IF NEW.date_of_birth IS NULL THEN
    v_missing := array_append(v_missing, 'date of birth');
  END IF;
  IF nullif(btrim(coalesce(NEW.city, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'city');
  END IF;
  IF nullif(btrim(coalesce(NEW.education, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'education');
  END IF;
  IF nullif(btrim(coalesce(NEW.occupation, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'occupation');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profile_photos ph
    WHERE ph.profile_id = NEW.user_id AND ph.kind = 'profile_photo'
  ) THEN
    v_missing := array_append(v_missing, 'profile photo');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_photos ph
    WHERE ph.profile_id = NEW.user_id AND ph.kind = 'family_photo'
  ) THEN
    v_missing := array_append(v_missing, 'family photo');
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'PROFILE_INCOMPLETE: %', array_to_string(v_missing, ', ')
      USING HINT = 'A profile can only be published once these are provided.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_publishable_profile() IS
  'BEFORE INSERT/UPDATE trigger on matrimony_profiles: blocks the transition into status=active unless gender, date of birth, city, education, occupation, a profile photo AND a family photo are all present. Raises PROFILE_INCOMPLETE with the missing field list.';

DROP TRIGGER IF EXISTS matrimony_profiles_publish_gate ON public.matrimony_profiles;
CREATE TRIGGER matrimony_profiles_publish_gate
  BEFORE INSERT OR UPDATE OF status ON public.matrimony_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_publishable_profile();


-- ----------------------------------------------------------------------------
-- §6 RLS for the new lookup tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_communities ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.communities TO authenticated, anon;
GRANT SELECT ON public.sub_communities TO authenticated, anon;

DROP POLICY IF EXISTS "Anyone reads active communities" ON public.communities;
CREATE POLICY "Anyone reads active communities"
  ON public.communities FOR SELECT TO authenticated, anon
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Anyone reads active sub-communities" ON public.sub_communities;
CREATE POLICY "Anyone reads active sub-communities"
  ON public.sub_communities FOR SELECT TO authenticated, anon
  USING (is_active = TRUE);
