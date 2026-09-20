-- Step 13: only confirmed critical authorization defects found by the audit.
-- No product, pricing, offer or provider-credential changes.
-- Apply AFTER Step 12. Re-runnable; do not reapply older function definitions.

-- A recipient must not rewrite the sender to forge consent/contact access.
REVOKE UPDATE ON public.interests FROM authenticated;
GRANT UPDATE (status) ON public.interests TO authenticated;

-- The old member-callable RPC trusted the client to have checked an OTP.
DROP FUNCTION IF EXISTS public.complete_mobile_otp_verification();
CREATE OR REPLACE FUNCTION public.complete_mobile_otp_verification(p_user_id UUID, p_mobile TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   UUID := p_user_id;
  v_mobile TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ONLY';
  END IF;

  SELECT p.mobile INTO v_mobile
  FROM public.profiles p
  WHERE p.id = v_user AND p.is_active
  FOR UPDATE;

  IF v_mobile IS NULL OR v_mobile IS DISTINCT FROM p_mobile THEN
    RAISE EXCEPTION 'MOBILE_NOT_ON_FILE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mobile_otp_requests
                 WHERE user_id = v_user AND mobile = v_mobile
                   AND verified_at IS NULL
                   AND requested_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'OTP_REQUEST_REQUIRED';
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
    AND mobile = v_mobile AND verified_at IS NULL;

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

REVOKE ALL ON FUNCTION public.complete_mobile_otp_verification(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mobile_otp_verification(uuid, text) TO service_role;
COMMENT ON FUNCTION public.complete_mobile_otp_verification(uuid, text) IS
  'Service-only completion after the API validates the real provider OTP. Locks and binds the member to the verified mobile and an outstanding request.';

-- Invoker trigger deliberately distinguishes direct member writes from
-- writes inside trusted SECURITY DEFINER lifecycle RPCs. Do NOT make this
-- trigger SECURITY DEFINER: that would erase the direct caller identity.
CREATE OR REPLACE FUNCTION public.guard_direct_member_state()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_admin OR NEW.mobile_verified OR NEW.email_verified OR NOT NEW.is_active THEN
        RAISE EXCEPTION 'PROTECTED_ACCOUNT_STATE';
      END IF;
    ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'PROTECTED_ACCOUNT_STATE';
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      IF NEW.verified_at IS NOT NULL OR NEW.admin_hidden_at IS NOT NULL
         OR NEW.admin_hidden_by IS NOT NULL OR NEW.admin_hidden_reason IS NOT NULL
         OR NEW.suspended_at IS NOT NULL OR NEW.suspended_by IS NOT NULL
         OR NEW.suspension_reason IS NOT NULL OR NEW.status_before_suspension IS NOT NULL
         OR NEW.status IN ('suspended', 'rejected') THEN
        RAISE EXCEPTION 'PROTECTED_PROFILE_STATE';
      END IF;
    ELSE
      IF ROW(NEW.admin_hidden_at, NEW.admin_hidden_by, NEW.admin_hidden_reason,
             NEW.suspended_at, NEW.suspended_by, NEW.suspension_reason, NEW.status_before_suspension)
         IS DISTINCT FROM
         ROW(OLD.admin_hidden_at, OLD.admin_hidden_by, OLD.admin_hidden_reason,
             OLD.suspended_at, OLD.suspended_by, OLD.suspension_reason, OLD.status_before_suspension)
         OR (NEW.status IS DISTINCT FROM OLD.status AND
             (OLD.status IN ('suspended', 'rejected') OR NEW.status IN ('suspended', 'rejected'))) THEN
        RAISE EXCEPTION 'PROTECTED_PROFILE_STATE';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS z_guard_direct_member_state ON public.profiles;
CREATE TRIGGER z_guard_direct_member_state BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_member_state();
DROP TRIGGER IF EXISTS z_guard_direct_member_state ON public.matrimony_profiles;
CREATE TRIGGER z_guard_direct_member_state BEFORE INSERT OR UPDATE ON public.matrimony_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_member_state();
-- Otherwise DELETE + INSERT resets suspension/hold/verification protection.
-- Self account deletion continues through its existing SECURITY DEFINER RPC.
REVOKE DELETE ON public.matrimony_profiles FROM authenticated;
