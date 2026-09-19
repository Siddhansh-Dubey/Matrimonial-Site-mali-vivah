-- ============================================================================
-- Mali Vivah · Step 4 — optional BUSINESS NAME on the profile
--
-- WHAT IT DOES
--   The PRD Education / Career section lists Education, Occupation, Company /
--   Business and Income. The schema had `company` (added in 20260915010000)
--   but no distinct business-name field, so business owners had to misuse the
--   company box. This migration adds them as TWO SEPARATE facts:
--
--     company       — the organisation a member works for (employee).
--     business_name — the business a member owns / runs (business owner).
--
--   §1 matrimony_profiles.business_name TEXT NULL — optional, nullable, no
--      default. Existing rows keep NULL and render exactly as before; nothing
--      is inferred from `company` and no existing value is rewritten.
--   §2 get_public_profile() v6 — purely additive: a 'business_name' key right
--      after 'company', behind the SAME v_is_paid gate as company. Free and
--      blocked viewers still receive NULL for both; nothing about the paid /
--      mutual / privacy / RLS rules changes.
--
-- DELIBERATELY NOT DONE HERE (on purpose)
--   * search_matches() / Daily 5 / matching scores are NOT touched — business
--     name is display data, not a PRD search filter.
--   * The profile-completeness publish gate (enforce_publishable_profile) is
--     NOT extended: business_name is optional and must never block publishing.
--   * No CHECK length constraint: `company` (and every other free-text
--     profile column) is plain TEXT — the 120-char limit lives in the app's
--     zod schema, exactly where the company limit lives. Same style, one
--     source of truth.
--   * Existing biodata authorization (self OR paid + mutual) is untouched —
--     the route selects the profile with '*', so it simply gains the new key.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON migrations up to 20260919080000 (Step 3).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 business_name — optional profile column
-- ----------------------------------------------------------------------------
ALTER TABLE public.matrimony_profiles
  ADD COLUMN IF NOT EXISTS business_name TEXT;

COMMENT ON COLUMN public.matrimony_profiles.business_name IS
  'Name of a business the member owns / runs (PRD Career section). Separate from `company` (the employer); either, both, or neither may be set. Optional everywhere: NULL renders as no field at all.';


-- ----------------------------------------------------------------------------
-- §2 get_public_profile() v6 — additive 'business_name' behind the paid gate
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
    'business_name', CASE WHEN v_is_paid THEN mp.business_name ELSE NULL END,
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
  'Safe public profile for publicly-listed members (v6: adds the optional business_name key next to company). Paid viewers additionally see the family section + lifestyle fields when the member''s privacy_settings allow. business_name follows the exact same paid gate as company — a free or blocked viewer never receives it. Phone AND email only when paid + mutual. whatsapp_allowed adds the member''s WhatsApp opt-in to the same gate. Logs profile_viewed analytics.';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;
