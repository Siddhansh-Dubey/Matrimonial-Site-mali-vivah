-- ============================================================================
-- Mali Vivah — Phase 2: sub-community becomes an advanced (gated) filter
-- ============================================================================
-- search_matches() FINAL v2 — identical to the §9 definition except
-- p_sub_community now applies ONLY when the caller's plan includes the
-- advanced_search benefit (same rule as education/occupation/…). The /search
-- page moved the control into its gated Advanced section; /brides and
-- /grooms no longer send the parameter at all.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260915130000 (§9).
-- ============================================================================

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
  -- Advanced filters apply ONLY for plans with the benefit — a free member
  -- sending them anyway gets basic search, never an error.
  v_advanced BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_benefit('advanced_search', auth.uid())
  END;
BEGIN
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
        'sub_community', CASE WHEN v_is_paid THEN mp.sub_community ELSE NULL END,
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
      AND (NOT v_advanced OR p_sub_community IS NULL OR lower(mp.sub_community) = lower(btrim(p_sub_community)))
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

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) IS
  'Safe profile browse RPC: publicly-listed profiles only (is_profile_public), blocked pairs excluded, boosted profiles first. Advanced filters (sub-community/education/occupation/native place/marital/diet/income/height) apply only with the advanced_search plan benefit.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) TO anon, authenticated;
