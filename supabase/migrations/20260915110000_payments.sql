-- ============================================================================
-- Mali Vivah · Phase 1 — real payments (Razorpay) + subscriptions hardening
-- Migration 6 of the Phase 1 completion pass.
--
-- WHY
--   The old purchase button inserted an `active` subscription straight from
--   the BROWSER ("Demo checkout — activates instantly, no payment needed").
--   That is a privilege-escalation hole: anyone could grant themselves VIP
--   for free with one request. The PRD forbids client-side activation; real
--   activation must come from server-side payment verification.
--
-- WHAT THIS MIGRATION DOES
--   §1 public.payments — one row per Razorpay order/payment attempt:
--      user, package, amount (server-side, from the packages row), razorpay
--      order/payment ids, status lifecycle, membership window, timestamps.
--   §2 subscriptions.payment_id — links a subscription to the payment that
--      created it (unique: a payment activates at most once — idempotency).
--   §3 LOCKDOWN: the browser can no longer INSERT or UPDATE subscriptions.
--      Policies dropped, grants revoked. The only remaining write path is
--      activate_membership() via the service role (webhook / verify route).
--   §4 activity_events — the single product event stream (logins, payments,
--      publishes, interests…). One table, written only by SECURITY DEFINER
--      functions / service role. Nothing else may invent events.
--   §5 activate_membership() — service-role-only RPC the payment routes call
--      AFTER cryptographic verification. Creates the subscription (stacking
--      renewals), flips the profile to 'active', or — when the publish gate
--      rejects (e.g. missing family photo) — falls back to 'hidden' and tells
--      the member exactly what is missing. The payment itself NEVER fails.
--   §6 refund_membership() — revokes a subscription when Razorpay reports a
--      refund (webhook), and sweeps the profile visibility.
--   §7 cancel_stale_payments() — orders the member abandoned (closed the
--      checkout tab) are marked 'cancelled' after 24h so they don't clutter
--      the admin payment list.
--
-- PAYMENT FLOW (app side)
--   1. Browser → POST /api/payments/order { slug } (NO amount — never).
--   2. Server reads price_inr from packages, creates payments row ('created'),
--      creates the Razorpay order via REST (Basic auth), stores the order id.
--   3. Browser completes Razorpay Standard Checkout.
--   4. Razorpay webhook (authoritative) → signature check (HMAC-SHA256 over
--      raw body) → payments 'captured' → activate_membership().
--   5. Checkout success handler → POST /api/payments/verify → server re-signs
--      order_id|payment_id with the secret and compares — activate only on a
--      match (covers webhook delay / closed-tab-after-pay via the return to
--      /packages?payment=success). The frontend alone NEVER activates.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260915100000_visibility.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 payments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id             BIGINT REFERENCES public.packages (id) ON DELETE SET NULL,
  package_slug           TEXT,
  -- Amount in whole INR as read from public.packages SERVER-SIDE.
  amount_inr             INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'INR',
  status                 public.payment_status NOT NULL DEFAULT 'created',
  razorpay_order_id      TEXT UNIQUE,
  razorpay_payment_id    TEXT UNIQUE,
  failure_reason         TEXT,
  membership_started_at  TIMESTAMPTZ,
  membership_expires_at  TIMESTAMPTZ,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT payments_amount_nonneg CHECK (amount_inr >= 0)
);

COMMENT ON TABLE public.payments IS
  'One row per payment attempt (Razorpay order). The amount is decided server-side from the packages row — never supplied by the browser. Status lifecycle: created → captured / failed / cancelled; captured may become refunded.';


CREATE INDEX IF NOT EXISTS payments_user_idx ON public.payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_created_idx ON public.payments (created_at DESC);

DROP TRIGGER IF EXISTS set_payments_updated_at ON public.payments;
CREATE TRIGGER set_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Members may only SEE their own payment attempts. Writing payments is the
-- service role's job (order creation + webhook). No INSERT/UPDATE grants.
GRANT SELECT ON public.payments TO authenticated;

DROP POLICY IF EXISTS "Owner reads own payments" ON public.payments;
CREATE POLICY "Owner reads own payments"
  ON public.payments FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- §2 subscriptions.payment_id (+ backfill-safe unique index)
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.subscriptions.payment_id IS
  'The verified payment that created this subscription. Unique: one payment activates at most once (webhook + verify retries stay idempotent).';

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_per_payment_idx
  ON public.subscriptions (payment_id)
  WHERE payment_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- §3 LOCKDOWN — the browser can no longer grant itself a subscription
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owner creates own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Owner updates own subscription" ON public.subscriptions;

REVOKE INSERT ON public.subscriptions FROM authenticated;
REVOKE UPDATE ON public.subscriptions FROM authenticated;

-- (SELECT stays: members still READ their own subscriptions for the dashboard.
--  All writes now flow through the service role after payment verification.)


-- ----------------------------------------------------------------------------
-- §4 activity_events — the single product event stream
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  event      TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.activity_events IS
  'The single product analytics event stream (registered, logged_in, profile_published, payment_created/captured, interest_sent, moment_posted…). One table for everything — written only via log_activity() / service role; readable by the owner and admins.';

CREATE INDEX IF NOT EXISTS activity_events_user_idx ON public.activity_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_event_idx ON public.activity_events (event, created_at DESC);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.activity_events TO authenticated;

DROP POLICY IF EXISTS "Owner reads own activity" ON public.activity_events;
CREATE POLICY "Owner reads own activity"
  ON public.activity_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id UUID,
  p_event   TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_meta JSONB := coalesce(p_metadata, '{}'::jsonb);
  v_scrubbed JSONB;
  k TEXT;
BEGIN
  IF p_user_id IS NULL OR nullif(btrim(p_event), '') IS NULL THEN
    RETURN NULL;
  END IF;
  -- Same hygiene as push_notification(): never store contact-bearing keys.
  v_scrubbed := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(v_meta)
  LOOP
    IF lower(k) ~ '(phone|mobile|email|contact|address|password|token|signature)' THEN
      CONTINUE;
    END IF;
    v_scrubbed := v_scrubbed || jsonb_build_object(k, v_meta -> k);
  END LOOP;
  INSERT INTO public.activity_events (user_id, event, metadata) VALUES (p_user_id, btrim(p_event), v_scrubbed)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_activity(uuid, text, jsonb) IS
  'Appends one activity_events row. SECURITY DEFINER; EXECUTE limited to service_role so the browser cannot fabricate analytics. Scrubs contact/credential keys from metadata.';

REVOKE ALL ON FUNCTION public.log_activity(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(uuid, text, jsonb) TO service_role;


-- ----------------------------------------------------------------------------
-- §5 activate_membership() — the ONLY way a subscription is created now
--    Service-role only. Idempotent by payment.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_membership(
  p_user_id    UUID,
  p_package_id BIGINT,
  p_payment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg      public.packages%ROWTYPE;
  v_started  TIMESTAMPTZ := now();
  v_expires  TIMESTAMPTZ;
  v_base     TIMESTAMPTZ;
  v_sub_id   BIGINT;
  v_missing  TEXT;
  v_status   public.profile_status;
  v_pay      RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'activate_membership: user id required';
  END IF;

  -- Idempotency: this payment already activated a subscription → return it.
  IF p_payment_id IS NOT NULL THEN
    SELECT s.id, s.expires_at INTO v_sub_id, v_expires
    FROM public.subscriptions s
    WHERE s.payment_id = p_payment_id
    LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'subscription_id', v_sub_id, 'expires_at', v_expires,
        'status', 'already_activated'
      );
    END IF;
  END IF;

  SELECT * INTO v_pkg FROM public.packages p WHERE p.id = p_package_id;
  IF NOT FOUND OR v_pkg.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'activate_membership: package % not found or inactive', p_package_id;
  END IF;

  -- Renewal stacking: a live plan keeps its remaining days — the new plan
  -- starts where the current one ends.
  SELECT max(s.expires_at) INTO v_base
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND s.expires_at > now();
  v_base := greatest(v_started, coalesce(v_base, v_started));
  v_expires := v_base + make_interval(days => v_pkg.duration_days);

  INSERT INTO public.subscriptions
    (user_id, package_id, package_slug, status, started_at, expires_at, payment_id)
  VALUES
    (p_user_id, v_pkg.id, v_pkg.slug, 'active', v_started, v_expires, p_payment_id)
  RETURNING id INTO v_sub_id;

  IF p_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET status = 'captured',
        membership_started_at = v_started,
        membership_expires_at = v_expires,
        updated_at = now()
    WHERE id = p_payment_id;
  END IF;

  -- Publish attempt: complete profiles go 'active'; if the publish gate
  -- rejects (e.g. missing family photo after payment) we fall back to
  -- 'hidden' and tell the member exactly what to fix — the payment succeeded
  -- and the membership must go live regardless.
  BEGIN
    UPDATE public.matrimony_profiles mp
    SET status = 'active', updated_at = now()
    WHERE mp.user_id = p_user_id
      AND mp.status IN ('draft', 'hidden', 'expired', 'pending_review');
  EXCEPTION WHEN OTHERS THEN
    v_missing := SQLERRM;
  END;

  SELECT mp.status INTO v_status FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;

  PERFORM public.push_notification(
    p_user_id,
    'payment_received',
    'Payment received — welcome aboard',
    format('Your %s membership is active till %s.',
           v_pkg.name,
           to_char(v_expires AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')),
    jsonb_build_object('package_slug', v_pkg.slug, 'subscription_id', v_sub_id, 'amount_inr', v_pkg.price_inr),
    '/packages'
  );

  IF v_missing IS NOT NULL OR v_status IS DISTINCT FROM 'active' THEN
    PERFORM public.push_notification(
      p_user_id,
      'admin_message',
      'One more step to go live',
      'Your membership is active but your profile is not public yet — '
        || coalesce(regexp_replace(coalesce(v_missing, ''), '^PROFILE_INCOMPLETE: ?', 'Complete your profile and add: '), 'complete your profile')
        || '. Open the profile wizard to finish.',
      jsonb_build_object('profile_status', coalesce(v_status::text, 'draft')),
      '/profile/edit'
    );
  END IF;

  PERFORM public.log_activity(
    p_user_id,
    'membership_activated',
    jsonb_build_object('package_slug', v_pkg.slug, 'subscription_id', v_sub_id,
                       'expires_at', v_expires, 'profile_status', coalesce(v_status::text, 'draft'))
  );

  RETURN jsonb_build_object(
    'subscription_id', v_sub_id,
    'package_slug', v_pkg.slug,
    'started_at', v_started,
    'expires_at', v_expires,
    'profile_status', coalesce(v_status::text, 'draft'),
    'publish_note', v_missing,
    'status', 'activated'
  );
END;
$$;

COMMENT ON FUNCTION public.activate_membership(uuid, bigint, uuid) IS
  'Creates a subscription after server-side payment verification (the ONLY subscription write path). Stacks renewals, activates the profile (falls back to hidden + a what-is-missing notification when the publish gate rejects — the payment never fails). Idempotent per payment.';

REVOKE ALL ON FUNCTION public.activate_membership(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_membership(uuid, bigint, uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6 refund_membership() — Razorpay refund.revokes a captured payment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_membership(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID;
BEGIN
  UPDATE public.payments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_payment_id
  RETURNING user_id INTO v_user;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE public.subscriptions
  SET status = 'cancelled', updated_at = now()
  WHERE payment_id = p_payment_id
    AND status = 'active';

  -- The member may still have another live plan (stacked). Whatever is left
  -- decides visibility; otherwise the profile drops out of the directory.
  IF NOT public.has_live_membership(v_user) THEN
    UPDATE public.matrimony_profiles mp
    SET status = 'hidden', updated_at = now()
    WHERE mp.user_id = v_user AND mp.status = 'active';
  END IF;

  PERFORM public.push_notification(
    v_user,
    'payment_received',
    'Your payment was refunded',
    'The refunded membership has been revoked. If this was unexpected, contact support.',
    jsonb_build_object('payment_id', p_payment_id),
    '/packages'
  );
  PERFORM public.log_activity(v_user, 'membership_refunded', jsonb_build_object('payment_id', p_payment_id));

  RETURN jsonb_build_object('status', 'refunded');
END;
$$;

COMMENT ON FUNCTION public.refund_membership(uuid) IS
  'Marks the payment refunded, cancels the subscription it created and hides the profile unless another live plan remains. Service role only (Razorpay refund webhook).';

REVOKE ALL ON FUNCTION public.refund_membership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_membership(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §7 cancel_stale_payments() — abandoned checkouts → 'cancelled' after 24h
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_stale_payments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE public.payments
  SET status = 'cancelled', updated_at = now()
  WHERE status = 'created'
    AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.cancel_stale_payments() IS
  'Marks payments still ''created'' after 24h as cancelled (member closed the checkout). Called lazily by the order route; safe to call any time.';

REVOKE ALL ON FUNCTION public.cancel_stale_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stale_payments() TO service_role;
