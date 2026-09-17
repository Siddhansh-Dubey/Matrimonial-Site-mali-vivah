-- ============================================================================
-- Mali Vivah · Phase 1 — truthful profile visibility (the headline bug fix)
-- Migration 5 of the Phase 1 completion pass.
--
-- THE BUG THIS FIXES
--   A member finished the wizard, saw their row in the Table Editor and never
--   appeared in Grooms/Brides. Three independent causes, all confirmed against
--   a live database:
--     1. `status` only became 'active' when the member pressed the very last
--        Publish button; every earlier save wrote 'draft'.
--     2. A NULL date_of_birth silently dropped an otherwise-'active' row from
--        search_matches() — no error anywhere.
--     3. NO paid-membership gate existed: a free member who published WAS
--        publicly listed (search_matches returned the profile while
--        has_active_subscription() was false), contradicting the PRD
--        "free ⇒ hidden" rule and making visibility feel random.
--   Compounding it, the dashboard told every publisher "Your profile is now
--   live and visible in Browse & Search" — even free members whose profile
--   the PRD requires to stay hidden.
--
-- WHAT THIS MIGRATION DOES
--   §1 has_live_membership(uuid)  — TIME-AWARE paid check. An expired
--      subscription stops counting immediately; it does not wait for any
--      sweep job. Never reads matrimony_profiles (safe under RLS, see note).
--   §2 is_profile_public(uuid)    — the ONE publicity rule: status 'active'
--      + gender + date of birth + account active + profile photo + family
--      photo + live membership.
--   §3 profile_visibility_reason(uuid) — why a profile is (not) visible:
--      { status, is_public, reason, missing[], headline, detail, cta } so the
--      dashboard can explain the truth instead of the old "now live" message.
--   §4 search_matches() / get_public_profile() rewritten to gate on
--      is_profile_public() — consistent across /grooms, /brides, /search and
--      the public profile page. The creator's own legitimately-public profile
--      still appears in their gender section.
--   §5 enforce_publishable_profile() v2 — publishing still requires the full
--      field+photo checklist, but a COMPLETE profile published by a FREE
--      member becomes 'hidden' (APPROVED_FREE) instead of 'active'. Payment
--      activation later flips it to 'active'.
--   §6 sweep_expired_memberships() + sweep_my_membership() — membership →
--      EXPIRED, visibility → HIDDEN (status → 'expired'), member notified,
--      "Renew Membership" CTA. Time-aware gates stay correct even before the
--      sweep runs.
--   §7 Repair existing 'active' rows to a truthful status: never-subscribed
--      → 'hidden'; subscription lapsed → 'expired'.
--
-- ⚠ RLS SAFETY NOTES (learned the hard way — do not regress)
--   * An RLS policy on matrimony_profiles must NOT call a SECURITY DEFINER
--     function that itself reads matrimony_profiles (recursion risk).
--     is_profile_public()/is only called from SECURITY DEFINER RPCs and from
--     the publish trigger — never from a policy on matrimony_profiles.
--   * Subqueries inside a policy are subject to the OTHER table's RLS, so
--     `EXISTS (SELECT … FROM subscriptions …)` for another user silently
--     returns false. has_live_membership() therefore reads subscriptions
--     INSIDE a SECURITY DEFINER function (bypasses RLS) and never touches
--     matrimony_profiles.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: every statement is idempotent.
-- DEPENDS ON migrations 20260915000000/010000/020000/030000 (run them first).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 has_live_membership(uuid) — time-aware paid check
--    Mirrors has_active_subscription() (kept, now a thin wrapper) but is the
--    canonical name going forward. SECURITY DEFINER so it can read
--    subscriptions under any caller's RLS; touches ONLY subscriptions.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_live_membership(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status = 'active'
      AND s.expires_at > now()
  );
$$;

COMMENT ON FUNCTION public.has_live_membership(uuid) IS
  'TRUE when the member holds any active, unexpired subscription. Time-aware: an expired plan returns FALSE immediately, before any sweep job runs. Reads ONLY subscriptions (safe for RLS call sites).';

REVOKE ALL ON FUNCTION public.has_live_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_live_membership(uuid) TO anon, authenticated, service_role;

-- Backwards-compatible wrapper (existing app code calls this).
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
  RETURN public.has_live_membership(v_user);
END;
$$;

COMMENT ON FUNCTION public.has_active_subscription(uuid) IS
  'TRUE when the given user (default: caller) holds any active, unexpired subscription. Wrapper over has_live_membership().';

REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- §2 is_profile_public(uuid) — the single publicity rule
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_profile_public(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matrimony_profiles mp
    JOIN public.profiles p ON p.id = mp.user_id
    WHERE mp.user_id = p_user_id
      AND mp.status = 'active'
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND p.is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM public.profile_photos ph
        WHERE ph.profile_id = mp.user_id AND ph.kind = 'profile_photo'
      )
      AND EXISTS (
        SELECT 1 FROM public.profile_photos ph
        WHERE ph.profile_id = mp.user_id AND ph.kind = 'family_photo'
      )
      AND public.has_live_membership(mp.user_id)
  );
$$;

COMMENT ON FUNCTION public.is_profile_public(uuid) IS
  'The ONE publicity rule: status=active + gender + date of birth + active account + profile photo + family photo + live (unexpired) membership. Used by search_matches(), get_public_profile(), recommendations and Daily 5 so every surface agrees. Never called from RLS policies on matrimony_profiles.';

REVOKE ALL ON FUNCTION public.is_profile_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_profile_public(uuid) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §3 profile_visibility_reason(uuid) — render-ready explanation for the UI
--    Callers: the member's own dashboard (authenticated) and the service
--    role. An authenticated caller can only ever inspect their OWN row —
--    passing someone else's id is ignored (auth.uid() wins).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profile_visibility_reason(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A signed-in member may only ever inspect their own row.
  v_user       UUID := coalesce(auth.uid(), p_user_id);
  v_mp         public.matrimony_profiles%ROWTYPE;
  v_is_active  BOOLEAN := FALSE;
  v_account    BOOLEAN := FALSE;
  v_missing    TEXT[]  := ARRAY[]::TEXT[];
  v_public     BOOLEAN := FALSE;
  v_paid       BOOLEAN := FALSE;
  v_ever_sub   BOOLEAN := FALSE;
  v_expires    TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'status', NULL, 'is_public', FALSE, 'reason', 'not_signed_in',
      'missing', '[]'::jsonb,
      'headline', 'Sign in to manage your profile',
      'detail', 'You need an account to create a matrimony profile.',
      'cta', jsonb_build_object('label', 'Log in / Register', 'href', '/login')
    );
  END IF;

  SELECT (p.is_active) INTO v_account FROM public.profiles p WHERE p.id = v_user;
  v_account := coalesce(v_account, FALSE);

  SELECT mp.* INTO v_mp
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = v_user;

  v_paid := public.has_live_membership(v_user);
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s WHERE s.user_id = v_user
  ) INTO v_ever_sub;
  SELECT max(s.expires_at) INTO v_expires
  FROM public.subscriptions s WHERE s.user_id = v_user;

  -- Completeness checklist (identical to the publish gate).
  IF v_mp.user_id IS NULL THEN
    v_missing := array_append(v_missing, 'profile');
  ELSE
    IF v_mp.gender IS NULL THEN v_missing := array_append(v_missing, 'gender'); END IF;
    IF v_mp.date_of_birth IS NULL THEN v_missing := array_append(v_missing, 'date of birth'); END IF;
    IF nullif(btrim(coalesce(v_mp.city, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'city'); END IF;
    IF nullif(btrim(coalesce(v_mp.education, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'education'); END IF;
    IF nullif(btrim(coalesce(v_mp.occupation, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'occupation'); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = v_user AND ph.kind = 'profile_photo') THEN
    v_missing := array_append(v_missing, 'profile photo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = v_user AND ph.kind = 'family_photo') THEN
    v_missing := array_append(v_missing, 'family photo');
  END IF;

  v_public := public.is_profile_public(v_user);

  -- 1. Account-level gates first.
  IF NOT v_account THEN
    RETURN jsonb_build_object(
      'status', coalesce(v_mp.status::text, 'draft'), 'is_public', FALSE,
      'reason', 'account_inactive', 'missing', to_jsonb(v_missing),
      'headline', 'Your account is deactivated',
      'detail', 'Your profile is hidden because this account has been deactivated. Contact support to reactivate it.',
      'cta', jsonb_build_object('label', 'Contact support', 'href', '/contact')
    );
  END IF;

  -- 2. Admin-managed statuses.
  IF v_mp.status = 'pending_review' THEN
    RETURN jsonb_build_object(
      'status', 'pending_review', 'is_public', FALSE, 'reason', 'pending_review',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile is under review',
      'detail', 'Our team is checking your details. You will be notified as soon as it is approved.',
      'cta', NULL
    );
  END IF;
  IF v_mp.status = 'suspended' THEN
    RETURN jsonb_build_object(
      'status', 'suspended', 'is_public', FALSE, 'reason', 'suspended',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile has been suspended',
      'detail', 'A moderator suspended this profile. Reach out to support if you believe this is a mistake.',
      'cta', jsonb_build_object('label', 'Contact support', 'href', '/contact')
    );
  END IF;
  IF v_mp.status = 'rejected' THEN
    RETURN jsonb_build_object(
      'status', 'rejected', 'is_public', FALSE, 'reason', 'rejected',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile was not approved',
      'detail', 'Please review your details and photos, correct them and publish again.',
      'cta', jsonb_build_object('label', 'Edit profile', 'href', '/profile/edit')
    );
  END IF;

  -- 3. Completeness.
  IF v_mp.user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'draft', 'is_public', FALSE, 'reason', 'profile_incomplete',
      'missing', to_jsonb(v_missing),
      'headline', 'Create your matrimony profile',
      'detail', 'Tell families about yourself — education, occupation, photos and what you are looking for.',
      'cta', jsonb_build_object('label', 'Create profile', 'href', '/profile/edit')
    );
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RETURN jsonb_build_object(
      'status', v_mp.status::text, 'is_public', FALSE, 'reason', 'profile_incomplete',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile is incomplete',
      'detail', format('Add the missing %s — your profile stays private until it is complete.',
                       CASE WHEN array_length(v_missing, 1) = 1 THEN 'item below' ELSE 'items below' END),
      'cta', jsonb_build_object('label', 'Complete profile', 'href', '/profile/edit')
    );
  END IF;

  -- 4. Complete but never published.
  IF v_mp.status = 'draft' THEN
    RETURN jsonb_build_object(
      'status', 'draft', 'is_public', FALSE, 'reason', 'not_published',
      'missing', '[]'::jsonb,
      'headline', 'Your profile is ready to publish',
      'detail', 'Press “Publish profile” in the profile wizard. Free profiles stay private until you become a paid member.',
      'cta', jsonb_build_object('label', 'Publish profile', 'href', '/profile/edit')
    );
  END IF;

  -- 5. Membership gates (PRD: free ⇒ hidden; expired ⇒ hidden + renew CTA).
  IF NOT v_paid THEN
    IF v_ever_sub THEN
      RETURN jsonb_build_object(
        'status', coalesce(v_mp.status::text, 'expired'), 'is_public', FALSE,
        'reason', 'membership_expired', 'missing', '[]'::jsonb,
        'expired_at', v_expires,
        'headline', 'Your membership has expired',
        'detail', 'Your profile is hidden and you can no longer express interest. Renew your membership to come back.',
        'cta', jsonb_build_object('label', 'Renew Membership', 'href', '/packages')
      );
    END IF;
    RETURN jsonb_build_object(
      'status', coalesce(v_mp.status::text, 'hidden'), 'is_public', FALSE,
      'reason', 'membership_required', 'missing', '[]'::jsonb,
      'headline', 'Your profile is complete — one step left',
      -- Locked PRD copy — do not reword.
      'detail', 'Become a Paid Member to showcase your profile and express interest.',
      'cta', jsonb_build_object('label', 'View membership packages', 'href', '/packages')
    );
  END IF;

  -- 6. Paid + complete.
  RETURN jsonb_build_object(
    'status', v_mp.status::text, 'is_public', v_public,
    'reason', CASE WHEN v_public THEN 'public' ELSE 'activating' END,
    'missing', '[]'::jsonb,
    'headline', CASE WHEN v_public
      THEN 'Your profile is live'
      ELSE 'Your membership is active' END,
    'detail', CASE WHEN v_public
      THEN 'Families can find you in Browse & Search and express interest.'
      ELSE 'Publish your profile to appear in Browse & Search.' END,
    'cta', CASE WHEN v_public THEN NULL
      ELSE jsonb_build_object('label', 'Publish profile', 'href', '/profile/edit') END
  );
END;
$$;

COMMENT ON FUNCTION public.profile_visibility_reason(uuid) IS
  'Render-ready explanation of why the caller''s profile is or is not publicly visible: { status, is_public, reason, missing[], headline, detail, cta{label,href}, expired_at? }. Authenticated callers can only inspect their OWN row (auth.uid() wins over the argument); the service role may inspect anyone. The membership_required detail is locked PRD copy.';

REVOKE ALL ON FUNCTION public.profile_visibility_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_visibility_reason(uuid) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §4 search_matches() / get_public_profile() — gate on is_profile_public()
--    Same signatures and response keys as before (additive only); the WHERE
--    clause is the fix: paid + complete + published profiles ONLY.
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
  v_limit INTEGER := CASE
    WHEN auth.uid() IS NULL THEN least(greatest(coalesce(p_limit, 5), 1), 5)
    ELSE least(greatest(coalesce(p_limit, 60), 1), 200)
  END;
  v_is_paid BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
BEGIN
  -- No authentication check by design: the result is deliberately
  -- contact-free and v_limit caps the anonymous preview at five cards.
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
        'viewer_is_paid', v_is_paid
      ) AS card,
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
    WHERE public.is_profile_public(mp.user_id)     -- ← THE FIX
      -- Not excluding auth.uid(): the creator sees their own legitimately
      -- public profile in their gender section, like everyone else.
      AND mp.gender = coalesce(p_looking_for, mp.gender)
      AND (p_min_age IS NULL OR date_part('year', age(mp.date_of_birth)) >= p_min_age)
      AND (p_max_age IS NULL OR date_part('year', age(mp.date_of_birth)) <= p_max_age)
      AND (p_city IS NULL OR lower(mp.city) = lower(btrim(p_city)))
      AND (p_sub_community IS NULL OR lower(mp.sub_community) = lower(btrim(p_sub_community)))
    ORDER BY mp.updated_at DESC
    LIMIT v_limit
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) IS
  'Safe profile browse RPC. Lists ONLY profiles passing is_profile_public() (active + complete + both photos + live membership). Free/anonymous viewers get masked cards; anonymous are capped at five.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) TO anon, authenticated;


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
    'age', CASE WHEN v_is_paid THEN floor(date_part('year', age(mp.date_of_birth)))::int ELSE NULL END,
    'height_cm', CASE WHEN v_is_paid THEN mp.height_cm ELSE NULL END,
    'religion', CASE WHEN v_is_paid THEN mp.religion ELSE NULL END,
    'sub_community', CASE WHEN v_is_paid THEN mp.sub_community ELSE NULL END,
    'mother_tongue', CASE WHEN v_is_paid THEN mp.mother_tongue ELSE NULL END,
    'marital_status', CASE WHEN v_is_paid THEN mp.marital_status ELSE NULL END,
    'education', CASE WHEN v_is_paid THEN mp.education ELSE NULL END,
    'education_details', CASE WHEN v_is_paid THEN mp.education_details ELSE NULL END,
    'occupation', mp.occupation,
    'annual_income', CASE WHEN v_is_paid THEN mp.annual_income ELSE NULL END,
    'city', CASE WHEN v_is_paid THEN mp.city ELSE NULL END,
    'state', CASE WHEN v_is_paid THEN mp.state ELSE NULL END,
    'country', CASE WHEN v_is_paid THEN mp.country ELSE NULL END,
    'diet', CASE WHEN v_is_paid THEN mp.diet ELSE NULL END,
    'gotra', CASE WHEN v_is_paid THEN mp.gotra ELSE NULL END,
    'about_me', CASE WHEN v_is_paid THEN mp.about_me ELSE NULL END,
    'hobbies', CASE WHEN v_is_paid THEN mp.hobbies ELSE '{}'::text[] END,
    'photos', COALESCE(
      (SELECT jsonb_agg(ph.storage_path ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC)
       FROM public.profile_photos ph
       WHERE ph.profile_id = mp.user_id AND ph.kind = 'profile_photo'),
      '[]'::jsonb
    ),
    'family_photo', (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id AND ph.kind = 'family_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ),
    'viewer_is_paid', v_is_paid,
    'mutual_interest', v_mutual,
    'contact_phone', CASE WHEN (v_is_paid AND v_mutual) THEN p.mobile ELSE NULL END
  )
  INTO v_result
  FROM public.matrimony_profiles mp
  JOIN public.profiles p ON p.id = mp.user_id
  WHERE mp.user_id = p_user_id
    AND public.is_profile_public(p_user_id);       -- ← THE FIX

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Safe public profile preview — only for profiles passing is_profile_public(). Contact phone returned only for a paid member with mutual interest. family_photo is included so the detail page can render the Family section.';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §5 enforce_publishable_profile() v2
--    Publishing still requires the full checklist, but a complete profile
--    published by a FREE member now truthfully becomes 'hidden'
--    (APPROVED_FREE) instead of 'active'. Payment activation flips it back.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_publishable_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Only guard the transition INTO 'active'.
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

  -- THE HEADLINE-BUG COERCE: a complete profile published by a free member
  -- is approved but NOT public — it waits at 'hidden' until membership starts.
  -- (The trigger only reaches here for the transition INTO 'active'.)
  IF NOT public.has_live_membership(NEW.user_id) THEN
    NEW.status := 'hidden';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_publishable_profile() IS
  'BEFORE INSERT/UPDATE trigger on matrimony_profiles: blocks the transition into status=active unless gender, date of birth, city, education, occupation, a profile photo AND a family photo are all present (raises PROFILE_INCOMPLETE). A complete profile published without a live membership is coerced to hidden (APPROVED_FREE) so its status always tells the truth.';


-- ----------------------------------------------------------------------------
-- §6 Expiry sweeps
--    sweep_expired_memberships() — global, for cron / service role.
--    sweep_my_membership()       — self-only, called lazily by the app so a
--                                  lapsed member sees truthful state without
--                                  waiting for cron.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_expired_memberships()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subs     INTEGER := 0;
  v_profiles INTEGER := 0;
  v_row      RECORD;
BEGIN
  -- 1. membership → EXPIRED (+ tell the member, once per row)
  FOR v_row IN
    UPDATE public.subscriptions s
    SET status = 'expired', updated_at = now()
    WHERE s.status = 'active'
      AND s.expires_at <= now()
    RETURNING s.user_id, s.expires_at
  LOOP
    v_subs := v_subs + 1;
    PERFORM public.push_notification(
      v_row.user_id,
      'package_expiring',
      'Your membership has expired',
      'Your package ended on ' || to_char(v_row.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
        || '. Your profile is now hidden — renew to showcase it again and express interest.',
      jsonb_build_object('expired_at', v_row.expires_at),
      '/packages'
    );
  END LOOP;

  -- 2. visibility → HIDDEN: profiles still 'active' without a live plan whose
  --    membership lapsed become 'expired'. (Profiles of members who never
  --    paid are handled by the publish gate: they sit at 'hidden' already.)
  UPDATE public.matrimony_profiles mp
  SET status = 'expired', updated_at = now()
  WHERE mp.status = 'active'
    AND NOT public.has_live_membership(mp.user_id);
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  RETURN jsonb_build_object(
    'expired_subscriptions', v_subs,
    'expired_profiles', v_profiles
  );
END;
$$;

COMMENT ON FUNCTION public.sweep_expired_memberships() IS
  'Expires lapsed subscriptions and flips their profiles active→expired (visibility hidden, interest locked), notifying each member with a Renew Membership CTA. Idempotent. Run via cron (e.g. every 15 min) — gates are time-aware so they stay correct between runs.';


CREATE OR REPLACE FUNCTION public.sweep_my_membership()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sweep_my_membership: not authenticated';
  END IF;

  UPDATE public.subscriptions s
  SET status = 'expired', updated_at = now()
  WHERE s.user_id = v_user
    AND s.status = 'active'
    AND s.expires_at <= now();

  UPDATE public.matrimony_profiles mp
  SET status = 'expired', updated_at = now()
  WHERE mp.user_id = v_user
    AND mp.status = 'active'
    AND NOT public.has_live_membership(v_user);

  RETURN public.profile_visibility_reason(v_user);
END;
$$;

COMMENT ON FUNCTION public.sweep_my_membership() IS
  'Self-service expiry sweep for the signed-in member (lazy cron): flips their lapsed subscription/profile to expired, then returns profile_visibility_reason(). Called by the dashboard and packages pages so the UI is truthful even before the cron sweep.';

REVOKE ALL ON FUNCTION public.sweep_expired_memberships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_memberships() TO service_role;

REVOKE ALL ON FUNCTION public.sweep_my_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_my_membership() TO authenticated;


-- ----------------------------------------------------------------------------
-- §7 Repair legacy 'active' rows to a truthful status
--    (time-aware has_live_membership already hides them from browse; this
--    makes the stored status tell the truth too.)
-- ----------------------------------------------------------------------------
UPDATE public.matrimony_profiles mp
SET status = 'expired', updated_at = now()
WHERE mp.status = 'active'
  AND NOT public.has_live_membership(mp.user_id)
  AND EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = mp.user_id);

UPDATE public.matrimony_profiles mp
SET status = 'hidden', updated_at = now()
WHERE mp.status = 'active'
  AND NOT public.has_live_membership(mp.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = mp.user_id);
