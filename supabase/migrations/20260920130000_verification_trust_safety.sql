-- ============================================================================
-- Mali Vivah · Step 10 — Verification + Trust & Safety Hardening
--
-- WHAT THIS MIGRATION DOES
--   §1 Profile & verification status protection triggers:
--        * Client cannot directly modify profiles.is_admin.
--        * Changing mobile number invalidates profiles.mobile_verified.
--        * Client cannot directly set profiles.mobile_verified = TRUE without OTP.
--        * Client cannot directly set matrimony_profiles.verified_at.
--   §2 RLS tightening for verification requests:
--        * Owner can only insert with status = 'pending' and null review fields.
--        * User notification emitted upon verification request submission.
--   §3 Block enforcement across product tables & discovery:
--        * matrimony_profiles SELECT policy excludes blocked pairs.
--        * profile_photos SELECT policy excludes blocked pairs.
--        * interests SELECT policy excludes blocked pairs.
--        * shortlists SELECT & INSERT policies exclude blocked pairs.
--        * profile_views SELECT policy excludes blocked pairs.
--        * mutual_interest_exists() & get_profile_contact() enforce no blocks.
--   §4 Server-authoritative report & block RPCs:
--        * report_profile() — deduplicated, rate-limited, validated reasons.
--        * block_member() — idempotent, self-blocking refused.
--        * unblock_member() — server-authoritative unblock.
--   §5 Admin Trust & Safety RPCs (service_role only, gated by admin_assert_actor):
--        * admin_decide_verification() — approve/reject verification requests + audit.
--        * admin_resolve_report() — moderate reports + audit.
--        * admin_list_blocks() — inspect blocks with actor check.
--        * admin_set_member_verified() — toggle verified badge + audit.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Profiles & matrimony_profiles verification protection triggers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_verification_and_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Non-admins cannot alter is_admin flag
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin THEN
    IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'CANNOT_MODIFY_ADMIN_ROLE: only administrators may modify administrative status';
    END IF;
  END IF;

  -- 2. Changing mobile number invalidates verification state
  IF OLD.mobile IS DISTINCT FROM NEW.mobile THEN
    NEW.mobile_verified := FALSE;
  END IF;

  -- 3. mobile_verified cannot be arbitrarily flipped from false to true by a normal client
  IF OLD.mobile_verified IS FALSE AND NEW.mobile_verified IS TRUE THEN
    IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
      IF current_setting('mali.otp_verified', TRUE) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'CANNOT_MODIFY_VERIFICATION_STATUS: mobile verification requires completing OTP verification';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_verification ON public.profiles;
CREATE TRIGGER profiles_protect_verification
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_verification_and_admin();


CREATE OR REPLACE FUNCTION public.protect_matrimony_profile_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- verified_at cannot be directly manipulated by non-admins
  IF OLD.verified_at IS DISTINCT FROM NEW.verified_at THEN
    IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'CANNOT_MODIFY_VERIFICATION_STATUS: only administrators may modify verification status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matrimony_profiles_protect_verification ON public.matrimony_profiles;
CREATE TRIGGER matrimony_profiles_protect_verification
  BEFORE UPDATE ON public.matrimony_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_matrimony_profile_verification();


-- ----------------------------------------------------------------------------
-- §2 Verification requests & submission notification
-- ----------------------------------------------------------------------------

-- Update complete_mobile_otp_verification to set session flag for trigger
CREATE OR REPLACE FUNCTION public.complete_mobile_otp_verification()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_mobile TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'complete_mobile_otp_verification: not authenticated';
  END IF;

  SELECT p.mobile INTO v_mobile
  FROM public.profiles p
  WHERE p.id = v_user;

  IF v_mobile IS NULL THEN
    RAISE EXCEPTION 'MOBILE_NOT_ON_FILE';
  END IF;

  -- Set transaction-local flag so the protection trigger knows this is legitimate
  PERFORM set_config('mali.otp_verified', 'true', true);

  UPDATE public.profiles
  SET mobile_verified = TRUE
  WHERE id = v_user;

  -- Close every open request window for this member
  UPDATE public.mobile_otp_requests
  SET verified_at = now()
  WHERE user_id = v_user
    AND verified_at IS NULL;

  -- Record the decision in the verification queue
  INSERT INTO public.verification_requests (user_id, type, status, note)
  VALUES (
    v_user,
    'mobile',
    'verified',
    'Verified by OTP via Supabase phone auth.'
  );

  PERFORM public.push_notification(
    v_user,
    'profile_verified',
    'Mobile number verified',
    'Your mobile number is now verified. You can sign in with it from any device.',
    jsonb_build_object('verification_type', 'mobile'),
    '/profile'
  );

  PERFORM public.log_activity(
    v_user,
    'mobile_otp_verified',
    jsonb_build_object('method', 'supabase_phone_auth')
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Tighten INSERT policy: members can only file their own PENDING requests
DROP POLICY IF EXISTS "Owner files own verification request" ON public.verification_requests;
CREATE POLICY "Owner files own verification request"
  ON public.verification_requests FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

-- Trigger: notify member when a verification request is submitted
CREATE OR REPLACE FUNCTION public.log_verification_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM public.log_activity(
      NEW.user_id,
      'verification_submitted',
      jsonb_build_object('type', NEW.type::text)
    );
    PERFORM public.push_notification(
      NEW.user_id,
      'admin_message',
      'Verification request submitted',
      'Your verification request has been received and is queued for review by our team.',
      jsonb_build_object('verification_type', NEW.type::text),
      '/profile'
    );
  END IF;
  RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- §3 Canonical activity vocabulary extension
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_activity_events()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY[
    -- Auth / Account
    'registered',
    'logged_in',
    'account_deletion_requested',
    'account_deleted',
    -- Profile
    'profile_created',
    'profile_completed',
    'profile_published',
    'profile_updated',
    'profile_viewed',
    'profile_verified',
    -- Search / Discovery
    'search_performed',
    -- Interests / Connections
    'interest_sent',
    'interest_accepted',
    'interest_declined',
    'interest_mutual',
    -- Messages / Contact
    'message_sent',
    'contact_revealed',
    -- Payments
    'payment_initiated',
    'payment_captured',
    'payment_failed',
    'payment_refunded',
    -- Subscriptions
    'membership_activated',
    'membership_expired',
    'membership_renewed',
    'membership_refunded',
    -- Boosts
    'profile_boosted',
    'boost_purchased',
    'boost_activated',
    'boost_expired',
    'boost_refunded',
    'boost_granted',
    -- Mali Moments
    'moment_posted',
    'moment_reported',
    'moment_removed',
    -- Verification
    'verification_submitted',
    'verification_approved',
    'verification_rejected',
    -- Success stories
    'story_submitted',
    -- Safety / trust
    'block_created',
    'block_removed',
    'profile_reported',
    -- Admin member management (Step 7) — safe metadata only, no reasons
    'admin_member_approved',
    'admin_member_rejected',
    'admin_member_edited',
    'admin_member_suspended',
    'admin_member_unsuspended',
    'admin_member_hidden',
    'admin_member_reactivated',
    'admin_member_deleted',
    'admin_member_verified',
    'admin_member_unverified',
    'admin_member_featured',
    'admin_member_unfeatured',
    'admin_member_photo_removed',
    'admin_manual_membership_activation'
  ]::TEXT[]
$$;


-- ----------------------------------------------------------------------------
-- §4 Report profile RPC (server-authoritative, deduplicated, rate-limited)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_profile(
  p_target_id UUID,
  p_reason    public.report_reason DEFAULT 'other',
  p_details   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reporter UUID := auth.uid();
  v_existing BIGINT;
  v_count    INTEGER;
  v_new      BIGINT;
BEGIN
  IF v_reporter IS NULL THEN
    RAISE EXCEPTION 'report_profile: not authenticated';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'report_profile: target id required';
  END IF;

  IF p_target_id = v_reporter THEN
    RAISE EXCEPTION 'CANNOT_REPORT_SELF: you cannot report your own profile';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND: target profile does not exist';
  END IF;

  -- One open or reviewing report per (reporter, target)
  SELECT r.id INTO v_existing
  FROM public.reports r
  WHERE r.reporter_id = v_reporter
    AND r.reported_id = p_target_id
    AND r.target_type = 'profile'
    AND r.status IN ('open', 'reviewing');

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_reported', 'report_id', v_existing);
  END IF;

  -- Rate limit: max 10 reports per hour per member
  SELECT count(*) INTO v_count
  FROM public.reports
  WHERE reporter_id = v_reporter
    AND created_at > now() - interval '1 hour';

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'REPORT_LIMIT_EXCEEDED: too many reports submitted recently, please try again later';
  END IF;

  INSERT INTO public.reports (
    reporter_id,
    reported_id,
    reason,
    details,
    status,
    target_type,
    target_id
  ) VALUES (
    v_reporter,
    p_target_id,
    p_reason,
    nullif(btrim(coalesce(p_details, '')), ''),
    'open',
    'profile',
    NULL
  )
  RETURNING id INTO v_new;

  PERFORM public.log_activity(
    v_reporter,
    'profile_reported',
    jsonb_build_object('reported_id', p_target_id, 'reason', p_reason::text, 'report_id', v_new)
  );

  RETURN jsonb_build_object('status', 'filed', 'report_id', v_new);
END;
$$;

COMMENT ON FUNCTION public.report_profile(uuid, public.report_reason, text) IS
  'Files a moderation report against a profile. Server-authoritative: reporter is auth.uid(), self-reports rejected, deduped per (reporter, target). Reporter identity stays hidden from the reported member.';

REVOKE ALL ON FUNCTION public.report_profile(uuid, public.report_reason, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_profile(uuid, public.report_reason, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- §5 Block & unblock RPCs (idempotent, server-authoritative)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_member(
  p_target_id UUID,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocker UUID := auth.uid();
BEGIN
  IF v_blocker IS NULL THEN
    RAISE EXCEPTION 'block_member: not authenticated';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'block_member: target id required';
  END IF;

  IF p_target_id = v_blocker THEN
    RAISE EXCEPTION 'CANNOT_BLOCK_SELF: you cannot block yourself';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND: target profile does not exist';
  END IF;

  INSERT INTO public.blocks (blocker_id, blocked_id, reason)
  VALUES (v_blocker, p_target_id, nullif(btrim(coalesce(p_reason, '')), ''))
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'blocked');
END;
$$;

COMMENT ON FUNCTION public.block_member(uuid, text) IS
  'Blocks another member. Idempotent on duplicate requests. Rejects self-blocks. Fires block_created trigger.';

REVOKE ALL ON FUNCTION public.block_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_member(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.unblock_member(
  p_target_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocker UUID := auth.uid();
BEGIN
  IF v_blocker IS NULL THEN
    RAISE EXCEPTION 'unblock_member: not authenticated';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'unblock_member: target id required';
  END IF;

  DELETE FROM public.blocks
  WHERE blocker_id = v_blocker AND blocked_id = p_target_id;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'unblocked');
END;
$$;

COMMENT ON FUNCTION public.unblock_member(uuid) IS
  'Unblocks a member previously blocked by the caller. Fires block_removed trigger.';

REVOKE ALL ON FUNCTION public.unblock_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_member(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- §6 Discovery & contact privacy hardening for blocks
-- ----------------------------------------------------------------------------

-- matrimony_profiles: blocked pairs cannot read each other's active row
DROP POLICY IF EXISTS "Members read active matrimony profiles" ON public.matrimony_profiles;
CREATE POLICY "Members read active matrimony profiles"
  ON public.matrimony_profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (
      status = 'active'
      AND admin_hidden_at IS NULL
      AND NOT public.is_blocked(auth.uid(), user_id)
    )
  );

-- profile_photos: photos of blocked profiles cannot be read directly
DROP POLICY IF EXISTS "Members read photos of active profiles" ON public.profile_photos;
CREATE POLICY "Members read photos of active profiles"
  ON public.profile_photos FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (
      EXISTS (
        SELECT 1 FROM public.matrimony_profiles mp
        WHERE mp.user_id = profile_photos.profile_id
          AND mp.status = 'active'
          AND mp.admin_hidden_at IS NULL
      )
      AND NOT public.is_blocked(auth.uid(), profile_photos.profile_id)
    )
  );

-- interests: blocked users cannot see past or current interests involving each other
DROP POLICY IF EXISTS "Parties read shared interest" ON public.interests;
CREATE POLICY "Parties read shared interest"
  ON public.interests FOR SELECT TO authenticated
  USING (
    (sender_id = auth.uid() OR receiver_id = auth.uid())
    AND NOT public.is_blocked(sender_id, receiver_id)
  );

-- shortlists: cannot read or add blocked profiles
DROP POLICY IF EXISTS "Owner reads own shortlist" ON public.shortlists;
CREATE POLICY "Owner reads own shortlist"
  ON public.shortlists FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT public.is_blocked(user_id, target_id)
  );

DROP POLICY IF EXISTS "Owner adds to shortlist" ON public.shortlists;
CREATE POLICY "Owner adds to shortlist"
  ON public.shortlists FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT public.is_blocked(user_id, target_id)
  );

-- profile_views: past views from blocked users are hidden
DROP POLICY IF EXISTS "Member reads own visitors" ON public.profile_views;
CREATE POLICY "Member reads own visitors"
  ON public.profile_views FOR SELECT TO authenticated
  USING (
    viewed_id = auth.uid()
    AND public.has_benefit('who_viewed_me', auth.uid())
    AND NOT public.is_blocked(auth.uid(), viewer_id)
  );

-- mutual_interest_exists: block cancels mutual interest
CREATE OR REPLACE FUNCTION public.mutual_interest_exists(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RETURN FALSE;
  END IF;

  -- Blocks eliminate mutual interest in both directions
  IF public.is_blocked(p_a, p_b) THEN
    RETURN FALSE;
  END IF;

  -- Case (a): an accepted row in either direction.
  IF EXISTS (
    SELECT 1 FROM public.interests i
    WHERE ((i.sender_id = p_a AND i.receiver_id = p_b)
        OR (i.sender_id = p_b AND i.receiver_id = p_a))
      AND i.status = 'accepted'
  ) THEN
    RETURN TRUE;
  END IF;

  -- Case (b): live rows in BOTH directions.
  IF EXISTS (
    SELECT 1 FROM public.interests i1
    WHERE i1.sender_id = p_a AND i1.receiver_id = p_b
      AND i1.status IN ('pending', 'accepted')
  ) AND EXISTS (
    SELECT 1 FROM public.interests i2
    WHERE i2.sender_id = p_b AND i2.receiver_id = p_a
      AND i2.status IN ('pending', 'accepted')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- get_profile_contact: block prevents phone reveal
CREATE OR REPLACE FUNCTION public.get_profile_contact(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer UUID := auth.uid();
BEGIN
  IF v_viewer IS NULL OR p_user_id IS NULL OR v_viewer = p_user_id THEN
    RETURN NULL;
  END IF;

  -- Target must be public and neither side has blocked the other
  IF NOT public.is_profile_public(p_user_id) OR public.is_blocked(v_viewer, p_user_id) THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_active_subscription(v_viewer) THEN
    RETURN NULL;
  END IF;

  IF NOT public.mutual_interest_exists(v_viewer, p_user_id) THEN
    RETURN NULL;
  END IF;

  RETURN (SELECT p.mobile FROM public.profiles p WHERE p.id = p_user_id);
END;
$$;


-- ----------------------------------------------------------------------------
-- §7 Admin Verification, Reports & Block RPCs (audited, service-role only)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_decide_verification(
  p_admin_id   UUID,
  p_request_id UUID,
  p_decision   TEXT,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);

  IF p_decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_DECISION: decision must be verified or rejected';
  END IF;

  SELECT id, user_id, type, status INTO v_req
  FROM public.verification_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: verification request does not exist';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING: request has already been decided';
  END IF;

  UPDATE public.verification_requests
  SET status = p_decision::public.verification_status,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_by = p_admin_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.admin_audit_log (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    p_admin_id,
    'verification_' || p_decision,
    'verification_request',
    p_request_id::text,
    jsonb_build_object('user_id', v_req.user_id, 'type', v_req.type::text, 'note', p_note)
  );

  RETURN jsonb_build_object('ok', TRUE, 'status', p_decision);
END;
$$;

COMMENT ON FUNCTION public.admin_decide_verification(uuid, uuid, text, text) IS
  'Admin decides a verification request (verified/rejected). Enforces admin actor check, flips status (trigger applies badge and notifications), and writes admin_audit_log. Service role only.';

REVOKE ALL ON FUNCTION public.admin_decide_verification(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_verification(uuid, uuid, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_admin_id  UUID,
  p_report_id BIGINT,
  p_status    TEXT,
  p_note      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep RECORD;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);

  IF p_status NOT IN ('reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'INVALID_STATUS: status must be reviewing, resolved, or dismissed';
  END IF;

  SELECT id, reporter_id, reported_id, reason, status INTO v_rep
  FROM public.reports
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: report does not exist';
  END IF;

  UPDATE public.reports
  SET status = p_status::public.report_status,
      updated_at = now()
  WHERE id = p_report_id;

  INSERT INTO public.admin_audit_log (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    p_admin_id,
    'report_' || p_status,
    'report',
    p_report_id::text,
    jsonb_build_object('reported_id', v_rep.reported_id, 'reason', v_rep.reason::text, 'note', p_note)
  );

  RETURN jsonb_build_object('ok', TRUE, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION public.admin_resolve_report(uuid, bigint, text, text) IS
  'Admin moderates a report (reviewing/resolved/dismissed). Enforces admin actor check and writes admin_audit_log. Service role only.';

REVOKE ALL ON FUNCTION public.admin_resolve_report(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report(uuid, bigint, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.admin_list_blocks(
  p_admin_id UUID,
  p_search   TEXT DEFAULT NULL,
  p_limit    INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res   JSONB;
  v_limit INTEGER := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_s     TEXT := nullif(lower(btrim(coalesce(p_search, ''))), '');
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);

  SELECT jsonb_agg(row_to_json(b_row))
  INTO v_res
  FROM (
    SELECT
      b.id,
      b.blocker_id,
      b.blocked_id,
      b.reason,
      b.created_at,
      jsonb_build_object('full_name', p1.full_name, 'email', p1.email) AS blocker,
      jsonb_build_object('full_name', p2.full_name, 'email', p2.email) AS blocked
    FROM public.blocks b
    JOIN public.profiles p1 ON p1.id = b.blocker_id
    JOIN public.profiles p2 ON p2.id = b.blocked_id
    WHERE v_s IS NULL
       OR lower(p1.full_name) LIKE '%' || v_s || '%'
       OR lower(p1.email) LIKE '%' || v_s || '%'
       OR lower(p2.full_name) LIKE '%' || v_s || '%'
       OR lower(p2.email) LIKE '%' || v_s || '%'
    ORDER BY b.created_at DESC
    LIMIT v_limit
  ) b_row;

  RETURN coalesce(v_res, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.admin_list_blocks(uuid, text, integer) IS
  'Admin block inspection. Enforces admin actor check. Service role only.';

REVOKE ALL ON FUNCTION public.admin_list_blocks(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_blocks(uuid, text, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.admin_set_member_verified(
  p_admin_id UUID,
  p_user_id  UUID,
  p_verified BOOLEAN,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);

  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.matrimony_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: matrimony profile does not exist';
  END IF;

  UPDATE public.matrimony_profiles
  SET verified_at = CASE WHEN p_verified THEN now() ELSE NULL END,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.admin_audit_log (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    p_admin_id,
    CASE WHEN p_verified THEN 'member_verified' ELSE 'member_unverified' END,
    'profile',
    p_user_id::text,
    jsonb_build_object('verified', p_verified, 'reason', p_reason)
  );

  PERFORM public.push_notification(
    p_user_id,
    CASE WHEN p_verified THEN 'profile_verified'::public.notification_type ELSE 'admin_message'::public.notification_type END,
    CASE WHEN p_verified THEN 'Profile verified' ELSE 'Verification removed' END,
    CASE WHEN p_verified
      THEN 'Your verified badge is live. Thank you for helping keep Mali Vivah safe.'
      ELSE 'An admin removed the verified badge from your profile. Reply to this message if you believe this is a mistake.'
    END,
    jsonb_build_object('verified', p_verified),
    '/profile'
  );

  RETURN jsonb_build_object('ok', TRUE, 'verified', p_verified);
END;
$$;

COMMENT ON FUNCTION public.admin_set_member_verified(uuid, uuid, boolean, text) IS
  'Admin toggles member verification status directly. Enforces admin actor check, notifies member, and writes admin_audit_log. Service role only.';

REVOKE ALL ON FUNCTION public.admin_set_member_verified(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_member_verified(uuid, uuid, boolean, text) TO service_role;
