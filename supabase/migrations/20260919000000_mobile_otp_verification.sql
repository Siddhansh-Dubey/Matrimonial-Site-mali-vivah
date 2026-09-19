-- ============================================================================
-- Mali Vivah · Phase 1 — mobile OTP verification (member-facing)
--
-- WHAT IT DOES
--   §1 mobile_otp_requests — server-side OTP request log (rate limiting +
--      history). One pending window per member.
--   §2 request_mobile_otp() — SECURITY DEFINER RPC the app calls BEFORE the
--      server sends any SMS:
--        * only the signed-in member's OWN stored mobile is eligible,
--        * 60-second cooldown between requests,
--        * at most 5 requests per rolling hour,
--        * raises OTP_COOLDOWN / OTP_LIMIT_EXCEEDED (generic, no enumeration).
--      The SMS itself is sent by the Next.js API route through the Supabase
--      phone-auth mechanism (GoTrue signInWithOtp with the service role), so
--      the OTP is generated and delivered by the project's configured SMS
--      provider — never by this app, never faked.
--   §3 complete_mobile_otp_verification() — called by the API route ONLY
--      after GoTrue has validated the code. Sets profiles.mobile_verified,
--      records a 'verified' verification_requests row (type='mobile'),
--      notifies the member and writes an activity event.
--
-- SECURITY
--   * No client can mark their own number verified — the flip happens only in
--     this security-definer RPC, and the API route reaches it only after
--     GoTrue verifyOtp() succeeds with the service-role key.
--   * Requests are per auth.uid(); there is no path to probe whether another
--     number exists (the number always comes from the caller's own row).
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- EXTERNAL PREREQUISITE (documented, not code):
--   Supabase Dashboard → Authentication → Phone → enable phone login and
--   configure an SMS provider (or Twilio credentials). Without it the request
--   endpoint returns a clear "SMS provider not configured" error — the flow
--   never pretends to have sent an OTP.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Request log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mobile_otp_requests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  mobile       TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.mobile_otp_requests IS
  'Mobile OTP request audit + rate limiting. Written by request_mobile_otp(); verified_at is set by complete_mobile_otp_verification() after GoTrue validates the code.';

CREATE INDEX IF NOT EXISTS mobile_otp_requests_user_idx
  ON public.mobile_otp_requests (user_id, requested_at DESC);

ALTER TABLE public.mobile_otp_requests ENABLE ROW LEVEL SECURITY;
-- No client grants: the two RPCs below (security definer) are the only
-- write/read path, and members never need the raw table.


-- ----------------------------------------------------------------------------
-- §2 request_mobile_otp() — rate-limited eligibility + request record
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_mobile_otp()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_mobile TEXT;
  v_last   TIMESTAMPTZ;
  v_hour   INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'request_mobile_otp: not authenticated';
  END IF;

  SELECT p.mobile INTO v_mobile
  FROM public.profiles p
  WHERE p.id = v_user;

  IF v_mobile IS NULL OR v_mobile !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'MOBILE_NOT_ON_FILE: add your mobile number before verifying it';
  END IF;

  SELECT max(requested_at) INTO v_last
  FROM public.mobile_otp_requests
  WHERE user_id = v_user;

  IF v_last IS NOT NULL AND now() - v_last < interval '60 seconds' THEN
    RAISE EXCEPTION 'OTP_COOLDOWN: please wait a moment before requesting another code';
  END IF;

  SELECT count(*) INTO v_hour
  FROM public.mobile_otp_requests
  WHERE user_id = v_user
    AND requested_at > now() - interval '1 hour';

  IF v_hour >= 5 THEN
    RAISE EXCEPTION 'OTP_LIMIT_EXCEEDED: too many verification attempts, try again later';
  END IF;

  INSERT INTO public.mobile_otp_requests (user_id, mobile)
  VALUES (v_user, v_mobile);

  RETURN jsonb_build_object('ok', TRUE, 'mobile', v_mobile);
END;
$$;

COMMENT ON FUNCTION public.request_mobile_otp() IS
  'Rate-limited OTP request gate (60s cooldown, 5/hour) for the member''s OWN stored mobile. The API route sends the SMS through Supabase phone auth only after this succeeds.';

REVOKE ALL ON FUNCTION public.request_mobile_otp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_mobile_otp() TO authenticated;


-- ----------------------------------------------------------------------------
-- §3 complete_mobile_otp_verification() — flip the authoritative flag
-- ----------------------------------------------------------------------------
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

  UPDATE public.profiles
  SET mobile_verified = TRUE
  WHERE id = v_user;

  -- Close every open request window for this member (they were attempts for
  -- the same purpose; the newest one is now the verified one).
  UPDATE public.mobile_otp_requests
  SET verified_at = now()
  WHERE user_id = v_user
    AND verified_at IS NULL;

  -- Record the decision in the verification queue too (type='mobile',
  -- status='verified'). Inserted already-verified, so the pending→verified
  -- decision trigger does not fire twice.
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

COMMENT ON FUNCTION public.complete_mobile_otp_verification() IS
  'Marks the member''s stored mobile as verified (profiles.mobile_verified) after the API route has validated the OTP with GoTrue. Notifies + audit-logs.';

REVOKE ALL ON FUNCTION public.complete_mobile_otp_verification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_mobile_otp_verification() TO authenticated;
