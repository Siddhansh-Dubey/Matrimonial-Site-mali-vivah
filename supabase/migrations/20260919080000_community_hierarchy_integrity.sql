-- ============================================================================
-- Mali Vivah · Step 3 — community / sub-community hierarchy is AUTHORITATIVE
--
-- WHAT IT DOES
--   The hierarchy (communities → sub_communities → matrimony_profiles) already
--   exists (20260915010000). What was missing is INTEGRITY: the two plain
--   foreign keys let a row point at Community A + a sub-community of
--   Community B, the wizard never wrote the IDs at all, and the legacy text
--   column `sub_community` could drift from `sub_community_id`.
--
--   §1 enforce_community_hierarchy() — BEFORE INSERT/UPDATE trigger on
--      matrimony_profiles:
--        * sub_community_id must belong to community_id (COMMUNITY_MISMATCH);
--          when community_id is NULL it is derived from the sub-community.
--        * an INACTIVE community / sub-community cannot be newly selected
--          (COMMUNITY_INACTIVE). Rows that already point at a row that was
--          deactivated later keep working — only a CHANGE is blocked.
--        * the legacy text column is kept in sync: when sub_community_id is
--          set, sub_community := sub_communities.name. When only the legacy
--          text is written (old clients), it is resolved to the matching row
--          (case-insensitive, within the selected community when known) so
--          IDs get populated instead of a second source of truth appearing.
--   §2 normalise_partner_community_prefs() — BEFORE INSERT/UPDATE trigger on
--      partner_preferences: preferred_communities / preferred_sub_communities
--      stay TEXT[] (the public representation the Daily 5 engine consumes)
--      but every value is canonicalised to a real DB row name; unknown
--      values are dropped. No parallel ID columns are introduced.
--   §3 Backfill / repair of existing rows: derive community_id from
--      sub_community_id, fix mismatched pairs (the sub-community wins because
--      it is the more specific fact), map legacy text to rows (active AND
--      inactive — a legacy member keeps their historical value), and re-sync
--      the text column with the linked row.
--   §4 search_matches() v4 — the p_sub_community TEXT contract is unchanged
--      (bookmarks keep working) but the filter resolves through
--      sub_community_id first; legacy text matching only applies to rows
--      without an ID. Cards gain an additive 'community' key.
--   §5 get_public_profile() v5 — additive 'community' key; sub_community is
--      read through the hierarchy (coalesce(sub_communities.name, legacy)).
--
-- NOT DONE HERE (on purpose)
--   * matrimony_profiles.sub_community is NOT dropped — existing read paths
--     (Daily 5 scoring, biodata PDF, cards) still read it; the trigger keeps
--     it equal to the linked row so those paths stay correct.
--   * No new tables, no preferred_*_ids columns, no matching rewrite.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON migrations up to 20260919070000.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Hierarchy integrity + legacy text sync on matrimony_profiles
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_community_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub  public.sub_communities%ROWTYPE;
  v_com  public.communities%ROWTYPE;
  v_sub_changed BOOLEAN := TG_OP = 'INSERT' OR NEW.sub_community_id IS DISTINCT FROM OLD.sub_community_id;
  v_com_changed BOOLEAN := TG_OP = 'INSERT' OR NEW.community_id     IS DISTINCT FROM OLD.community_id;
BEGIN
  -- (a) Legacy client wrote only the text: resolve it to a row so the IDs
  --     become populated. Scoped to the chosen community when one is set,
  --     otherwise any community (only safe while names are unambiguous —
  --     ambiguous names are left unresolved rather than guessed).
  IF NEW.sub_community_id IS NULL
     AND nullif(btrim(coalesce(NEW.sub_community, '')), '') IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.sub_community IS DISTINCT FROM OLD.sub_community
          OR OLD.sub_community_id IS NULL) THEN
    SELECT sc.* INTO v_sub
    FROM public.sub_communities sc
    WHERE lower(btrim(sc.name)) = lower(btrim(NEW.sub_community))
      AND (NEW.community_id IS NULL OR sc.community_id = NEW.community_id)
      AND sc.is_active
    ORDER BY sc.sort_order, sc.id
    LIMIT 1;
    IF FOUND AND (
         NEW.community_id IS NOT NULL
         OR (SELECT count(DISTINCT sc2.community_id) FROM public.sub_communities sc2
             WHERE lower(btrim(sc2.name)) = lower(btrim(NEW.sub_community)) AND sc2.is_active) = 1
       ) THEN
      NEW.sub_community_id := v_sub.id;
      v_sub_changed := TRUE;
    END IF;
  END IF;

  -- (b) With a sub-community: it must be a real row that belongs to the
  --     community; community_id is derived when absent.
  IF NEW.sub_community_id IS NOT NULL THEN
    SELECT sc.* INTO v_sub FROM public.sub_communities sc WHERE sc.id = NEW.sub_community_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMMUNITY_INVALID: unknown sub-community %', NEW.sub_community_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.community_id IS NULL THEN
      NEW.community_id := v_sub.community_id;
      v_com_changed := TRUE;
    ELSIF NEW.community_id <> v_sub.community_id THEN
      RAISE EXCEPTION 'COMMUNITY_MISMATCH: sub-community "%" does not belong to the selected community', v_sub.name
        USING ERRCODE = 'check_violation',
              HINT = 'Pick a sub-community from the selected community.';
    END IF;

    IF v_sub_changed AND NOT v_sub.is_active THEN
      RAISE EXCEPTION 'COMMUNITY_INACTIVE: sub-community "%" is no longer available', v_sub.name
        USING ERRCODE = 'check_violation';
    END IF;

    -- IDs are authoritative: the legacy text mirrors the linked row.
    NEW.sub_community := v_sub.name;
  END IF;

  -- (c) Community itself must be a real, active (when newly chosen) row.
  IF NEW.community_id IS NOT NULL THEN
    SELECT c.* INTO v_com FROM public.communities c WHERE c.id = NEW.community_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMMUNITY_INVALID: unknown community %', NEW.community_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_com_changed AND NOT v_com.is_active THEN
      RAISE EXCEPTION 'COMMUNITY_INACTIVE: community "%" is no longer available', v_com.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_community_hierarchy() IS
  'BEFORE INSERT/UPDATE trigger on matrimony_profiles: sub_community_id must belong to community_id (COMMUNITY_MISMATCH), inactive rows cannot be newly selected (COMMUNITY_INACTIVE), community_id is derived from the sub-community when absent, and the legacy sub_community text is kept equal to the linked row name (or resolved to a row when only text was written).';

-- The trigger is created in §3 AFTER the one-off backfill so historical rows
-- that legitimately map to inactive sub-communities can be linked.


-- ----------------------------------------------------------------------------
-- §2 Partner preferences — values must be real hierarchy rows
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalise_partner_community_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.preferred_sub_communities IS DISTINCT FROM OLD.preferred_sub_communities THEN
    SELECT coalesce(array_agg(sc.name ORDER BY sc.sort_order, sc.name), '{}'::text[])
    INTO NEW.preferred_sub_communities
    FROM public.sub_communities sc
    WHERE sc.is_active
      AND lower(btrim(sc.name)) IN (
        SELECT lower(btrim(v)) FROM unnest(coalesce(NEW.preferred_sub_communities, '{}'::text[])) v
      )
      -- restrict to the preferred communities when the member named any
      AND (coalesce(array_length(NEW.preferred_communities, 1), 0) = 0
           OR sc.community_id IN (
             SELECT c.id FROM public.communities c
             WHERE lower(btrim(c.name)) IN (
               SELECT lower(btrim(v)) FROM unnest(NEW.preferred_communities) v)));
  END IF;

  IF TG_OP = 'INSERT' OR NEW.preferred_communities IS DISTINCT FROM OLD.preferred_communities THEN
    SELECT coalesce(array_agg(c.name ORDER BY c.sort_order, c.name), '{}'::text[])
    INTO NEW.preferred_communities
    FROM public.communities c
    WHERE c.is_active
      AND lower(btrim(c.name)) IN (
        SELECT lower(btrim(v)) FROM unnest(coalesce(NEW.preferred_communities, '{}'::text[])) v
      );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_partner_community_prefs() IS
  'BEFORE INSERT/UPDATE trigger on partner_preferences: preferred_communities / preferred_sub_communities stay TEXT[] but every value is canonicalised to an ACTIVE communities/sub_communities row name; unknown values are dropped so no hard-coded list can leak in.';

DROP TRIGGER IF EXISTS partner_preferences_community_prefs ON public.partner_preferences;
CREATE TRIGGER partner_preferences_community_prefs
  BEFORE INSERT OR UPDATE OF preferred_communities, preferred_sub_communities ON public.partner_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.normalise_partner_community_prefs();


-- ----------------------------------------------------------------------------
-- §3 Backfill / repair, then install the trigger
-- ----------------------------------------------------------------------------
-- 3a. sub_community_id present → community_id must be its parent.
--     Covers NULL community_id AND historical mismatches.
UPDATE public.matrimony_profiles mp
SET community_id = sc.community_id
FROM public.sub_communities sc
WHERE sc.id = mp.sub_community_id
  AND mp.community_id IS DISTINCT FROM sc.community_id;

-- 3b. Legacy text only → link to the row with that name inside the row's
--     community (falls back to any community when the profile has none and
--     the name is unambiguous). Inactive rows are included on purpose: a
--     historical member keeps their historical value.
UPDATE public.matrimony_profiles mp
SET sub_community_id = sc.id,
    community_id     = sc.community_id
FROM public.sub_communities sc
WHERE mp.sub_community_id IS NULL
  AND nullif(btrim(coalesce(mp.sub_community, '')), '') IS NOT NULL
  AND lower(btrim(sc.name)) = lower(btrim(mp.sub_community))
  AND (mp.community_id IS NULL OR sc.community_id = mp.community_id)
  AND (SELECT count(DISTINCT s2.community_id) FROM public.sub_communities s2
       WHERE lower(btrim(s2.name)) = lower(btrim(mp.sub_community))
         AND (mp.community_id IS NULL OR s2.community_id = mp.community_id)) = 1;

-- 3c. Text mirrors the linked row.
UPDATE public.matrimony_profiles mp
SET sub_community = sc.name
FROM public.sub_communities sc
WHERE sc.id = mp.sub_community_id
  AND mp.sub_community IS DISTINCT FROM sc.name;

-- 3d. Canonicalise existing preference arrays once (drops unknown values).
UPDATE public.partner_preferences pp
SET preferred_sub_communities = pp.preferred_sub_communities
WHERE coalesce(array_length(pp.preferred_sub_communities, 1), 0) > 0
  AND EXISTS (
    SELECT 1 FROM unnest(pp.preferred_sub_communities) v
    WHERE v NOT IN (SELECT sc.name FROM public.sub_communities sc WHERE sc.is_active));

DROP TRIGGER IF EXISTS matrimony_profiles_community_hierarchy ON public.matrimony_profiles;
CREATE TRIGGER matrimony_profiles_community_hierarchy
  BEFORE INSERT OR UPDATE OF community_id, sub_community_id, sub_community ON public.matrimony_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_community_hierarchy();


-- ----------------------------------------------------------------------------
-- §4 search_matches() v4 — ID-resolved sub-community filter, same contract
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_matches(
  p_looking_for    public.gender DEFAULT NULL,
  p_min_age        INTEGER DEFAULT NULL,
  p_max_age        INTEGER DEFAULT NULL,
  p_city           TEXT DEFAULT NULL,
  p_sub_community  TEXT DEFAULT NULL,
  p_limit          INTEGER DEFAULT 60,
  p_education      TEXT DEFAULT NULL,
  p_occupation     TEXT DEFAULT NULL,
  p_native_place   TEXT DEFAULT NULL,
  p_marital_status public.marital_status DEFAULT NULL,
  p_diet           public.diet DEFAULT NULL,
  p_min_income     TEXT DEFAULT NULL,
  p_min_height     INTEGER DEFAULT NULL,
  p_max_height     INTEGER DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result   jsonb;
  v_limit    INTEGER := CASE
    WHEN auth.uid() IS NULL THEN least(greatest(coalesce(p_limit, 5), 1), 5)
    ELSE least(greatest(coalesce(p_limit, 60), 1), 200)
  END;
  v_is_paid  BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
  v_advanced BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_benefit('advanced_search', auth.uid())
  END;
  v_filters  INTEGER := 0;
BEGIN
  IF p_looking_for IS NOT NULL THEN v_filters := v_filters + 1; END IF;
  IF p_min_age IS NOT NULL OR p_max_age IS NOT NULL THEN v_filters := v_filters + 1; END IF;
  IF p_city IS NOT NULL THEN v_filters := v_filters + 1; END IF;
  IF v_advanced AND p_sub_community IS NOT NULL THEN v_filters := v_filters + 1; END IF;
  IF v_advanced AND (p_education IS NOT NULL OR p_occupation IS NOT NULL
       OR p_native_place IS NOT NULL OR p_marital_status IS NOT NULL
       OR p_diet IS NOT NULL OR p_min_income IS NOT NULL
       OR p_min_height IS NOT NULL OR p_max_height IS NOT NULL) THEN
    v_filters := v_filters + 1;
  END IF;

  SELECT jsonb_agg(card ORDER BY boosted DESC, sort_at DESC)
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
        'age', CASE WHEN v_is_paid THEN floor(date_part('year', age(mp.date_of_birth)))::int ELSE NULL END,
        'gender', mp.gender,
        'height_cm', CASE WHEN v_is_paid THEN mp.height_cm ELSE NULL END,
        'sub_community', CASE WHEN v_is_paid THEN coalesce(sc.name, mp.sub_community) ELSE NULL END,
        'community', c.name,
        'marital_status', CASE WHEN v_is_paid THEN mp.marital_status ELSE NULL END,
        'education', CASE WHEN v_is_paid THEN mp.education ELSE NULL END,
        'occupation', mp.occupation,
        'city', CASE WHEN v_is_paid THEN mp.city ELSE NULL END,
        'state', CASE WHEN v_is_paid THEN mp.state ELSE NULL END,
        'diet', CASE WHEN v_is_paid THEN mp.diet ELSE NULL END,
        'photo', pp.storage_path,
        'has_photo', (pp.storage_path IS NOT NULL),
        'verified', (mp.verified_at IS NOT NULL),
        'is_boosted', public.has_active_boost(mp.user_id),
        'viewer_is_paid', v_is_paid
      ) AS card,
      public.has_active_boost(mp.user_id) AS boosted,
      mp.updated_at AS sort_at
    FROM public.matrimony_profiles mp
    JOIN public.profiles p ON p.id = mp.user_id
    LEFT JOIN public.communities c ON c.id = mp.community_id
    LEFT JOIN public.sub_communities sc ON sc.id = mp.sub_community_id
    LEFT JOIN LATERAL (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id
        AND ph.kind = 'profile_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ) pp ON TRUE
    WHERE public.is_profile_public(mp.user_id)
      AND NOT public.is_blocked(auth.uid(), mp.user_id)
      AND mp.gender = coalesce(p_looking_for, mp.gender)
      AND (p_min_age IS NULL OR date_part('year', age(mp.date_of_birth)) >= p_min_age)
      AND (p_max_age IS NULL OR date_part('year', age(mp.date_of_birth)) <= p_max_age)
      AND (p_city IS NULL OR lower(mp.city) = lower(btrim(p_city)))
      -- advanced filters: inert unless the caller's plan includes the benefit
      -- Sub-community: resolved by ID against the hierarchy first (authoritative),
      -- falling back to the legacy text column for rows that never got an ID.
      AND (NOT v_advanced OR p_sub_community IS NULL
           OR (mp.sub_community_id IS NOT NULL AND mp.sub_community_id IN (
                 SELECT sc.id FROM public.sub_communities sc
                 WHERE lower(btrim(sc.name)) = lower(btrim(p_sub_community))))
           OR (mp.sub_community_id IS NULL AND lower(mp.sub_community) = lower(btrim(p_sub_community))))
      AND (NOT v_advanced OR p_education IS NULL OR lower(mp.education) = lower(btrim(p_education)))
      AND (NOT v_advanced OR p_occupation IS NULL OR lower(mp.occupation) = lower(btrim(p_occupation)))
      AND (NOT v_advanced OR p_native_place IS NULL OR lower(mp.native_place) ILIKE '%' || lower(btrim(p_native_place)) || '%')
      AND (NOT v_advanced OR p_marital_status IS NULL OR mp.marital_status = p_marital_status)
      AND (NOT v_advanced OR p_diet IS NULL OR mp.diet = p_diet)
      AND (NOT v_advanced OR p_min_income IS NULL
           OR public.income_band_rank(mp.annual_income) >= public.income_band_rank(p_min_income))
      AND (NOT v_advanced OR p_min_height IS NULL OR mp.height_cm >= p_min_height)
      AND (NOT v_advanced OR p_max_height IS NULL OR mp.height_cm <= p_max_height)
    ORDER BY boosted DESC, mp.updated_at DESC
    LIMIT v_limit
  ) t;

  -- Server-authoritative analytics (anonymous browse is not logged).
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.log_activity(
      auth.uid(),
      'search_performed',
      jsonb_build_object('filters', v_filters, 'advanced', v_advanced, 'results', coalesce(jsonb_array_length(v_result), 0))
    );
  END IF;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) IS
  'Safe profile browse RPC (v4: sub-community filter resolves through sub_community_id, cards carry the community name): publicly-listed profiles only (is_profile_public), blocked pairs excluded, boosted profiles first. Advanced filters (sub-community/education/occupation/native place/marital/diet/income/height) apply only with the advanced_search plan benefit. Logs search_performed analytics.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §5 get_public_profile() v5 — additive community name
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_is_paid BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
  v_mutual BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.mutual_interest_exists(auth.uid(), p_user_id)
  END;
BEGIN
  SELECT jsonb_build_object(
    'id', mp.user_id,
    'name', CASE
      WHEN char_length(btrim(p.full_name)) > 1
        THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
      ELSE 'Member'
    END,
    'name_full', CASE WHEN v_is_paid THEN p.full_name ELSE NULL END,
    'gender', mp.gender,
    'verified', (mp.verified_at IS NOT NULL),
    'is_boosted', public.has_active_boost(mp.user_id),
    'age', CASE WHEN v_is_paid THEN floor(date_part('year', age(mp.date_of_birth)))::int ELSE NULL END,
    'height_cm', CASE WHEN v_is_paid THEN mp.height_cm ELSE NULL END,
    'religion', CASE WHEN v_is_paid THEN mp.religion ELSE NULL END,
    'sub_community', CASE WHEN v_is_paid THEN coalesce(sc.name, mp.sub_community) ELSE NULL END,
    'community', c.name,
    'mother_tongue', CASE WHEN v_is_paid THEN mp.mother_tongue ELSE NULL END,
    'marital_status', CASE WHEN v_is_paid THEN mp.marital_status ELSE NULL END,
    'education', CASE WHEN v_is_paid THEN mp.education ELSE NULL END,
    'education_details', CASE WHEN v_is_paid THEN mp.education_details ELSE NULL END,
    'occupation', mp.occupation,
    'company', CASE WHEN v_is_paid THEN mp.company ELSE NULL END,
    'annual_income', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_income')::boolean, TRUE)
                     THEN mp.annual_income ELSE NULL END,
    'city', CASE WHEN v_is_paid THEN mp.city ELSE NULL END,
    'state', CASE WHEN v_is_paid THEN mp.state ELSE NULL END,
    'country', CASE WHEN v_is_paid THEN mp.country ELSE NULL END,
    'native_place', CASE WHEN v_is_paid THEN mp.native_place ELSE NULL END,
    'diet', CASE WHEN v_is_paid THEN mp.diet ELSE NULL END,
    'smoking', CASE WHEN v_is_paid THEN mp.smoking ELSE NULL END,
    'drinking', CASE WHEN v_is_paid THEN mp.drinking ELSE NULL END,
    'gotra', CASE WHEN v_is_paid THEN mp.gotra ELSE NULL END,
    'about_me', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_about')::boolean, TRUE)
                  THEN mp.about_me ELSE NULL END,
    'hobbies', CASE WHEN v_is_paid THEN mp.hobbies ELSE '{}'::text[] END,
    'father_occupation', CASE WHEN v_is_paid THEN mp.father_occupation ELSE NULL END,
    'mother_occupation', CASE WHEN v_is_paid THEN mp.mother_occupation ELSE NULL END,
    'siblings', CASE WHEN v_is_paid THEN mp.siblings ELSE NULL END,
    'family_type', CASE WHEN v_is_paid THEN mp.family_type ELSE NULL END,
    'family_location', CASE WHEN v_is_paid THEN mp.family_location ELSE NULL END,
    'family_details', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_family_details')::boolean, TRUE)
                       THEN mp.family_details ELSE NULL END,
    'photos', COALESCE(
      (SELECT jsonb_agg(ph.storage_path ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC)
       FROM public.profile_photos ph
       WHERE ph.profile_id = mp.user_id AND ph.kind = 'profile_photo'),
      '[]'::jsonb
    ),
    'family_photo', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_family_photo')::boolean, TRUE) THEN (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id AND ph.kind = 'family_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ) ELSE NULL END,
    'viewer_is_paid', v_is_paid,
    'mutual_interest', v_mutual,
    'contact_phone', CASE WHEN (v_is_paid AND v_mutual) THEN p.mobile ELSE NULL END,
    'contact_email', CASE WHEN (v_is_paid AND v_mutual) THEN p.email ELSE NULL END,
    'whatsapp_allowed', CASE
      WHEN (v_is_paid AND v_mutual) AND coalesce(mp.whatsapp_opt_in, FALSE)
      THEN TRUE ELSE FALSE
    END
  )
  INTO v_result
  FROM public.matrimony_profiles mp
  JOIN public.profiles p ON p.id = mp.user_id
  LEFT JOIN public.communities c ON c.id = mp.community_id
  LEFT JOIN public.sub_communities sc ON sc.id = mp.sub_community_id
  WHERE mp.user_id = p_user_id
    AND public.is_profile_public(p_user_id)
    AND NOT public.is_blocked(auth.uid(), p_user_id);

  -- View analytics: only real, publicly-listed views of SOMEONE ELSE
  -- (self-views never count).
  IF v_result IS NOT NULL AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    PERFORM public.log_activity(
      auth.uid(),
      'profile_viewed',
      jsonb_build_object('target', p_user_id)
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Safe public profile for publicly-listed members (v5: adds the community name; sub_community is read through the hierarchy). Paid viewers additionally see the family section + lifestyle fields when the member''s privacy_settings allow. Phone AND email only when paid + mutual. whatsapp_allowed adds the member''s WhatsApp opt-in to the same gate. Logs profile_viewed analytics.';
