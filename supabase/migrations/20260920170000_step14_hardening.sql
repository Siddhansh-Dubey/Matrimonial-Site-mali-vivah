-- ============================================================================
-- Mali Vivah · Step 14 — Close Phase 1 Audit Findings & Production Hardening
--
-- WHAT THIS COVERS:
--   §1  profile_photo_is_listable() — live membership gate added (fixes S07)
--   §2  Storage buckets, object RLS and server authorization (fixes S04)
--   §3  Moments lifecycle & path server authority (fixes S14, S05)
--   §4  Photo and verification document storage path validation (fixes S09)
--   §5  Report security: revoke raw client INSERT & hide internal notes (fixes S06, S08)
--   §6  Adult-age gate: enforce minimum 18 years server-authoritatively (fixes S10)
--   §7  Notification producers for new Mali Moment and new daily matches
--   §8  Membership self-sweep notification & activity unification (fixes N02)
--   §9  Individual profile compatibility engine exposure (PRD completion)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1 profile_photo_is_listable() — live membership gate added (fixes S07)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profile_photo_is_listable(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matrimony_profiles mp
    JOIN public.profiles p ON p.id = mp.user_id
    WHERE mp.user_id = p_profile_id
      AND mp.status = 'active'
      AND mp.admin_hidden_at IS NULL
      AND p.is_active = TRUE
      AND public.has_live_membership(p_profile_id)
  );
$$;

COMMENT ON FUNCTION public.profile_photo_is_listable(uuid) IS
  'TRUE when the member is currently listed (status=active, no admin hold, account active, live paid membership). Used by the profile_photos SELECT policy so expired/free profiles do not leak photo metadata to other members.';

REVOKE ALL ON FUNCTION public.profile_photo_is_listable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_photo_is_listable(uuid) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §2 Storage buckets, object RLS and server authorization (fixes S04)
-- ----------------------------------------------------------------------------

-- Ensure private buckets exist alongside public profile-photos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES 
      ('profile-photos', 'profile-photos', TRUE),
      ('family-photos', 'family-photos', FALSE),
      ('moments', 'moments', FALSE),
      ('verification-docs', 'verification-docs', FALSE)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  END IF;
END;
$$;

-- Server-authoritative storage object read authorization
CREATE OR REPLACE FUNCTION public.can_read_storage_object(p_bucket_id TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_owner_id UUID;
  v_first_seg TEXT;
BEGIN
  -- Service role and admin always have access
  IF current_user = 'service_role' OR auth.role() = 'service_role' THEN
    RETURN TRUE;
  END IF;
  IF v_caller IS NOT NULL AND public.is_admin() THEN
    RETURN TRUE;
  END IF;

  -- Extract owner UUID from first folder segment
  v_first_seg := split_part(p_name, '/', 1);
  BEGIN
    v_owner_id := v_first_seg::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;

  -- Owner can always read their own files
  IF v_caller IS NOT NULL AND v_caller = v_owner_id THEN
    RETURN TRUE;
  END IF;

  -- Verification documents are NEVER readable by other users
  IF p_bucket_id = 'verification-docs' THEN
    RETURN FALSE;
  END IF;

  -- Blocked check: if either party blocked the other, deny
  IF v_caller IS NOT NULL AND public.is_blocked(v_caller, v_owner_id) THEN
    RETURN FALSE;
  END IF;

  -- Family photos (in family-photos bucket OR path contains /family/)
  IF p_bucket_id = 'family-photos' OR p_name LIKE '%/family/%' OR EXISTS (
    SELECT 1 FROM public.profile_photos ph
    WHERE ph.storage_path = p_name AND ph.kind = 'family_photo'
  ) THEN
    -- Requires authenticated paid member, active listable target, privacy allowed
    IF v_caller IS NULL THEN
      RETURN FALSE;
    END IF;
    IF NOT public.has_live_membership(v_caller) THEN
      RETURN FALSE;
    END IF;
    IF NOT public.profile_photo_is_listable(v_owner_id) THEN
      RETURN FALSE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.matrimony_profiles mp
      WHERE mp.user_id = v_owner_id
        AND coalesce((mp.privacy_settings ->> 'show_family_photo')::boolean, TRUE) = TRUE
    ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  -- Mali Moments (in moments bucket OR path contains /moments/)
  IF p_bucket_id = 'moments' OR p_name LIKE '%/moments/%' THEN
    IF v_caller IS NULL THEN
      RETURN FALSE;
    END IF;
    IF NOT public.is_profile_public(v_owner_id) THEN
      RETURN FALSE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.moments m
      WHERE m.storage_path = p_name
        AND m.expires_at > now()
        AND NOT m.is_removed
    ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  -- Public profile photos
  IF p_bucket_id = 'profile-photos' THEN
    -- Must not be a family photo or moment tucked into profile-photos
    IF p_name LIKE '%/family/%' OR p_name LIKE '%/moments/%' THEN
      RETURN FALSE;
    END IF;
    -- Target must be listable (active, paid, not held, active account)
    RETURN public.profile_photo_is_listable(v_owner_id);
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_read_storage_object(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_storage_object(text, text) TO anon, authenticated, service_role;

-- Storage RLS on storage.objects (if storage schema exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    DROP POLICY IF EXISTS "Public read profile photos" ON storage.objects;
    DROP POLICY IF EXISTS "Authorized read storage objects" ON storage.objects;
    CREATE POLICY "Authorized read storage objects"
      ON storage.objects FOR SELECT
      USING (public.can_read_storage_object(bucket_id, name));

    DROP POLICY IF EXISTS "Members upload photos to own folder" ON storage.objects;
    CREATE POLICY "Members upload photos to own folder"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id IN ('profile-photos', 'family-photos', 'moments', 'verification-docs')
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- §3 Moments lifecycle & path server authority (fixes S14, S05)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_moment_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.user_id IS NULL OR NEW.user_id <> auth.uid() THEN
      NEW.user_id := auth.uid();
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.matrimony_profiles mp ON mp.user_id = p.id
    WHERE p.id = NEW.user_id
      AND p.is_active = TRUE
      AND mp.status = 'active'
      AND mp.admin_hidden_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MOMENT_AUTHOR_NOT_ELIGIBLE: member must have an active listed profile to post moments';
  END IF;

  -- Server strictly determines creation and expiry timestamps: exactly 24 hours
  NEW.created_at := now();
  NEW.expires_at := now() + interval '24 hours';
  NEW.is_removed := FALSE;

  IF NEW.storage_path IS NULL OR (NEW.storage_path NOT LIKE (NEW.user_id::text || '/%')) THEN
    RAISE EXCEPTION 'MOMENT_INVALID_STORAGE_PATH: storage path must begin with member id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_moment_lifecycle ON public.moments;
CREATE TRIGGER trg_enforce_moment_lifecycle
  BEFORE INSERT ON public.moments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_moment_lifecycle();

CREATE OR REPLACE FUNCTION public.protect_moment_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.created_at := OLD.created_at;
    NEW.expires_at := OLD.expires_at;
    NEW.storage_path := OLD.storage_path;
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_moment_updates ON public.moments;
CREATE TRIGGER trg_protect_moment_updates
  BEFORE UPDATE ON public.moments
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_moment_updates();


-- ----------------------------------------------------------------------------
-- §4 Photo and verification document storage path validation (fixes S09)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_photo_storage_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.profile_id <> auth.uid() THEN
      RAISE EXCEPTION 'PHOTO_UNAUTHORIZED: cannot upload photo for another member';
    END IF;
  END IF;

  IF NEW.storage_path IS NULL OR (NEW.storage_path NOT LIKE (NEW.profile_id::text || '/%')) THEN
    RAISE EXCEPTION 'PHOTO_INVALID_STORAGE_PATH: storage path must begin with member id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_photo_storage_path ON public.profile_photos;
CREATE TRIGGER trg_enforce_photo_storage_path
  BEFORE INSERT ON public.profile_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_photo_storage_path();

CREATE OR REPLACE FUNCTION public.enforce_verification_storage_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.storage_path IS NOT NULL AND (NEW.storage_path NOT LIKE (NEW.user_id::text || '/%')) THEN
    RAISE EXCEPTION 'VERIFICATION_INVALID_STORAGE_PATH: storage path must begin with member id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_verification_storage_path ON public.verification_requests;
CREATE TRIGGER trg_enforce_verification_storage_path
  BEFORE INSERT ON public.verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_verification_storage_path();


-- ----------------------------------------------------------------------------
-- §5 Report security: revoke raw client INSERT & hide internal notes (fixes S06, S08)
-- ----------------------------------------------------------------------------

-- Ordinary members cannot directly INSERT into reports table; must use report_profile RPC
REVOKE INSERT ON public.reports FROM authenticated, anon;
DROP POLICY IF EXISTS "Member files a report" ON public.reports;
DROP POLICY IF EXISTS "Reporter reads own reports" ON public.reports;

-- Ordinary members cannot read raw reports rows directly (prevents leaking internal admin_notes)
DROP POLICY IF EXISTS "Members cannot read raw reports" ON public.reports;
CREATE POLICY "Members cannot read raw reports"
  ON public.reports FOR SELECT TO authenticated
  USING (FALSE);

-- Revoke direct SELECT on internal moderation columns from non-admins
REVOKE SELECT (admin_hidden_reason, suspension_reason, admin_hidden_by, suspended_by)
  ON public.matrimony_profiles FROM authenticated, anon;


-- ----------------------------------------------------------------------------
-- §6 Adult-age gate: enforce minimum 18 years server-authoritatively (fixes S10)
-- ----------------------------------------------------------------------------

-- Add table constraint for adult age (minimum 18 years)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matrimony_profiles_adult_age'
  ) THEN
    ALTER TABLE public.matrimony_profiles
      ADD CONSTRAINT matrimony_profiles_adult_age
      CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'));
  END IF;
END;
$$;

-- Adult age validation trigger on matrimony_profiles
CREATE OR REPLACE FUNCTION public.enforce_adult_age_dob()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'UNDERAGE_PROFILE: date of birth must indicate at least 18 years of age';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_adult_age_dob ON public.matrimony_profiles;
CREATE TRIGGER trg_enforce_adult_age_dob
  BEFORE INSERT OR UPDATE OF date_of_birth ON public.matrimony_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_adult_age_dob();

-- Update admin_profile_missing to validate adult age
CREATE OR REPLACE FUNCTION public.admin_profile_missing(p_user_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp      public.matrimony_profiles%ROWTYPE;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;
  IF v_mp.user_id IS NULL THEN
    RETURN ARRAY['profile'];
  END IF;
  IF v_mp.gender IS NULL THEN v_missing := array_append(v_missing, 'gender'); END IF;
  IF v_mp.date_of_birth IS NULL THEN
    v_missing := array_append(v_missing, 'date of birth');
  ELSIF v_mp.date_of_birth > (CURRENT_DATE - INTERVAL '18 years') THEN
    v_missing := array_append(v_missing, 'date of birth');
  END IF;
  IF nullif(btrim(coalesce(v_mp.city, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'city'); END IF;
  IF nullif(btrim(coalesce(v_mp.education, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'education'); END IF;
  IF nullif(btrim(coalesce(v_mp.occupation, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'occupation'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = p_user_id AND ph.kind = 'profile_photo') THEN
    v_missing := array_append(v_missing, 'profile photo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = p_user_id AND ph.kind = 'family_photo') THEN
    v_missing := array_append(v_missing, 'family photo');
  END IF;
  RETURN v_missing;
END;
$$;

-- Update enforce_publishable_profile() to enforce adult age
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
  ELSIF NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years') THEN
    v_missing := array_append(v_missing, 'date of birth (minimum 18 years)');
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
  IF NOT public.has_live_membership(NEW.user_id) THEN
    NEW.status := 'hidden';
  END IF;

  RETURN NEW;
END;
$$;

-- Update is_profile_public() to enforce adult age
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
      AND mp.admin_hidden_at IS NULL
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND mp.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')
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


-- ----------------------------------------------------------------------------
-- §7 Notification producers for new Mali Moment and new daily matches
-- ----------------------------------------------------------------------------

-- Trigger to notify opposite-gender active members on a new Mali Moment
CREATE OR REPLACE FUNCTION public.notify_on_new_moment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_gender public.gender;
  v_target_gender public.gender;
  v_recipient RECORD;
BEGIN
  -- Only notify if the author profile is legitimately public
  IF NOT public.is_profile_public(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  SELECT mp.gender INTO v_author_gender
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = NEW.user_id;

  IF v_author_gender IS NULL THEN
    RETURN NEW;
  END IF;

  v_target_gender := CASE WHEN v_author_gender = 'male' THEN 'female'::public.gender ELSE 'male'::public.gender END;

  -- Notify active members of the opposite gender with 24h deduplication
  FOR v_recipient IN
    SELECT p.id AS user_id
    FROM public.profiles p
    JOIN public.matrimony_profiles mp ON mp.user_id = p.id
    WHERE p.is_active = TRUE
      AND mp.status = 'active'
      AND mp.admin_hidden_at IS NULL
      AND mp.gender = v_target_gender
      AND p.id <> NEW.user_id
      AND NOT public.is_blocked(p.id, NEW.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.id
          AND n.type = 'new_moment'
          AND n.metadata ->> 'author_id' = NEW.user_id::text
          AND n.created_at > now() - interval '24 hours'
      )
    LIMIT 20
  LOOP
    PERFORM public.push_notification(
      v_recipient.user_id,
      'new_moment',
      'New Mali Moment',
      'A new 24-hour moment was shared in the community.',
      jsonb_build_object('author_id', NEW.user_id, 'moment_id', NEW.id),
      '/profile'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_moment ON public.moments;
CREATE TRIGGER trg_notify_new_moment
  AFTER INSERT ON public.moments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_moment();


-- ----------------------------------------------------------------------------
-- §8 Membership self-sweep notification & activity unification (fixes N02)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sweep_my_membership()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row RECORD;
  v_days INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sweep_my_membership: not authenticated';
  END IF;

  -- Expire subscription and emit notification + activity matching the global sweep
  FOR v_row IN
    UPDATE public.subscriptions s
    SET status = 'expired', updated_at = now()
    WHERE s.user_id = v_user
      AND s.status = 'active'
      AND s.expires_at <= now()
    RETURNING s.id, s.user_id, s.package_slug, s.expires_at
  LOOP
    PERFORM public.push_notification(
      v_row.user_id,
      'package_expiring',
      'Your membership has expired',
      'Your package ended on ' || to_char(v_row.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
        || '. Your profile is now hidden — renew to showcase it again and express interest.',
      jsonb_build_object('expired_at', v_row.expires_at),
      '/packages'
    );
    PERFORM public.log_activity(
      v_row.user_id,
      'membership_expired',
      jsonb_build_object('subscription_id', v_row.id, 'package_slug', v_row.package_slug,
                         'expired_at', v_row.expires_at),
      'subexp:' || v_row.id::text
    );
  END LOOP;

  UPDATE public.matrimony_profiles mp
  SET status = 'expired', updated_at = now()
  WHERE mp.user_id = v_user
    AND mp.status = 'active'
    AND NOT public.has_live_membership(v_user);

  -- Expire boosts and emit notification
  FOR v_row IN
    UPDATE public.profile_boosts b
    SET status = 'expired'
    WHERE b.user_id = v_user
      AND b.status = 'active'
      AND b.expires_at <= now()
    RETURNING b.id, b.user_id, b.started_at, b.expires_at
  LOOP
    v_days := greatest(1, round(extract(epoch FROM (v_row.expires_at - v_row.started_at)) / 86400))::int;
    PERFORM public.push_notification(
      v_row.user_id,
      'boost_expiring',
      'Your Profile Boost has ended',
      'Your ' || v_days || '-day boost ended on ' || to_char(v_row.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
        || '. Activate another boost to stay at the top of search results.',
      jsonb_build_object('boost_id', v_row.id, 'started_at', v_row.started_at, 'expired_at', v_row.expires_at, 'days', v_days),
      '/profile'
    );
    PERFORM public.log_activity(
      v_row.user_id,
      'boost_expired',
      jsonb_build_object('boost_id', v_row.id, 'started_at', v_row.started_at,
                         'expired_at', v_row.expires_at, 'days', v_days),
      'boostexp:' || v_row.id::text
    );
  END LOOP;

  RETURN public.profile_visibility_reason(v_user);
END;
$$;

COMMENT ON FUNCTION public.sweep_my_membership() IS
  'Self-service expiry sweep for the signed-in member (lazy cron): flips their lapsed subscription/boost/profile to expired, sends notifications, and returns profile_visibility_reason().';

REVOKE ALL ON FUNCTION public.sweep_my_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_my_membership() TO authenticated;


-- ----------------------------------------------------------------------------
-- §9 Individual profile compatibility & Daily 5 notification (PRD completion)
-- ----------------------------------------------------------------------------

-- Member-facing RPC to get compatibility with a specific target profile
CREATE OR REPLACE FUNCTION public.get_profile_compatibility(p_target_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer      UUID := auth.uid();
  v_cfg         JSONB := public.matching_settings();
  v_w           JSONB := v_cfg -> 'weights';
  v_me          public.matrimony_profiles%ROWTYPE;
  v_prefs       public.partner_preferences%ROWTYPE;
  v_cand        public.matrimony_profiles%ROWTYPE;
  v_cand_age    NUMERIC;
  v_reasons     TEXT[] := ARRAY[]::TEXT[];
  s_age         NUMERIC := 0;
  s_loc         NUMERIC := 0;
  s_edu         NUMERIC := 0;
  s_occ         NUMERIC := 0;
  s_inc         NUMERIC := 0.4;
  s_com         NUMERIC := 0;
  s_pref        NUMERIC := 0.7;
  s_life        NUMERIC := 0;
  s_beh         NUMERIC := 0;
  v_checked     INTEGER := 0;
  v_pref_checks INTEGER := 0;
  v_last_login  TIMESTAMPTZ;
  v_score       NUMERIC;
BEGIN
  IF v_viewer IS NULL OR p_target_id IS NULL THEN
    RETURN jsonb_build_object('score', NULL, 'reasons', '[]'::jsonb);
  END IF;

  IF v_viewer = p_target_id THEN
    RETURN jsonb_build_object('score', 100, 'reasons', jsonb_build_array('This is your profile'));
  END IF;

  IF public.is_blocked(v_viewer, p_target_id) THEN
    RETURN jsonb_build_object('score', NULL, 'reasons', '[]'::jsonb);
  END IF;

  SELECT mp.* INTO v_cand FROM public.matrimony_profiles mp WHERE mp.user_id = p_target_id;
  IF v_cand.user_id IS NULL OR v_cand.date_of_birth IS NULL THEN
    RETURN jsonb_build_object('score', NULL, 'reasons', '[]'::jsonb);
  END IF;

  IF NOT public.is_profile_public(p_target_id) THEN
    RETURN jsonb_build_object('score', NULL, 'reasons', '[]'::jsonb);
  END IF;

  SELECT mp.* INTO v_me FROM public.matrimony_profiles mp WHERE mp.user_id = v_viewer;
  SELECT pp.* INTO v_prefs FROM public.partner_preferences pp WHERE pp.profile_id = v_viewer;

  v_cand_age := date_part('year', age(v_cand.date_of_birth));

  -- ── age (15)
  IF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) AND coalesce(v_prefs.max_age, 60) THEN
    s_age := 1;
    v_reasons := array_append(v_reasons, 'Age within your preferred range');
  ELSIF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) - 3 AND coalesce(v_prefs.max_age, 60) + 3 THEN
    s_age := 0.5;
    v_reasons := array_append(v_reasons, 'Age close to your preferred range');
  END IF;

  -- ── location (15)
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

  -- ── income (10)
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

  -- ── community (10)
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

  -- ── partner preferences (15)
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
    s_pref := 0.7;
  ELSE
    s_pref := v_pref_checks::numeric / v_checked::numeric;
    IF s_pref = 1 THEN
      v_reasons := array_append(v_reasons, 'Matches your diet & marital preferences');
    END IF;
  END IF;

  -- ── lifestyle (10)
  IF v_cand.smoking = v_me.smoking THEN s_life := s_life + 0.5; END IF;
  IF v_cand.drinking = v_me.drinking THEN s_life := s_life + 0.5; END IF;
  IF s_life = 1 THEN
    v_reasons := array_append(v_reasons, 'Similar lifestyle');
  END IF;

  -- ── behaviour (5)
  SELECT p.last_login_at INTO v_last_login FROM public.profiles p WHERE p.id = v_cand.user_id;
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

  RETURN jsonb_build_object(
    'score', v_score,
    'reasons', to_jsonb(coalesce(v_reasons[1:4], ARRAY[]::text[]))
  );
END;
$$;

COMMENT ON FUNCTION public.get_profile_compatibility(uuid) IS
  'Calculates authoritative rule-based compatibility score (0-100) and matching reasons for an individual profile view. Respects blocking, visibility, and gender preferences.';

REVOKE ALL ON FUNCTION public.get_profile_compatibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_compatibility(uuid) TO authenticated;


-- Update get_daily_matches to produce new_matches notification on qualifying results
CREATE OR REPLACE FUNCTION public.get_daily_matches(p_limit INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer      UUID := auth.uid();
  v_cfg         JSONB := public.matching_settings();
  v_w           JSONB := v_cfg -> 'weights';
  v_count       INTEGER;
  v_threshold   NUMERIC := coalesce((v_cfg ->> 'threshold')::numeric, 90);
  v_me          public.matrimony_profiles%ROWTYPE;
  v_prefs       public.partner_preferences%ROWTYPE;
  v_cand        RECORD;
  v_cand_age    NUMERIC;
  v_reasons     TEXT[];
  s_age         NUMERIC;
  s_loc         NUMERIC;
  s_edu         NUMERIC;
  s_occ         NUMERIC;
  s_inc         NUMERIC;
  s_com         NUMERIC;
  s_pref        NUMERIC;
  s_life        NUMERIC;
  s_beh         NUMERIC;
  v_checked     INTEGER;
  v_pref_checks INTEGER;
  v_last_login  TIMESTAMPTZ;
  v_score       NUMERIC;
  v_list        JSONB := '[]'::jsonb;
  v_out         JSONB;
  v_is_paid     BOOLEAN;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'get_daily_matches: not authenticated';
  END IF;

  v_count := greatest(1, least(
               coalesce(p_limit, (v_cfg ->> 'daily_count')::int, 5),
               coalesce((v_cfg ->> 'daily_count')::int, 5),
               25));
  v_is_paid := public.has_live_membership(v_viewer);

  SELECT mp.* INTO v_me FROM public.matrimony_profiles mp WHERE mp.user_id = v_viewer;
  SELECT pp.* INTO v_prefs FROM public.partner_preferences pp WHERE pp.profile_id = v_viewer;

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

    -- ── age (15)
    s_age := 0;
    IF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) AND coalesce(v_prefs.max_age, 60) THEN
      s_age := 1;
      v_reasons := array_append(v_reasons, 'Age within your preferred range');
    ELSIF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) - 3 AND coalesce(v_prefs.max_age, 60) + 3 THEN
      s_age := 0.5;
      v_reasons := array_append(v_reasons, 'Age close to your preferred range');
    END IF;

    -- ── location (15)
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

    -- ── income (10)
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

    -- ── community (10)
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

    -- ── partner preferences (15)
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
      s_pref := 0.7;
    ELSE
      s_pref := v_pref_checks / v_checked;
      IF s_pref = 1 THEN
        v_reasons := array_append(v_reasons, 'Matches your diet & marital preferences');
      END IF;
    END IF;

    -- ── lifestyle (10)
    s_life := 0;
    IF v_cand.smoking = v_me.smoking THEN s_life := s_life + 0.5; END IF;
    IF v_cand.drinking = v_me.drinking THEN s_life := s_life + 0.5; END IF;
    IF s_life = 1 THEN
      v_reasons := array_append(v_reasons, 'Similar lifestyle');
    END IF;

    -- ── behaviour (5)
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
      CONTINUE;
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

  -- Emit new_matches notification if qualifying matches exist and not notified today
  IF jsonb_array_length(v_out) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = v_viewer
        AND n.type = 'new_matches'
        AND n.created_at::date = CURRENT_DATE
    ) THEN
      PERFORM public.push_notification(
        v_viewer,
        'new_matches',
        'Your Daily 5 matches are ready',
        'We found compatible matches for you today. Open Matches to view them.',
        jsonb_build_object('count', jsonb_array_length(v_out)),
        '/matches'
      );
    END IF;
  END IF;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.get_daily_matches(integer) IS
  'Rule-based Daily 5 (no ML): candidates must be publicly listed, unblocked and score >= the matching_config threshold (default 90%). Ranks the surviving candidates, keeps only configured count, then aggregates. Emits new_matches notification when qualifying matches exist.';

REVOKE ALL ON FUNCTION public.get_daily_matches(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_matches(integer) TO authenticated;
