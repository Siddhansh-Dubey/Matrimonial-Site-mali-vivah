-- ============================================================================
-- Mali Vivah · Phase 1 — activity-tracking completeness + search parity
--
-- WHAT IT DOES
--   §1 search_matches() — two changes, same signature:
--        a. the sub-community filter now applies ONLY with the advanced_search
--           plan benefit (PRD: community/sub-community is an ADVANCED filter;
--           basic search is gender + age + location). Free callers sending it
--           get basic results, never an error — the parameter is inert.
--        b. logs a server-authoritative 'search_performed' analytics event
--           (scrubbed metadata: which filters + advanced flag; no contact data).
--   §2 get_public_profile() — same signature, same output, plus:
--        a. logs 'profile_viewed' (viewer → target) for authenticated views of
--           a publicly listed profile (self-views and hidden profiles are
--           impossible here: the RPC returns NULL for both),
--        b. NEW key 'contact_email' — the target's email, present ONLY when
--           the viewer is paid AND interest is mutual (the exact contact
--           unlock rule; payment alone returns NULL).
--   §3 get_profile_contact() — logs 'contact_revealed' when a number is
--      actually returned (the unlock moment for analytics).
--   §4 interests — 'interest_accepted' / 'interest_declined' activity events
--      (the actor is the member who responded). interest_sent / interest_mutual
--      were already logged by express_interest().
--   §5 verification_requests — 'verification_submitted' on new member requests
--      (approvals/rejections are already logged by the decision trigger).
--   §6 success_stories — 'story_submitted' for member submissions.
--
-- DESIGN NOTES
--   * log_activity() is EXECUTE-restricted to service_role, but security
--     definer functions (owner: supabase_admin) may call it internally — the
--     same pattern apply_verification_decision() already uses.
--   * All events land in the single activity_events stream; metadata is
--     scrubbed of contact keys by log_activity() itself.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (CREATE OR REPLACE + idempotent triggers).
-- DEPENDS ON migrations up to 20260915130000 (search_matches v2, etc.).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 search_matches() — advanced sub-community + search analytics
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
  'Safe profile browse RPC: publicly-listed profiles only (is_profile_public), blocked pairs excluded, boosted profiles first. Advanced filters (sub-community/education/occupation/native place/marital/diet/income/height) apply only with the advanced_search plan benefit. Logs search_performed analytics.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §2 get_public_profile() — view analytics + contact_email on mutual
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
    'sub_community', CASE WHEN v_is_paid THEN mp.sub_community ELSE NULL END,
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
    'contact_email', CASE WHEN (v_is_paid AND v_mutual) THEN p.email ELSE NULL END
  )
  INTO v_result
  FROM public.matrimony_profiles mp
  JOIN public.profiles p ON p.id = mp.user_id
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
  'Safe public profile for publicly-listed members. Paid viewers additionally see the family section + lifestyle fields when the member''s privacy_settings allow. Phone AND email only when paid + mutual. Logs profile_viewed analytics.';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §3 get_profile_contact() — log the unlock
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_contact(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer UUID := auth.uid();
  v_mobile TEXT;
BEGIN
  IF v_viewer IS NULL OR p_user_id IS NULL OR v_viewer = p_user_id THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_live_membership(v_viewer) THEN
    RETURN NULL;
  END IF;

  IF NOT public.mutual_interest_exists(v_viewer, p_user_id) THEN
    RETURN NULL;
  END IF;

  SELECT p.mobile INTO v_mobile FROM public.profiles p WHERE p.id = p_user_id;

  IF v_mobile IS NOT NULL THEN
    PERFORM public.log_activity(
      v_viewer,
      'contact_revealed',
      jsonb_build_object('target', p_user_id)
    );
  END IF;

  RETURN v_mobile;
END;
$$;

COMMENT ON FUNCTION public.get_profile_contact(uuid) IS
  'Returns a member mobile only when the caller is paid AND interest is mutual; otherwise NULL. Logs contact_revealed when a number is actually returned.';

REVOKE ALL ON FUNCTION public.get_profile_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_contact(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- §4 Interest accept/decline activity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_interest_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      PERFORM public.log_activity(
        NEW.receiver_id,
        'interest_accepted',
        jsonb_build_object('with', NEW.sender_id)
      );
    ELSIF NEW.status = 'declined' THEN
      PERFORM public.log_activity(
        NEW.receiver_id,
        'interest_declined',
        jsonb_build_object('with', NEW.sender_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_interest_response() IS
  'AFTER UPDATE OF status trigger on interests: logs interest_accepted / interest_declined for the responding member.';

DROP TRIGGER IF EXISTS interests_log_response ON public.interests;
CREATE TRIGGER interests_log_response
  AFTER UPDATE OF status ON public.interests
  FOR EACH ROW
  EXECUTE FUNCTION public.log_interest_response();


-- ----------------------------------------------------------------------------
-- §5 Verification submission activity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_verification_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only genuine member submissions are logged; rows that are inserted
  -- already decided (e.g. the OTP flow's 'verified' mobile row) are not.
  IF NEW.status = 'pending' THEN
    PERFORM public.log_activity(
      NEW.user_id,
      'verification_submitted',
      jsonb_build_object('type', NEW.type::text)
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_verification_submitted() IS
  'AFTER INSERT trigger on verification_requests: logs verification_submitted for pending member submissions (approvals/rejections are logged by the decision trigger).';

DROP TRIGGER IF EXISTS verification_log_submitted ON public.verification_requests;
CREATE TRIGGER verification_log_submitted
  AFTER INSERT ON public.verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.log_verification_submitted();


-- ----------------------------------------------------------------------------
-- §6 Success story submission activity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_story_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.submitted_by IS NOT NULL THEN
    PERFORM public.log_activity(
      NEW.submitted_by,
      'story_submitted',
      jsonb_build_object('story_id', NEW.id, 'rating', NEW.rating)
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_story_submitted() IS
  'AFTER INSERT trigger on success_stories: logs story_submitted for member submissions (admin-created stories are not member activity).';

DROP TRIGGER IF EXISTS success_stories_log_submitted ON public.success_stories;
CREATE TRIGGER success_stories_log_submitted
  AFTER INSERT ON public.success_stories
  FOR EACH ROW
  EXECUTE FUNCTION public.log_story_submitted();
