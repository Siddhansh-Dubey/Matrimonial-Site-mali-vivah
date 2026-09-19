-- ============================================================================
-- Mali Vivah · Step 5 — lifestyle filters in Advanced Search
--
-- Extends the existing search_matches() RPC with optional smoking and drinking
-- filters. Diet was already an advanced filter and is intentionally preserved.
-- All three values use the profile model's enum types, and all three predicates
-- remain behind the existing server-authoritative `advanced_search` benefit.
--
-- This migration does NOT change profile visibility, Daily 5, package benefits,
-- package pricing, partner preferences, result-card fields, or search ordering.
-- ============================================================================

-- A function's input types are its PostgreSQL identity. Appending parameters
-- creates an overload rather than replacing the old function, so remove the v4
-- signature first. The new parameters are appended to keep all earlier
-- positional arguments in their existing order.
DROP FUNCTION IF EXISTS public.search_matches(
  public.gender, integer, integer, text, text, integer, text, text, text,
  public.marital_status, public.diet, text, integer, integer
);

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
  p_max_height     INTEGER DEFAULT NULL,
  p_smoking        public.lifestyle_choice DEFAULT NULL,
  p_drinking       public.lifestyle_choice DEFAULT NULL
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
       OR p_diet IS NOT NULL OR p_smoking IS NOT NULL OR p_drinking IS NOT NULL
       OR p_min_income IS NOT NULL
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
      -- Advanced filters are inert unless the caller's current plan grants the
      -- advanced_search benefit. This check is inside the SECURITY DEFINER RPC,
      -- so direct calls cannot bypass the package gate.
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
      AND (NOT v_advanced OR p_smoking IS NULL OR mp.smoking = p_smoking)
      AND (NOT v_advanced OR p_drinking IS NULL OR mp.drinking = p_drinking)
      AND (NOT v_advanced OR p_min_income IS NULL
           OR public.income_band_rank(mp.annual_income) >= public.income_band_rank(p_min_income))
      AND (NOT v_advanced OR p_min_height IS NULL OR mp.height_cm >= p_min_height)
      AND (NOT v_advanced OR p_max_height IS NULL OR mp.height_cm <= p_max_height)
    ORDER BY boosted DESC, mp.updated_at DESC
    LIMIT v_limit
  ) t;

  -- Preserve the existing server-authoritative search analytics behaviour.
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

COMMENT ON FUNCTION public.search_matches(
  public.gender, integer, integer, text, text, integer, text, text, text,
  public.marital_status, public.diet, text, integer, integer,
  public.lifestyle_choice, public.lifestyle_choice
) IS
  'Safe profile browse RPC (v5): publicly-listed profiles only, blocked pairs excluded, boosted profiles first. Advanced filters, including diet/smoking/drinking and sub-community, apply only when the caller has the advanced_search benefit. NULL filters do not constrain results.';

REVOKE ALL ON FUNCTION public.search_matches(
  public.gender, integer, integer, text, text, integer, text, text, text,
  public.marital_status, public.diet, text, integer, integer,
  public.lifestyle_choice, public.lifestyle_choice
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(
  public.gender, integer, integer, text, text, integer, text, text, text,
  public.marital_status, public.diet, text, integer, integer,
  public.lifestyle_choice, public.lifestyle_choice
) TO anon, authenticated;
