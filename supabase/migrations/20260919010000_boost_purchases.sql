-- ============================================================================
-- Mali Vivah · Phase 1 — standalone paid Profile Boost purchases
--
-- WHAT IT DOES
--   §1 profile_boost_config — single-row admin configuration for the
--      STANDALONE boost add-on: price, duration, active flag. Package-
--      INCLUDED boosts (packages.benefits.boosts_included) are untouched and
--      remain independently configurable.
--   §2 payments.kind — distinguishes 'package' (membership) payments from
--      'boost' (add-on) payments so verify/webhook/refund route correctly.
--      Existing rows backfill to 'package'.
--   §3 profile_boosts.payment_id — links a purchased boost to its verified
--      payment (unique → one payment can never activate two boosts).
--   §4 activate_boost_purchase(p_payment_id) — service-role RPC: the ONLY
--      activation path for purchased boosts. Idempotent per payment; stacks
--      the duration onto a running boost instead of double-selling.
--   §5 refund_membership() extended — refunding a 'boost' payment cancels
--      that boost (and marks the payment refunded) instead of touching a
--      membership.
--
-- SECURITY
--   * Price/duration are read server-side from profile_boost_config; the
--     browser sends only { item: 'boost' }.
--   * Activation happens only after Razorpay signature verification
--     (/api/payments/verify) or the webhook — never on frontend success.
--   * No client grants on profile_boost_config (service role only).
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Boost configuration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_boost_config (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  price_inr     INTEGER NOT NULL DEFAULT 499
                CHECK (price_inr >= 0),
  duration_days SMALLINT NOT NULL DEFAULT 7
                CHECK (duration_days BETWEEN 1 AND 30),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by    UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_boost_config IS
  'Single-row (id=1) configuration for the standalone purchasable Profile Boost. Admin-editable from /admin/boosts (service role); the payment API reads price/duration from here — never from the client.';

DROP TRIGGER IF EXISTS set_profile_boost_config_updated_at ON public.profile_boost_config;
CREATE TRIGGER set_profile_boost_config_updated_at
  BEFORE UPDATE ON public.profile_boost_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.profile_boost_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profile_boost_config ENABLE ROW LEVEL SECURITY;
-- No client grants: reads go through the service role (order API + admin).


-- ----------------------------------------------------------------------------
-- §2 payments.kind
-- ----------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'package';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_check CHECK (kind IN ('package', 'boost'));

COMMENT ON COLUMN public.payments.kind IS
  '''package'' = membership purchase, ''boost'' = standalone Profile Boost add-on. The verify/webhook routes branch on this to activate the right thing.';


-- ----------------------------------------------------------------------------
-- §3 profile_boosts.payment_id
-- ----------------------------------------------------------------------------
ALTER TABLE public.profile_boosts
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profile_boosts.payment_id IS
  'The verified payment that purchased this boost (purchased boosts only; included boosts stay NULL). Unique so one payment can never create two boosts.';

DROP INDEX IF EXISTS public.profile_boosts_one_per_payment_idx;
CREATE UNIQUE INDEX IF NOT EXISTS profile_boosts_one_per_payment_idx
  ON public.profile_boosts (payment_id)
  WHERE payment_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- §4 activate_boost_purchase(p_payment_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_boost_purchase(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay      public.payments%ROWTYPE;
  v_cfg      public.profile_boost_config%ROWTYPE;
  v_active   public.profile_boosts%ROWTYPE;
  v_new_exp  TIMESTAMPTZ;
  v_status   TEXT;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment id required';
  END IF;

  -- Idempotency: this payment already produced a boost → return it.
  SELECT * INTO v_active
  FROM public.profile_boosts b
  WHERE b.payment_id = p_payment_id
  LIMIT 1;
  IF v_active.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_activated',
      'boost_id', v_active.id,
      'expires_at', v_active.expires_at
    );
  END IF;

  SELECT * INTO v_pay FROM public.payments p WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % not found', p_payment_id;
  END IF;
  IF v_pay.kind IS DISTINCT FROM 'boost' THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % is not a boost purchase', p_payment_id;
  END IF;

  SELECT * INTO v_cfg FROM public.profile_boost_config WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_boost_purchase: boost configuration missing';
  END IF;

  UPDATE public.payments
  SET status = 'captured',
      updated_at = now()
  WHERE id = p_payment_id;

  -- A boost already running? Stack the purchased duration onto it instead of
  -- issuing a second live boost (mirrors membership renewal stacking and
  -- prevents a double-charge feeling).
  SELECT * INTO v_active
  FROM public.profile_boosts b
  WHERE b.user_id = v_pay.user_id
    AND b.status = 'active'
    AND b.expires_at > now()
  LIMIT 1;

  IF v_active.id IS NOT NULL THEN
    v_new_exp := v_active.expires_at + make_interval(days => v_cfg.duration_days);
    UPDATE public.profile_boosts
    SET expires_at = v_new_exp,
        payment_id = p_payment_id
    WHERE id = v_active.id;

    -- payment_id unique index: the previous boost's payment link is replaced;
    -- clear the old link so the index stays happy.
    UPDATE public.profile_boosts
    SET payment_id = NULL
    WHERE user_id = v_pay.user_id
      AND payment_id IS NOT NULL
      AND payment_id <> p_payment_id;

    v_status := 'stacked';
  ELSE
    INSERT INTO public.profile_boosts
      (user_id, status, started_at, expires_at, created_via, payment_id)
    VALUES
      (v_pay.user_id, 'active', now(), now() + make_interval(days => v_cfg.duration_days), 'purchase', p_payment_id)
    RETURNING expires_at INTO v_new_exp;

    v_status := 'activated';
  END IF;

  PERFORM public.push_notification(
    v_pay.user_id,
    'admin_message',
    'Profile Boost activated',
    'Your purchased boost is live — your profile appears first in search and browse for the next '
      || v_cfg.duration_days || ' days.',
    jsonb_build_object('duration_days', v_cfg.duration_days),
    '/profile'
  );

  PERFORM public.log_activity(
    v_pay.user_id,
    'boost_purchased',
    jsonb_build_object('payment_id', p_payment_id, 'duration_days', v_cfg.duration_days, 'result', v_status)
  );

  RETURN jsonb_build_object(
    'status', v_status,
    'expires_at', v_new_exp
  );
END;
$$;

COMMENT ON FUNCTION public.activate_boost_purchase(uuid) IS
  'Service-role activation for a verified boost payment: idempotent per payment, stacks onto a running boost, updates the payment to captured, notifies + audit-logs.';

REVOKE ALL ON FUNCTION public.activate_boost_purchase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_boost_purchase(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §5 refund_membership() — branch on payment kind
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_membership(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay  public.payments%ROWTYPE;
  v_user UUID;
BEGIN
  SELECT * INTO v_pay FROM public.payments p WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_membership: payment % not found', p_payment_id;
  END IF;

  UPDATE public.payments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_payment_id;
  v_user := v_pay.user_id;

  IF v_pay.kind = 'boost' THEN
    -- Cancel the boost this payment created (or the currently-running one if
    -- the purchase was stacked onto it).
    UPDATE public.profile_boosts b
    SET status = 'cancelled'
    WHERE b.payment_id = p_payment_id
       OR (b.user_id = v_user AND b.status = 'active' AND b.expires_at > now());

    PERFORM public.push_notification(
      v_user,
      'admin_message',
      'Boost purchase refunded',
      'Your Profile Boost purchase has been refunded and the boost has been removed.',
      '{}'::jsonb,
      '/profile'
    );

    PERFORM public.log_activity(v_user, 'boost_refunded', jsonb_build_object('payment_id', p_payment_id));

    RETURN jsonb_build_object('kind', 'boost', 'status', 'refunded');
  END IF;

  -- Membership refund (existing behaviour, preserved).
  UPDATE public.subscriptions s
  SET status = 'cancelled', updated_at = now()
  WHERE s.payment_id = p_payment_id
    AND s.status = 'active';

  -- The member may still hold another live (stacked) plan; only hide the
  -- profile when no live plan remains.
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

  RETURN jsonb_build_object('kind', 'package', 'status', 'refunded');
END;
$$;

COMMENT ON FUNCTION public.refund_membership(uuid) IS
  'Revokes a captured payment. Membership payments expire the subscription (and hide the profile when no live plan remains); boost payments cancel the boost. Idempotent on refunded rows.';

REVOKE ALL ON FUNCTION public.refund_membership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_membership(uuid) TO service_role;
