-- ============================================================================
-- Mali Vivah · Step 11 — Privacy, account deletion and data lifecycle
--
-- WHAT THIS MIGRATION DOES
--   §1  Financial / moderation retention: payments, subscriptions and reports
--       no longer CASCADE-delete when an auth user is removed. user_id (and
--       reporter_id / reported_id) become nullable ON DELETE SET NULL so the
--       ledger and the moderation trail survive without a live account.
--   §2  retire_account_data(p_user_id) — the ONE fail-safe retirement step:
--         * profiles.is_active = FALSE  (is_profile_public() drops immediately)
--         * active matrimony status → hidden
--         * featured / live boosts / live moments taken down
--         * contact PII anonymised
--         * payments / subscriptions / reports detached (SET NULL)
--         * account_deleted activity event (idempotent)
--       Called by delete_my_account() (member) and
--       admin_prepare_member_deletion() (admin) BEFORE auth.users is removed.
--       Nested exception blocks mean a later detach failure cannot roll back
--       the hide — a partial deletion can never remain ACTIVE_PAID /
--       searchable / featured / contactable.
--   §3  delete_my_account() — authenticated, auth.uid() only (no user_id
--       argument, so a client cannot name another member). Idempotent.
--   §4  Privacy enforcement:
--         * members can no longer SELECT another member's matrimony_profiles
--           row (privacy-gated fields lived on that row)
--         * family photos are owner-or-RPC only
--         * update_my_privacy_settings() is the only member write path for
--           the four privacy toggles
--         * get_public_profile / get_profile_contact require the VIEWER's
--           account to be active (a deactivated leftover session cannot
--           keep unlocking contact)
--         * express_interest refuses a deactivated sender
--         * list_moments and the moments SELECT policy require the author
--           to be publicly listed (or the caller to be the owner)
--
-- DELIBERATELY UNCHANGED
--   Package prices, boost duration, Daily 5, matching, community hierarchy,
--   featured ordering, verification/report/block semantics from Step 10,
--   WhatsApp opt-in, interest acceptance model.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260920130000_verification_trust_safety.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.is_profile_public(uuid)') IS NULL
     OR to_regprocedure('public.log_activity(uuid, text, jsonb, text)') IS NULL
     OR to_regprocedure('public.admin_prepare_member_deletion(uuid, uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'privacy_account_lifecycle: prerequisite migrations are not applied',
      HINT    = 'Run every earlier file in supabase/migrations/ first.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 Retention FKs — payments / subscriptions / reports
--    Engineering retention, not a legal hold. Direct DELETE FROM auth.users
--    (the boost-suite path) and the product deletion path both keep the rows.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid IN ('public.payments'::regclass, 'public.subscriptions'::regclass)
      AND pg_get_constraintdef(c.oid) ILIKE '%user_id%REFERENCES%profiles%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.reports'::regclass
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%reporter_id%REFERENCES%profiles%'
        OR pg_get_constraintdef(c.oid) ILIKE '%reported_id%REFERENCES%profiles%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.payments      ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.reports       ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE public.reports       ALTER COLUMN reported_id DROP NOT NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reported_id_fkey
  FOREIGN KEY (reported_id) REFERENCES public.profiles (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payments.user_id IS
  'Payer. NULL after account deletion — the Razorpay / amount row is retained for financial integrity.';
COMMENT ON COLUMN public.subscriptions.user_id IS
  'Subscriber. NULL after account deletion — membership history is retained next to the payment that created it.';
COMMENT ON COLUMN public.reports.reporter_id IS
  'Who filed the report. NULL after that member is deleted; the moderation row is kept.';
COMMENT ON COLUMN public.reports.reported_id IS
  'Who was reported. NULL after that member is deleted; the moderation row is kept.';


-- ----------------------------------------------------------------------------
-- §2 retire_account_data(p_user_id) — hide first, then detach / anonymise
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retire_account_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'already_deleted', TRUE);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('ok', TRUE, 'already_deleted', TRUE);
  END IF;

  -- 1. HIDE. is_profile_public() requires profiles.is_active, so this single
  --    write drops the member from search, Daily 5, featured, public profile,
  --    interest, contact reveal and profile views. Must succeed; not caught.
  UPDATE public.profiles
  SET is_active = FALSE,
      full_name = 'Deleted member',
      email = 'deleted-' || p_user_id::text || '@deleted.invalid',
      mobile = NULL,
      mobile_verified = FALSE,
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.matrimony_profiles
  SET status = CASE WHEN status = 'active' THEN 'hidden'::public.profile_status ELSE status END,
      about_me = NULL,
      family_details = NULL,
      annual_income = NULL,
      family_location = NULL,
      father_occupation = NULL,
      mother_occupation = NULL,
      siblings = NULL,
      company = NULL,
      business_name = NULL,
      education_details = NULL,
      gotra = NULL,
      native_place = NULL,
      hobbies = '{}'::text[],
      whatsapp_opt_in = FALSE,
      updated_at = now()
  WHERE user_id = p_user_id;

  -- 2. Take-down that cannot leave the member discoverable even if later
  --    steps fail. Each block is caught so a missing table / race cannot
  --    roll back the hide.
  BEGIN
    DELETE FROM public.featured_profiles WHERE profile_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.profile_boosts
    SET status = 'cancelled', expires_at = now()
    WHERE user_id = p_user_id AND status = 'active';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.moments
    SET is_removed = TRUE
    WHERE user_id = p_user_id AND NOT is_removed;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.profile_photos WHERE profile_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 3. Detach retained business records (idempotent).
  BEGIN
    UPDATE public.payments SET user_id = NULL WHERE user_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.subscriptions SET user_id = NULL WHERE user_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.reports
    SET reporter_id = CASE WHEN reporter_id = p_user_id THEN NULL ELSE reporter_id END,
        reported_id = CASE WHEN reported_id = p_user_id THEN NULL ELSE reported_id END
    WHERE reporter_id = p_user_id OR reported_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO public.account_deletion_requests (user_id, reason, status, processed_at)
    VALUES (p_user_id, NULL, 'processed', now());
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      UPDATE public.account_deletion_requests
      SET status = 'processed', processed_at = coalesce(processed_at, now())
      WHERE user_id = p_user_id AND status = 'pending';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;

  -- 4. Analytics event. ON DELETE SET NULL keeps the row after auth removal.
  PERFORM public.log_activity(
    p_user_id,
    'account_deleted',
    jsonb_build_object('source', 'retire_account_data'),
    'acctdel:' || p_user_id::text
  );

  RETURN jsonb_build_object('ok', TRUE, 'already_deleted', FALSE);
END;
$$;

COMMENT ON FUNCTION public.retire_account_data(uuid) IS
  'Fail-safe account retirement: hide (is_active=false) FIRST so the profile cannot stay public, then anonymise contact, take down featured/boosts/moments/photos, detach payments/subscriptions/reports (retained), log account_deleted. Idempotent. Called by delete_my_account and admin_prepare_member_deletion. Not a public RPC.';

REVOKE ALL ON FUNCTION public.retire_account_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_account_data(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §3 delete_my_account() — member self-delete. No user_id argument.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'delete_my_account: not authenticated';
  END IF;

  v_result := public.retire_account_data(v_uid);
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.delete_my_account() IS
  'Self-serve account deletion. Authenticated only; always acts on auth.uid() (no user_id argument, so a client cannot name another member). Hides the profile immediately, anonymises contact, detaches retained financial/moderation rows. Idempotent. The server action then wipes storage and removes the auth user.';

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;


-- admin_prepare_member_deletion: retire AFTER the audit snapshot (so the
-- log still has the real name / masked email) and BEFORE the auth user is
-- removed. If deleteUser later fails, the member is already not public.
CREATE OR REPLACE FUNCTION public.admin_prepare_member_deletion(
  p_user_id       UUID,
  p_admin_id      UUID,
  p_confirm_email TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p         public.profiles%ROWTYPE;
  v_reason    TEXT := nullif(btrim(coalesce(p_reason, '')), '');
  v_masked    TEXT;
  v_footprint JSONB;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_SELF_DELETE: you cannot delete your own admin account';
  END IF;

  SELECT p.* INTO v_p FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no member with id %', p_user_id;
  END IF;
  IF v_p.is_admin THEN
    RAISE EXCEPTION 'ADMIN_TARGET_PROTECTED: this account is an administrator — remove its admin rights in the database before deleting it';
  END IF;
  IF lower(btrim(coalesce(p_confirm_email, ''))) <> lower(v_p.email) THEN
    RAISE EXCEPTION 'DELETE_CONFIRMATION_MISMATCH: type the member''s email address exactly to confirm deletion';
  END IF;

  v_masked := left(v_p.email, 1) || '***' || substring(v_p.email FROM position('@' IN v_p.email));

  SELECT jsonb_build_object(
    'subscriptions',         (SELECT count(*) FROM public.subscriptions s WHERE s.user_id = p_user_id),
    'payments',              (SELECT count(*) FROM public.payments x WHERE x.user_id = p_user_id),
    'interests',             (SELECT count(*) FROM public.interests i WHERE i.sender_id = p_user_id OR i.receiver_id = p_user_id),
    'messages',              (SELECT count(*) FROM public.messages m WHERE m.sender_id = p_user_id),
    'conversations',         (SELECT count(*) FROM public.conversation_members cm WHERE cm.user_id = p_user_id),
    'photos',                (SELECT count(*) FROM public.profile_photos ph WHERE ph.profile_id = p_user_id),
    'moments',               (SELECT count(*) FROM public.moments mo WHERE mo.user_id = p_user_id),
    'notifications',         (SELECT count(*) FROM public.notifications n WHERE n.user_id = p_user_id),
    'verification_requests', (SELECT count(*) FROM public.verification_requests v WHERE v.user_id = p_user_id),
    'boosts',                (SELECT count(*) FROM public.profile_boosts b WHERE b.user_id = p_user_id),
    'boost_entitlements',    (SELECT count(*) FROM public.profile_boost_entitlements e WHERE e.user_id = p_user_id),
    'activity_events',       (SELECT count(*) FROM public.activity_events a WHERE a.user_id = p_user_id),
    'reports_filed',         (SELECT count(*) FROM public.reports r WHERE r.reporter_id = p_user_id),
    'reports_received',      (SELECT count(*) FROM public.reports r WHERE r.reported_id = p_user_id),
    'blocks',                (SELECT count(*) FROM public.blocks bl WHERE bl.blocker_id = p_user_id OR bl.blocked_id = p_user_id),
    'featured',              EXISTS (SELECT 1 FROM public.featured_profiles f WHERE f.profile_id = p_user_id)
  ) INTO v_footprint;

  PERFORM public.log_activity(
    p_user_id, 'account_deleted',
    jsonb_build_object('initiated_by', 'admin'),
    'acctdel:' || p_user_id::text
  );
  PERFORM public.log_activity(
    p_user_id, 'admin_member_deleted',
    jsonb_build_object('footprint', v_footprint),
    'admindel:' || p_user_id::text
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_deleted', 'profile', p_user_id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'name', v_p.full_name,
            'email_masked', v_masked,
            'member_since', v_p.created_at,
            'footprint', v_footprint,
            'reason', v_reason)));

  -- Fail-safe hide + detach. If the subsequent auth.admin.deleteUser() fails,
  -- this member is already not public, not featured, not contactable.
  PERFORM public.retire_account_data(p_user_id);

  RETURN jsonb_build_object('ok', TRUE, 'email_masked', v_masked, 'footprint', v_footprint);
END;
$$;


-- ----------------------------------------------------------------------------
-- §4 Privacy enforcement
-- ----------------------------------------------------------------------------

-- Other members must not SELECT the full matrimony_profiles row (about_me,
-- annual_income, family_details, privacy_settings…). Public data goes through
-- get_public_profile / search_matches / Daily 5 / featured, which honour the
-- privacy toggles. Owner-only SELECT remains.
DROP POLICY IF EXISTS "Members read active matrimony profiles" ON public.matrimony_profiles;

-- Family photos are owner-or-RPC. Profile photos of a currently-active,
-- un-held, unblocked profile stay readable (the public-read storage bucket
-- for ACTIVE_PAID profile photos is intentional and unchanged).
--
-- The listing check is SECURITY DEFINER so it does not depend on the
-- caller being able to SELECT matrimony_profiles (owner-only after this
-- file) and does NOT call is_profile_public() (that function reads
-- profile_photos and would recurse from this policy).
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
  );
$$;

COMMENT ON FUNCTION public.profile_photo_is_listable(uuid) IS
  'TRUE when the member is currently listed (status=active, no admin hold, account active). Used by the profile_photos SELECT policy so it does not recurse through is_profile_public() or depend on matrimony_profiles RLS.';

REVOKE ALL ON FUNCTION public.profile_photo_is_listable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_photo_is_listable(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Members read photos of active profiles" ON public.profile_photos;
CREATE POLICY "Members read photos of active profiles"
  ON public.profile_photos FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (
      kind = 'profile_photo'
      AND public.profile_photo_is_listable(profile_id)
      AND NOT public.is_blocked(auth.uid(), profile_id)
    )
  );

-- Moments: expired / removed / non-public authors are not readable by others.
-- The owner can still read their own rows (including expired) for the rail.
DROP POLICY IF EXISTS "Members read live moments" ON public.moments;
CREATE POLICY "Members read live moments"
  ON public.moments FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      expires_at > now()
      AND NOT is_removed
      AND public.is_profile_public(user_id)
      AND NOT public.is_blocked(auth.uid(), user_id)
    )
  );


CREATE OR REPLACE FUNCTION public.update_my_privacy_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_current JSONB;
  v_next    JSONB;
  v_allowed TEXT[] := ARRAY['show_about', 'show_family_details', 'show_family_photo', 'show_income'];
  k         TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'update_my_privacy_settings: not authenticated';
  END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'update_my_privacy_settings: settings object required';
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_settings)
  LOOP
    IF NOT (k = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'FIELD_NOT_EDITABLE: %', k
        USING HINT = 'Only show_about, show_family_details, show_family_photo, show_income may be set here.';
    END IF;
    IF jsonb_typeof(p_settings -> k) <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_VALUE: % must be a boolean', k;
    END IF;
  END LOOP;

  SELECT coalesce(mp.privacy_settings, '{}'::jsonb) INTO v_current
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  v_next := v_current;
  FOREACH k IN ARRAY v_allowed LOOP
    IF p_settings ? k THEN
      v_next := jsonb_set(v_next, ARRAY[k], p_settings -> k, TRUE);
    END IF;
  END LOOP;

  UPDATE public.matrimony_profiles
  SET privacy_settings = v_next, updated_at = now()
  WHERE user_id = v_uid;

  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION public.update_my_privacy_settings(jsonb) IS
  'Writes the caller''s own privacy_settings. Allow-listed keys only (show_about, show_family_details, show_family_photo, show_income); unknown keys raise FIELD_NOT_EDITABLE. WhatsApp opt-in is a separate column and is not written here.';

REVOKE ALL ON FUNCTION public.update_my_privacy_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_privacy_settings(jsonb) TO authenticated;


-- get_profile_contact: viewer must be an active paid member; target must be
-- public (which already requires the target account to be active).
CREATE OR REPLACE FUNCTION public.get_profile_contact(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer UUID := auth.uid();
  v_active BOOLEAN;
BEGIN
  IF v_viewer IS NULL OR p_user_id IS NULL OR v_viewer = p_user_id THEN
    RETURN NULL;
  END IF;

  SELECT p.is_active INTO v_active FROM public.profiles p WHERE p.id = v_viewer;
  IF v_active IS DISTINCT FROM TRUE THEN
    RETURN NULL;
  END IF;

  IF NOT public.is_profile_public(p_user_id) OR public.is_blocked(v_viewer, p_user_id) THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_live_membership(v_viewer) THEN
    RETURN NULL;
  END IF;

  IF NOT public.mutual_interest_exists(v_viewer, p_user_id) THEN
    RETURN NULL;
  END IF;

  RETURN (SELECT p.mobile FROM public.profiles p WHERE p.id = p_user_id);
END;
$$;

COMMENT ON FUNCTION public.get_profile_contact(uuid) IS
  'Returns the target mobile ONLY when the caller is an active paid member, interest is mutual, neither side is blocked, and the target is currently public. A deactivated / deleted / suspended / expired / hidden target never reveals contact. Anon and self always get NULL.';

REVOKE ALL ON FUNCTION public.get_profile_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_contact(uuid) TO authenticated;


-- get_public_profile v7 — same payload as v6; a deactivated viewer is treated
-- as unpaid (so contact_phone / contact_email / whatsapp_allowed stay false).
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_viewer_active BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE coalesce((SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid()), FALSE)
  END;
  v_is_paid BOOLEAN := CASE
    WHEN auth.uid() IS NULL OR NOT v_viewer_active THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
  v_mutual BOOLEAN := CASE
    WHEN auth.uid() IS NULL OR NOT v_viewer_active THEN FALSE
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
  'Safe public profile for publicly-listed members (v7: a deactivated viewer is treated as unpaid, so contact never unlocks from a leftover session). Paid viewers see family/lifestyle fields when privacy_settings allow. Phone AND email only when paid + mutual + both accounts active. Logs profile_viewed analytics.';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;


-- express_interest: a deactivated sender cannot send (or re-send) interest.
CREATE OR REPLACE FUNCTION public.express_interest(
  p_target_id UUID,
  p_message   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender  UUID := auth.uid();
  v_limit   NUMERIC;
  v_sent    INTEGER;
  v_reverse RECORD;
  v_existing RECORD;
  v_active  BOOLEAN;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'express_interest: not authenticated';
  END IF;
  IF p_target_id IS NULL OR p_target_id = v_sender THEN
    RAISE EXCEPTION 'express_interest: invalid target';
  END IF;

  SELECT p.is_active INTO v_active FROM public.profiles p WHERE p.id = v_sender;
  IF v_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'express_interest: not authenticated';
  END IF;

  IF NOT public.has_benefit('express_interest', v_sender) THEN
    RAISE EXCEPTION 'PAID_MEMBERSHIP_REQUIRED: Become a Paid Member to showcase your profile and express interest.';
  END IF;

  IF NOT public.is_profile_public(p_target_id) THEN
    RAISE EXCEPTION 'TARGET_UNAVAILABLE';
  END IF;

  IF public.is_blocked(v_sender, p_target_id) THEN
    RAISE EXCEPTION 'TARGET_UNAVAILABLE';
  END IF;

  v_limit := (public.get_membership(v_sender) -> 'benefits' ->> 'interest_limit_per_month')::numeric;
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_sent
    FROM public.interests i
    WHERE i.sender_id = v_sender
      AND i.created_at > now() - interval '30 days';
    IF v_sent >= v_limit THEN
      RAISE EXCEPTION 'INTEREST_LIMIT_REACHED: your current plan allows % interests per month', floor(v_limit);
    END IF;
  END IF;

  SELECT i.id, i.status INTO v_existing
  FROM public.interests i
  WHERE i.sender_id = v_sender AND i.receiver_id = p_target_id;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status IN ('pending', 'accepted') THEN
      RETURN jsonb_build_object('status', CASE v_existing.status WHEN 'accepted' THEN 'mutual' ELSE 'sent' END);
    END IF;
    UPDATE public.interests
    SET status = 'pending',
        message = nullif(btrim(coalesce(p_message, '')), ''),
        created_at = now(),
        updated_at = now()
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.interests (sender_id, receiver_id, status, message)
    VALUES (v_sender, p_target_id, 'pending', nullif(btrim(coalesce(p_message, '')), ''));
  END IF;

  SELECT i.id, i.status INTO v_reverse
  FROM public.interests i
  WHERE i.sender_id = p_target_id AND i.receiver_id = v_sender;

  IF v_reverse.id IS NOT NULL AND v_reverse.status IN ('pending', 'accepted') THEN
    UPDATE public.interests
    SET status = 'accepted', updated_at = now()
    WHERE (sender_id = v_sender AND receiver_id = p_target_id)
       OR (sender_id = p_target_id AND receiver_id = v_sender);
    PERFORM public.log_activity(v_sender, 'interest_mutual', jsonb_build_object('with', p_target_id));
    RETURN jsonb_build_object('status', 'mutual');
  END IF;

  PERFORM public.log_activity(v_sender, 'interest_sent', jsonb_build_object('to', p_target_id));
  RETURN jsonb_build_object('status', 'sent');
END;
$$;


-- list_moments: only publicly-listed authors (plus the caller's own).
CREATE OR REPLACE FUNCTION public.list_moments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer UUID := auth.uid();
  v_result jsonb;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'list_moments: not authenticated';
  END IF;

  SELECT jsonb_agg(item ORDER BY created_at DESC) INTO v_result
  FROM (
    SELECT jsonb_build_object(
             'id', m.id,
             'user_id', m.user_id,
             'name', CASE
               WHEN char_length(btrim(p.full_name)) > 1
                 THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
               ELSE 'Member'
             END,
             'media_type', m.media_type,
             'storage_path', m.storage_path,
             'caption', m.caption,
             'created_at', m.created_at,
             'expires_at', m.expires_at,
             'is_mine', (m.user_id = v_viewer),
             'author_photo', ph.storage_path
           ) AS item,
           m.created_at
    FROM public.moments m
    JOIN public.profiles p ON p.id = m.user_id AND p.is_active
    LEFT JOIN LATERAL (
      SELECT x.storage_path FROM public.profile_photos x
      WHERE x.profile_id = m.user_id AND x.kind = 'profile_photo'
      ORDER BY x.is_primary DESC, x.sort_order ASC, x.id ASC LIMIT 1
    ) ph ON TRUE
    WHERE m.expires_at > now()
      AND NOT m.is_removed
      AND NOT public.is_blocked(v_viewer, m.user_id)
      AND (m.user_id = v_viewer OR public.is_profile_public(m.user_id))
    ORDER BY m.created_at DESC
    LIMIT 100
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.list_moments() IS
  'The live Moments rail: unexpired, not admin-removed, blocked authors hidden, and the author must be publicly listed (or the caller). Expired media never appears.';

REVOKE ALL ON FUNCTION public.list_moments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_moments() TO authenticated;
