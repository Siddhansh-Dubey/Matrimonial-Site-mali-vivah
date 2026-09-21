-- ============================================================================
-- Mali Vivah · Mobile OTP — make the delivery result authoritative
--
-- WHAT WAS WRONG
--   The SMS itself has ALWAYS been delegated to Supabase phone auth (GoTrue
--   `signInWithOtp` with the service role) — this app never generates, stores
--   or fakes a code, and that stays exactly the same. But the request side was
--   blind:
--
--     1. `request_mobile_otp()` recorded the attempt and spent one of the
--        member's 5-per-hour slots BEFORE anyone knew whether the project can
--        send an SMS at all. On a deployment with phone auth disabled, no SMS
--        provider configured, or GoTrue's local `test` provider, the member
--        burned their whole hourly budget on sends that could never arrive and
--        was then told "too many verification attempts".
--     2. Nothing in the database recorded whether a send was actually accepted
--        by the provider. The only trace was a row in mobile_otp_requests that
--        looked identical whether the SMS went out or the provider refused it,
--        so an operator could not tell "member never got the code" from
--        "delivery is broken".
--     3. `complete_mobile_otp_verification()` accepted ANY outstanding request
--        row in the last ten minutes, including one whose send had failed.
--     4. The API collapsed every provider failure into one message and
--        swallowed the provider's own reason, so the UI could not distinguish
--        "not configured", "rate limited", "invalid number" and "provider
--        rejected the send".
--
-- WHAT THIS MIGRATION DOES
--   §1 mobile_otp_requests gains `delivery_status` ('requested' → 'sent' |
--      'failed') and `failure_code`. Existing rows default to 'requested' —
--      nothing is rewritten, no history is lost.
--   §2 request_mobile_otp() keeps its EXACT existing security posture
--      (own stored mobile only, 60-second cooldown, 5 per rolling hour, the
--      same OTP_COOLDOWN / OTP_LIMIT_EXCEEDED / MOBILE_NOT_ON_FILE codes, the
--      same GRANTs) and additionally returns the request id plus the real
--      cooldown / window numbers, so the browser can render the server's
--      countdown instead of guessing 60.
--   §3 record_mobile_otp_delivery() — NEW, service-role only, member-bound:
--      the ONLY way to mark an attempt 'sent' or 'failed'. It can never set
--      verified_at, never touch profiles.mobile_verified and never widen a
--      rate limit.
--   §4 complete_mobile_otp_verification() now additionally requires the
--      outstanding request NOT to be a recorded delivery FAILURE. Everything
--      else about it is untouched: still service-role only, still locks and
--      binds the member to the number just proved, still inside the
--      ten-minute window, still guarded by `mali.otp_verified` for the
--      protected-state trigger.
--
--   The rate limits are NOT weakened. A failed provider send still counts as
--   an attempt (the provider was really contacted); the improvement is that
--   the Next.js route now PRE-FLIGHTS GoTrue's published `/auth/v1/settings`
--   before calling this RPC, so a deployment that cannot send SMS never spends
--   a member's budget at all.
--
-- EXTERNAL CONFIGURATION STILL REQUIRED (not code, cannot be code):
--   Supabase project → Authentication → Sign In / Up → Phone, i.e. the GoTrue
--   settings of THIS Supabase project:
--     GOTRUE_EXTERNAL_PHONE_ENABLED = true
--     GOTRUE_SMS_PROVIDER           = twilio | msg91 | textlocal | vonage | …
--     plus that provider's own credentials (e.g. GOTRUE_SMS_TWILIO_ACCOUNT_SID,
--     GOTRUE_SMS_TWILIO_AUTH_TOKEN, GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID).
--   On hosted Supabase these live in the project's auth configuration; they
--   are NOT Next.js environment variables and must never be. The Next.js app
--   only holds the optional contract variables documented in .env.example
--   (SUPABASE_SMS_PROVIDER / MOBILE_OTP_ALLOW_TEST_PROVIDER), which let the
--   server assert that the project is really configured for the provider this
--   deployment expects.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- DEPENDS ON 20260919000000_mobile_otp_verification.sql and
-- 20260920160000_audit_authorization_boundaries.sql (the service-only
-- completion RPC replaced there). Deploy together with the updated
-- src/app/api/mobile-otp/* routes.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.mobile_otp_requests') IS NULL
     OR to_regprocedure('public.request_mobile_otp()') IS NULL
     OR to_regprocedure('public.complete_mobile_otp_verification(uuid, text)') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'mobile_otp_delivery_diagnostics: prerequisite migrations are not applied',
      HINT    = 'Apply 20260919000000_mobile_otp_verification.sql and 20260920160000_audit_authorization_boundaries.sql first.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 Delivery outcome columns on the request ledger
-- ----------------------------------------------------------------------------
ALTER TABLE public.mobile_otp_requests
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'requested'
    CHECK (delivery_status IN ('requested', 'sent', 'failed'));
ALTER TABLE public.mobile_otp_requests
  ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE public.mobile_otp_requests
  ADD COLUMN IF NOT EXISTS provider TEXT;

COMMENT ON COLUMN public.mobile_otp_requests.delivery_status IS
  'Provider outcome of this attempt: ''requested'' (recorded, provider not yet contacted or outcome unknown), ''sent'' (GoTrue accepted the send) or ''failed'' (GoTrue refused / the provider rejected it). Written ONLY by record_mobile_otp_delivery(); a ''failed'' row can never complete verification.';
COMMENT ON COLUMN public.mobile_otp_requests.failure_code IS
  'Stable diagnostic code for a failed send (OTP_PHONE_DISABLED / OTP_SMS_NOT_CONFIGURED / OTP_SMS_TEST_PROVIDER / OTP_SMS_PROVIDER_MISMATCH / OTP_RATE_LIMITED / OTP_INVALID_PHONE / OTP_PROVIDER_ERROR). Never an OTP value, never a credential.';
COMMENT ON COLUMN public.mobile_otp_requests.provider IS
  'SMS provider GoTrue reported for this attempt (from /auth/v1/settings). Diagnostics only.';

CREATE INDEX IF NOT EXISTS mobile_otp_requests_delivery_idx
  ON public.mobile_otp_requests (delivery_status, requested_at DESC);


-- ----------------------------------------------------------------------------
-- §2 request_mobile_otp() — same gate, richer (and truthful) result
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_mobile_otp()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_mobile   TEXT;
  v_last     TIMESTAMPTZ;
  v_hour     INTEGER;
  v_request  BIGINT;
  -- Kept as named constants so the API and the browser render the SERVER's
  -- numbers instead of a hard-coded 60 / 5 in three places.
  c_cooldown INTEGER := 60;
  c_max_hour INTEGER := 5;
  c_window   INTEGER := 10;
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

  IF v_last IS NOT NULL AND now() - v_last < make_interval(secs => c_cooldown) THEN
    RAISE EXCEPTION 'OTP_COOLDOWN: please wait % seconds before requesting another code',
      greatest(0, ceil(c_cooldown - extract(epoch FROM (now() - v_last))))::int;
  END IF;

  SELECT count(*) INTO v_hour
  FROM public.mobile_otp_requests
  WHERE user_id = v_user
    AND requested_at > now() - interval '1 hour';

  IF v_hour >= c_max_hour THEN
    RAISE EXCEPTION 'OTP_LIMIT_EXCEEDED: too many verification attempts, try again later';
  END IF;

  INSERT INTO public.mobile_otp_requests (user_id, mobile, delivery_status)
  VALUES (v_user, v_mobile, 'requested')
  RETURNING id INTO v_request;

  -- The full number is already the caller's own (the RPC is auth.uid()-scoped)
  -- but the API only ever needs a masked hint for the UI, so mask it here and
  -- let the route keep the digits server-side.
  RETURN jsonb_build_object(
    'ok', TRUE,
    'request_id', v_request,
    'mobile_masked', left(v_mobile, 2) || '•••••' || right(v_mobile, 4),
    'cooldown_seconds', c_cooldown,
    'verify_window_minutes', c_window,
    'max_per_hour', c_max_hour,
    'requests_last_hour', v_hour + 1
  );
END;
$$;

COMMENT ON FUNCTION public.request_mobile_otp() IS
  'Rate-limited OTP request gate (60s cooldown, 5 per rolling hour) for the member''s OWN stored mobile. Returns {ok, request_id, mobile_masked, cooldown_seconds, verify_window_minutes, max_per_hour, requests_last_hour}. The API route pre-flights GoTrue''s SMS settings, then sends the SMS through Supabase phone auth, then records the outcome with record_mobile_otp_delivery(). Unchanged security: auth.uid() only, no number probing, no OTP is generated here.';

REVOKE ALL ON FUNCTION public.request_mobile_otp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_mobile_otp() TO authenticated;


-- ----------------------------------------------------------------------------
-- §3 record_mobile_otp_delivery() — NEW, service-role only, member-bound
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_mobile_otp_delivery(
  p_request_id   BIGINT,
  p_user_id      UUID,
  p_status       TEXT,
  p_failure_code TEXT DEFAULT NULL,
  p_provider     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.mobile_otp_requests%ROWTYPE;
  v_code  TEXT := nullif(btrim(coalesce(p_failure_code, '')), '');
  v_prov  TEXT := nullif(btrim(coalesce(p_provider, '')), '');
BEGIN
  -- Same boundary as complete_mobile_otp_verification(): the browser can never
  -- reach this, and a member JWT can never reach it either.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ONLY';
  END IF;

  IF p_request_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'OTP_REQUEST_REQUIRED: request and member are required';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'OTP_INVALID_STATUS: delivery status must be sent or failed';
  END IF;

  -- Bound to the member: a request id from another account cannot be flipped.
  SELECT r.* INTO v_row
  FROM public.mobile_otp_requests r
  WHERE r.id = p_request_id AND r.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OTP_REQUEST_REQUIRED: no such request for this member';
  END IF;

  -- Never a downgrade of a completed verification and never a re-send marker:
  -- once GoTrue accepted a send we keep that fact.
  IF v_row.verified_at IS NOT NULL OR v_row.delivery_status = 'sent' THEN
    RETURN jsonb_build_object('ok', TRUE, 'changed', FALSE,
                              'delivery_status', v_row.delivery_status);
  END IF;

  UPDATE public.mobile_otp_requests
  SET delivery_status = p_status,
      failure_code    = CASE WHEN p_status = 'failed' THEN v_code ELSE NULL END,
      provider        = coalesce(v_prov, provider)
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', TRUE, 'changed', TRUE, 'delivery_status', p_status);
END;
$$;

COMMENT ON FUNCTION public.record_mobile_otp_delivery(bigint, uuid, text, text, text) IS
  'Service-role-only diagnostic writer: records whether GoTrue accepted (''sent'') or refused (''failed'') the SMS for one request_mobile_otp() attempt, bound to the requesting member. Idempotent, never downgrades a recorded send, never sets verified_at and never touches profiles.mobile_verified. Stores a stable failure code and provider name only — never an OTP value or a credential.';

REVOKE ALL ON FUNCTION public.record_mobile_otp_delivery(bigint, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mobile_otp_delivery(bigint, uuid, text, text, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §4 complete_mobile_otp_verification() — refuse a FAILED delivery window
--    Byte-for-byte the hardened Step 13 function, plus one extra condition.
-- ----------------------------------------------------------------------------
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

  -- Unchanged: a same-number request inside the last ten minutes. Strengthened:
  -- a request whose provider send was RECORDED AS FAILED can never complete.
  IF NOT EXISTS (SELECT 1 FROM public.mobile_otp_requests
                 WHERE user_id = v_user AND mobile = v_mobile
                   AND verified_at IS NULL
                   AND delivery_status IS DISTINCT FROM 'failed'
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
    v_user, 'profile_verified', 'Mobile number verified',
    'Your mobile number is now verified. You can sign in with it from any device.',
    jsonb_build_object('verification_type', 'mobile'),
    '/profile'
  );

  PERFORM public.log_activity(
    v_user, 'mobile_otp_verified',
    jsonb_build_object('method', 'supabase_phone_auth')
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

COMMENT ON FUNCTION public.complete_mobile_otp_verification(uuid, text) IS
  'Service-only completion after the API validates the real provider OTP. Locks and binds the member to the verified mobile and an outstanding request whose delivery was not recorded as FAILED. Still the only path that can set profiles.mobile_verified.';

REVOKE ALL ON FUNCTION public.complete_mobile_otp_verification(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mobile_otp_verification(uuid, text) TO service_role;
