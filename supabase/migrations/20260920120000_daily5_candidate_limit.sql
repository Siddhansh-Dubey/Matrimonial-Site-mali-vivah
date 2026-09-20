-- ============================================================================
-- Mali Vivah · Step 9 — Daily 5: apply the configured candidate count BEFORE
-- the final jsonb_agg()
--
-- WHAT THIS FIXES
--   * get_daily_matches() (20260915130000 §3) accumulated every
--     threshold-passing candidate into v_list and then ran
--
--         SELECT jsonb_agg(item ORDER BY score DESC, boosted DESC, md5…) 
--         FROM (SELECT item FROM jsonb_array_elements(v_list)) s
--         LIMIT v_count
--
--     That LIMIT applies to the OUTPUT ROWS of the aggregate query — which is
--     exactly ONE row — so it never truncated the JSONB array. Every
--     threshold-passing candidate came back no matter what
--     matching_config.daily_count (or the RPC's p_limit argument) said: a
--     member configured for 5 matches could receive 25.
--
--     The corrected order of operations is the one the PRD always described:
--       build eligible candidates → score → drop below-threshold →
--       rank (score DESC → boost DESC → deterministic daily tie-break) →
--       LIMIT candidate ROWS to the configured daily_count → jsonb_agg() the
--       selected rows only.
--
-- WHAT CHANGES (and what deliberately does NOT)
--   * Same signature: get_daily_matches(p_limit INTEGER DEFAULT NULL) →
--     JSONB. CREATE OR REPLACE — no overload, no caller changes, and
--     src/lib/supabase/database.types.ts stays valid as-is.
--   * Scoring is byte-for-byte unchanged: the same component weights
--     (age 15, location 15, education 10, occupation 10, income 10,
--     community 10, partner_prefs 15, lifestyle 10, behaviour 5), the same
--     per-component rules, the same reason strings, the same rounding.
--   * Threshold semantics unchanged: candidates scoring below
--     matching_config.threshold (default 90) are dropped — NO padding, NO
--     placeholder cards, NO lowering to fill the count. Fewer qualifying
--     candidates than daily_count (including zero) is a correct result.
--   * Ranking is unchanged: score DESC, then boost status DESC, then
--     md5(user_id || current_date) — the deterministic daily shuffle inside
--     equal scores is preserved; it now simply runs on candidate ROWS before
--     the cut, so the same viewer gets the same list all day.
--   * Visibility/safety gates unchanged: is_profile_public() (active + complete
--     + photos + live membership + admin hold clear) and is_blocked() are
--     still the only publicity rules; boost still can never make an
--     ineligible profile eligible — it remains an ordering tie-break between
--     already-qualifying candidates.
--   * daily_count is now authoritative for API callers too: an explicit
--     p_limit argument may only ask for FEWER matches than configured, never
--     more — an RPC parameter can no longer bypass the configured daily
--     count. The /matches page calls the RPC without arguments, so app
--     behaviour is unchanged.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (CREATE OR REPLACE, identical signature/return type).
-- DEPENDS ON 20260915130000_engagement_admin.sql (defines the function and
-- matching_config) and 20260920000000_featured_boost_ordering.sql (applied
-- earlier; does not touch this function).
-- ============================================================================


CREATE OR REPLACE FUNCTION public.get_daily_matches(p_limit INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer    UUID := auth.uid();
  v_cfg       JSONB;
  v_w         JSONB;
  v_threshold NUMERIC;
  v_count     INTEGER;
  v_is_paid   BOOLEAN;
  v_me        public.matrimony_profiles%ROWTYPE;
  v_prefs     public.partner_preferences%ROWTYPE;
  v_cand      RECORD;
  v_age       NUMERIC;
  v_out       JSONB := '[]'::jsonb;
  v_list      JSONB := '[]'::jsonb;

  -- per-candidate scratch
  s_age NUMERIC; s_loc NUMERIC; s_edu NUMERIC; s_occ NUMERIC;
  s_inc NUMERIC; s_com NUMERIC; s_pref NUMERIC; s_life NUMERIC; s_beh NUMERIC;
  v_score NUMERIC;
  v_reasons TEXT[];
  v_cand_age NUMERIC;
  v_pref_checks NUMERIC;
  v_checked NUMERIC;
  v_last_login TIMESTAMPTZ;
  v_weight_of TEXT;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'get_daily_matches: not authenticated';
  END IF;

  v_cfg := public.matching_settings();
  v_w := v_cfg -> 'weights';
  v_threshold := coalesce((v_cfg ->> 'threshold')::numeric, 90);
  -- Step 9: matching_config.daily_count is authoritative. An explicit
  -- p_limit argument may only ask for FEWER matches than configured, never
  -- more — an RPC parameter cannot bypass the configured daily count.
  v_count := greatest(1, least(
               coalesce(p_limit, (v_cfg ->> 'daily_count')::int, 5),
               coalesce((v_cfg ->> 'daily_count')::int, 5),
               25));
  v_is_paid := public.has_live_membership(v_viewer);

  SELECT mp.* INTO v_me FROM public.matrimony_profiles mp WHERE mp.user_id = v_viewer;
  SELECT pp.* INTO v_prefs FROM public.partner_preferences pp WHERE pp.profile_id = v_viewer;

  -- Build the candidate set: publicly listed, unblocked, the gender the
  -- member is looking for, never the member themself.
  FOR v_cand IN
    SELECT mp.*, pr.full_name, ph.storage_path AS photo, pr.last_login_at
    FROM public.matrimony_profiles mp
    JOIN public.profiles pr ON pr.id = mp.user_id
    LEFT JOIN LATERAL (
      SELECT x.storage_path FROM public.profile_photos x
      WHERE x.profile_id = mp.user_id AND x.kind = 'profile_photo'
      ORDER BY x.is_primary DESC, x.sort_order ASC, x.id ASC LIMIT 1
    ) ph ON TRUE
    WHERE mp.user_id <> v_viewer
      AND public.is_profile_public(mp.user_id)
      AND NOT public.is_blocked(v_viewer, mp.user_id)
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND mp.gender = coalesce(v_prefs.preferred_gender,
                 CASE WHEN v_me.gender = 'male' THEN 'female'::public.gender ELSE 'male'::public.gender END)
  LOOP
    v_cand_age := date_part('year', age(v_cand.date_of_birth));
    v_reasons := ARRAY[]::TEXT[];

    -- ── age (def. 15): inside the preferred band → full; ±3 → half
    s_age := 0;
    IF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) AND coalesce(v_prefs.max_age, 60) THEN
      s_age := 1;
      v_reasons := array_append(v_reasons, 'Age within your preferred range');
    ELSIF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) - 3 AND coalesce(v_prefs.max_age, 60) + 3 THEN
      s_age := 0.5;
      v_reasons := array_append(v_reasons, 'Age close to your preferred range');
    END IF;

    -- ── location (15): preferred cities win; fall back to same city/state
    s_loc := 0;
    IF coalesce(array_length(v_prefs.preferred_cities, 1), 0) > 0 THEN
      IF EXISTS (SELECT 1 FROM unnest(v_prefs.preferred_cities) c
                 WHERE lower(c) = lower(btrim(coalesce(v_cand.city, '')))) THEN
        s_loc := 1;
        v_reasons := array_append(v_reasons, 'Lives in your preferred city');
      ELSIF lower(v_cand.state) = lower(v_me.state) THEN
        s_loc := 0.4;
      END IF;
    ELSIF lower(btrim(coalesce(v_cand.city, ''))) <> '' AND lower(v_cand.city) = lower(v_me.city) THEN
      s_loc := 1;
      v_reasons := array_append(v_reasons, 'Lives in your city');
    ELSIF lower(v_cand.state) = lower(v_me.state) THEN
      s_loc := 0.6;
      v_reasons := array_append(v_reasons, 'Lives in your state');
    ELSE
      s_loc := 0.2;
    END IF;

    -- ── education (10)
    s_edu := 0;
    IF nullif(btrim(coalesce(v_prefs.preferred_education, '')), '') IS NOT NULL THEN
      IF lower(v_cand.education) = lower(v_prefs.preferred_education) THEN
        s_edu := 1;
        v_reasons := array_append(v_reasons, 'Education matches your preference');
      END IF;
    ELSIF public.education_rank(v_cand.education) > 0 THEN
      IF public.education_rank(v_cand.education) = public.education_rank(v_me.education) THEN
        s_edu := 1;
        v_reasons := array_append(v_reasons, 'Same education level');
      ELSIF abs(public.education_rank(v_cand.education) - public.education_rank(v_me.education)) = 1 THEN
        s_edu := 0.5;
      END IF;
    END IF;

    -- ── occupation (10)
    s_occ := 0;
    IF nullif(btrim(coalesce(v_prefs.preferred_occupation, '')), '') IS NOT NULL THEN
      IF lower(v_cand.occupation) = lower(v_prefs.preferred_occupation) THEN
        s_occ := 1;
        v_reasons := array_append(v_reasons, 'Occupation matches your preference');
      END IF;
    ELSIF nullif(btrim(coalesce(v_cand.occupation, '')), '') IS NOT NULL THEN
      IF lower(v_cand.occupation) = lower(v_me.occupation) THEN
        s_occ := 1;
        v_reasons := array_append(v_reasons, 'Similar occupation');
      ELSE
        s_occ := 0.3;
      END IF;
    END IF;

    -- ── income (10): preferred band is a floor; no preference → neutral
    s_inc := 0.4;
    IF nullif(btrim(coalesce(v_prefs.preferred_income, '')), '') IS NOT NULL
       AND public.income_band_rank(v_prefs.preferred_income) >= 0 THEN
      IF public.income_band_rank(v_cand.annual_income) >= public.income_band_rank(v_prefs.preferred_income) THEN
        s_inc := 1;
        v_reasons := array_append(v_reasons, 'Income matches your preference');
      ELSIF public.income_band_rank(v_cand.annual_income) = public.income_band_rank(v_prefs.preferred_income) - 1 THEN
        s_inc := 0.5;
      ELSE
        s_inc := 0;
      END IF;
    ELSIF public.income_band_rank(v_cand.annual_income) > 0 THEN
      s_inc := 0.8;
    END IF;

    -- ── community (10): preferred sub-communities win; fall back to same sub
    s_com := 0;
    IF coalesce(array_length(v_prefs.preferred_sub_communities, 1), 0) > 0 THEN
      IF EXISTS (SELECT 1 FROM unnest(v_prefs.preferred_sub_communities) c
                 WHERE lower(c) = lower(btrim(coalesce(v_cand.sub_community, '')))) THEN
        s_com := 1;
        v_reasons := array_append(v_reasons, 'Same sub-community you prefer');
      END IF;
    ELSIF lower(btrim(coalesce(v_cand.sub_community, ''))) <> ''
          AND lower(v_cand.sub_community) = lower(v_me.sub_community) THEN
      s_com := 1;
      v_reasons := array_append(v_reasons, 'Same sub-community');
    ELSE
      s_com := 0.3;
    END IF;

    -- ── partner preferences (15): diet / marital status wishes
    v_pref_checks := 0; v_checked := 0;
    IF v_prefs.preferred_diet IS NOT NULL THEN
      v_checked := v_checked + 1;
      IF v_cand.diet = v_prefs.preferred_diet THEN
        v_pref_checks := v_pref_checks + 1;
      END IF;
    END IF;
    IF v_prefs.preferred_marital_status IS NOT NULL THEN
      v_checked := v_checked + 1;
      IF v_cand.marital_status = v_prefs.preferred_marital_status THEN
        v_pref_checks := v_pref_checks + 1;
      END IF;
    END IF;
    IF v_checked = 0 THEN
      s_pref := 0.7; -- member set no detailed wishes → neutral-high
    ELSE
      s_pref := v_pref_checks / v_checked;
      IF s_pref = 1 THEN
        v_reasons := array_append(v_reasons, 'Matches your diet & marital preferences');
      END IF;
    END IF;

    -- ── lifestyle (10): smoking + drinking alignment
    s_life := 0;
    IF v_cand.smoking = v_me.smoking THEN s_life := s_life + 0.5; END IF;
    IF v_cand.drinking = v_me.drinking THEN s_life := s_life + 0.5; END IF;
    IF s_life = 1 THEN
      v_reasons := array_append(v_reasons, 'Similar lifestyle');
    END IF;

    -- ── behaviour (5): recently active members answer faster
    SELECT p.last_login_at INTO v_last_login FROM public.profiles p WHERE p.id = v_cand.user_id;
    s_beh := 0;
    IF v_last_login IS NOT NULL AND v_last_login > now() - interval '30 days' THEN
      s_beh := 1;
      v_reasons := array_append(v_reasons, 'Active recently');
    ELSIF v_last_login IS NOT NULL AND v_last_login > now() - interval '90 days' THEN
      s_beh := 0.5;
    END IF;

    v_score := round(
      s_age  * coalesce((v_w ->> 'age')::numeric, 15) +
      s_loc  * coalesce((v_w ->> 'location')::numeric, 15) +
      s_edu  * coalesce((v_w ->> 'education')::numeric, 10) +
      s_occ  * coalesce((v_w ->> 'occupation')::numeric, 10) +
      s_inc  * coalesce((v_w ->> 'income')::numeric, 10) +
      s_com  * coalesce((v_w ->> 'community')::numeric, 10) +
      s_pref * coalesce((v_w ->> 'partner_prefs')::numeric, 15) +
      s_life * coalesce((v_w ->> 'lifestyle')::numeric, 10) +
      s_beh  * coalesce((v_w ->> 'behaviour')::numeric, 5)
    , 1);

    IF v_score < v_threshold THEN
      CONTINUE;                         -- NO padding: below threshold = out
    END IF;

    v_list := v_list || jsonb_build_object(
      'user_id', v_cand.user_id,
      'name', CASE
        WHEN char_length(btrim(v_cand.full_name)) > 1
          THEN left(btrim(v_cand.full_name), 1) || repeat('*', greatest(char_length(btrim(v_cand.full_name)) - 1, 0))
        ELSE 'Member'
      END,
      'name_full', CASE WHEN v_is_paid THEN v_cand.full_name ELSE NULL END,
      'age', CASE WHEN v_is_paid THEN floor(v_cand_age)::int ELSE NULL END,
      'gender', v_cand.gender,
      'height_cm', CASE WHEN v_is_paid THEN v_cand.height_cm ELSE NULL END,
      'sub_community', CASE WHEN v_is_paid THEN v_cand.sub_community ELSE NULL END,
      'marital_status', CASE WHEN v_is_paid THEN v_cand.marital_status ELSE NULL END,
      'education', CASE WHEN v_is_paid THEN v_cand.education ELSE NULL END,
      'occupation', v_cand.occupation,
      'city', CASE WHEN v_is_paid THEN v_cand.city ELSE NULL END,
      'state', CASE WHEN v_is_paid THEN v_cand.state ELSE NULL END,
      'diet', CASE WHEN v_is_paid THEN v_cand.diet ELSE NULL END,
      'photo', v_cand.photo,
      'has_photo', (v_cand.photo IS NOT NULL),
      'verified', (v_cand.verified_at IS NOT NULL),
      'is_boosted', public.has_active_boost(v_cand.user_id),
      'viewer_is_paid', v_is_paid,
      'score', v_score,
      'reasons', to_jsonb(coalesce(v_reasons[1:4], ARRAY[]::text[]))
    );
  END LOOP;

  -- Deterministic daily shuffle inside equal scores: seed = user + date.
  -- Step 9 fixes the Daily 5 selection defect: rank the candidate ROWS
  -- (score DESC -> boost DESC -> deterministic daily tie-break), keep only
  -- the configured v_count of them, THEN aggregate. The old code put
  -- `LIMIT v_count` on the outer aggregate query, whose single output row it
  -- can never truncate — so every threshold-passing candidate was returned
  -- regardless of matching_config.daily_count.
  SELECT coalesce(jsonb_agg(item ORDER BY (item ->> 'score')::numeric DESC,
                                          (item ->> 'is_boosted')::boolean DESC,
                                          md5((item ->> 'user_id') || current_date::text) ASC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT item
    FROM jsonb_array_elements(v_list) AS item
    ORDER BY (item ->> 'score')::numeric DESC,
             (item ->> 'is_boosted')::boolean DESC,
             md5((item ->> 'user_id') || current_date::text) ASC
    LIMIT v_count
  ) s;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.get_daily_matches(integer) IS
  'Rule-based Daily 5 (no ML): candidates must be publicly listed, unblocked and score >= the matching_config threshold (default 90%). Ranks the surviving candidates (score DESC, boost DESC, deterministic daily md5 tie-break), keeps only matching_config.daily_count of them — an explicit p_limit may only lower that — THEN aggregates. NO padding: returning fewer than the daily count (or []) is correct.';

REVOKE ALL ON FUNCTION public.get_daily_matches(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_matches(integer) TO authenticated;
