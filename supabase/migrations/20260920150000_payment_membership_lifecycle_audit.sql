-- ============================================================================
-- Mali Vivah · Step 12 — Razorpay + membership lifecycle production audit
--
-- This migration hardens the existing payment model without changing products:
--   • package / amount / currency snapshots are checked in the database;
--   • payment-backed subscriptions must point at the same user and package;
--   • lifecycle transitions are explicit (created/authorized/captured/failed/
--     cancelled/refunded);
--   • activation, boost activation and refunds lock the relevant member/payment
--     and are idempotent under webhook + checkout races;
--   • payment activity idempotency is backed by a unique index;
--   • signed webhook identities are retained without storing raw payloads.
--
-- The Razorpay API remains the provider. The browser remains untrusted. The
-- service role is the server-side control plane; authenticated and anon users
-- cannot execute payment mutation RPCs.
--
-- Depends on every migration through 20260920140000.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Provider event identity / replay ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  event_id             TEXT PRIMARY KEY,
  event_type           TEXT NOT NULL,
  razorpay_order_id    TEXT,
  razorpay_payment_id  TEXT,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_webhook_events IS
  'Deduplication ledger for valid Razorpay webhook deliveries. Stores provider event identity only; raw signed payloads and secrets are never persisted.';

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.payment_webhook_events TO service_role;


-- ----------------------------------------------------------------------------
-- §2 Payment attempt idempotency + database lifecycle constraints
-- ----------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS duration_days SMALLINT;

COMMENT ON COLUMN public.payments.idempotency_key IS
  'Opaque checkout-attempt key supplied by the signed-in browser and scoped by user/kind. It deduplicates retried order creation; it is not an entitlement authority.';
COMMENT ON COLUMN public.payments.duration_days IS
  'Immutable server snapshot of the package or boost duration used by this payment; legacy rows may be NULL.';

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_idx
  ON public.payments (user_id, kind, idempotency_key)
  WHERE user_id IS NOT NULL AND idempotency_key IS NOT NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_currency_inr_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_currency_inr_check CHECK (currency = 'INR');


-- A payment row is a server-created snapshot. New package/boost attempts must
-- match the active database configuration, including amount and duration. Legacy captured rows without a
-- package snapshot remain readable for the Step 11 financial-retention model;
-- they can never be used by activate_membership() because that RPC requires a
-- concrete package relationship.
CREATE OR REPLACE FUNCTION public.validate_payment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package RECORD;
  v_boost   RECORD;
BEGIN
  -- Once a server-created attempt has its immutable package/amount snapshot,
  -- provider state changes must remain writable even if an operator later
  -- retires the package or changes the boost sale toggle. Order creation is
  -- where purchasability and pricing are checked. Account deletion's NULL
  -- detach is also an intentional immutable-ledger update.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NULL
     AND OLD.user_id IS NOT NULL
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.package_id IS NOT DISTINCT FROM OLD.package_id
     AND NEW.package_slug IS NOT DISTINCT FROM OLD.package_slug
     AND NEW.amount_inr IS NOT DISTINCT FROM OLD.amount_inr
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.duration_days IS NOT DISTINCT FROM OLD.duration_days
     AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.package_id IS NOT DISTINCT FROM OLD.package_id
     AND NEW.package_slug IS NOT DISTINCT FROM OLD.package_slug
     AND NEW.amount_inr IS NOT DISTINCT FROM OLD.amount_inr
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.duration_days IS NOT DISTINCT FROM OLD.duration_days
     AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key
  THEN
    RETURN NEW;
  END IF;

  IF NEW.currency IS DISTINCT FROM 'INR' THEN
    RAISE EXCEPTION 'PAYMENT_CURRENCY_INVALID: only INR payments are supported';
  END IF;

  -- Account deletion detaches the retained ledger row. That update is allowed
  -- and must not attempt to validate a profile that no longer exists.
  IF NEW.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.is_active = TRUE)
  THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_INACTIVE: payment attempts require an active account';
  END IF;

  IF NEW.kind = 'package' THEN
    IF NEW.package_id IS NULL THEN
      -- A few pre-Step-12 internal fixtures stored only the immutable slug.
      -- Validate that legacy shape against the live package too; new order
      -- creation always stores both package_id and package_slug. A captured
      -- row with neither is retained history, never an activation token.
      IF NEW.package_slug IS NOT NULL THEN
        SELECT p.id, p.slug, p.price_inr, p.duration_days, p.is_active
        INTO v_package
        FROM public.packages p
        WHERE p.slug = NEW.package_slug;
        IF NOT FOUND OR v_package.is_active IS DISTINCT FROM TRUE THEN
          RAISE EXCEPTION 'PAYMENT_PACKAGE_INVALID: package is missing or not purchasable';
        END IF;
        IF NEW.amount_inr IS DISTINCT FROM v_package.price_inr THEN
          RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH: amount must come from the package record';
        END IF;
        IF NEW.duration_days IS NOT NULL AND NEW.duration_days IS DISTINCT FROM v_package.duration_days THEN
          RAISE EXCEPTION 'PAYMENT_DURATION_MISMATCH: duration must come from the package record';
        END IF;
      ELSIF NEW.status NOT IN ('captured', 'refunded') THEN
        RAISE EXCEPTION 'PAYMENT_PACKAGE_REQUIRED: package payment must name its package';
      END IF;
    ELSE
      SELECT p.id, p.slug, p.price_inr, p.duration_days, p.is_active
      INTO v_package
      FROM public.packages p
      WHERE p.id = NEW.package_id;

      IF NOT FOUND OR v_package.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'PAYMENT_PACKAGE_INVALID: package is missing or not purchasable';
      END IF;
      IF NEW.package_slug IS DISTINCT FROM v_package.slug THEN
        RAISE EXCEPTION 'PAYMENT_PACKAGE_MISMATCH: package slug does not match package id';
      END IF;
      IF NEW.amount_inr IS DISTINCT FROM v_package.price_inr THEN
        RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH: amount must come from the package record';
      END IF;
      IF NEW.duration_days IS NOT NULL AND NEW.duration_days IS DISTINCT FROM v_package.duration_days THEN
        RAISE EXCEPTION 'PAYMENT_DURATION_MISMATCH: duration must come from the package record';
      END IF;
    END IF;
  ELSIF NEW.kind = 'boost' THEN
    IF NEW.package_id IS NOT NULL OR NEW.package_slug IS NOT NULL THEN
      RAISE EXCEPTION 'PAYMENT_KIND_MISMATCH: a boost payment cannot name a membership package';
    END IF;
    SELECT c.price_inr, c.duration_days, c.is_active INTO v_boost
    FROM public.profile_boost_config c
    WHERE c.id = 1;
    -- is_active gates NEW SALES in the order route. A payment row that was
    -- already created before an operator switch is still honourable, so this
    -- database snapshot check deliberately validates the configured price but
    -- does not reject on the current sale toggle.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOST_CONFIG_MISSING: standalone boost configuration is missing';
    END IF;
    IF NEW.amount_inr IS DISTINCT FROM v_boost.price_inr THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH: amount must come from boost configuration';
    END IF;
    IF NEW.duration_days IS NOT NULL AND NEW.duration_days IS DISTINCT FROM v_boost.duration_days THEN
      RAISE EXCEPTION 'PAYMENT_DURATION_MISMATCH: duration must come from boost configuration';
    END IF;
  ELSE
    RAISE EXCEPTION 'PAYMENT_KIND_INVALID: unknown payment kind';
  END IF;

  IF NEW.idempotency_key IS NOT NULL
     AND (char_length(btrim(NEW.idempotency_key)) < 8 OR char_length(NEW.idempotency_key) > 128)
  THEN
    RAISE EXCEPTION 'PAYMENT_IDEMPOTENCY_KEY_INVALID: expected an opaque key between 8 and 128 characters';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_payments_snapshot ON public.payments;
CREATE TRIGGER validate_payments_snapshot
  BEFORE INSERT OR UPDATE OF user_id, kind, package_id, package_slug, amount_inr, currency, duration_days, status, idempotency_key
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_snapshot();


-- Explicit state machine. Replays are allowed to write the same state, but a
-- failed/cancelled/refunded payment can never become a newly successful one.
CREATE OR REPLACE FUNCTION public.validate_payment_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'created'   AND NEW.status IN ('authorized', 'captured', 'failed', 'cancelled', 'refunded'))
     OR (OLD.status = 'authorized' AND NEW.status IN ('captured', 'failed', 'cancelled', 'refunded'))
     OR (OLD.status = 'captured'  AND NEW.status = 'refunded')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'PAYMENT_STATE_TRANSITION_INVALID: % → %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS validate_payments_status_transition ON public.payments;
CREATE TRIGGER validate_payments_status_transition
  BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_status_transition();


-- A subscription created by a payment can only consume that exact payment.
-- Manual admin activation intentionally remains the existing payment_id=NULL
-- path and is audited by the admin action layer.
CREATE OR REPLACE FUNCTION public.validate_subscription_payment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_package RECORD;
BEGIN
  -- Step 11 detachment: retained subscriptions deliberately become orphaned.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.is_active = TRUE) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCOUNT_INACTIVE: inactive/deleted accounts cannot gain membership';
  END IF;

  IF NEW.package_id IS NULL THEN
    RAISE EXCEPTION 'SUBSCRIPTION_PACKAGE_REQUIRED: every new subscription needs a package';
  END IF;

  SELECT p.id, p.slug INTO v_package
  FROM public.packages p
  WHERE p.id = NEW.package_id;
  IF NOT FOUND OR NEW.package_slug IS DISTINCT FROM v_package.slug THEN
    RAISE EXCEPTION 'SUBSCRIPTION_PACKAGE_MISMATCH: package id and slug do not match';
  END IF;

  IF NEW.payment_id IS NOT NULL THEN
    SELECT p.user_id, p.package_id, p.package_slug, p.kind, p.status,
           p.currency, p.razorpay_payment_id
    INTO v_payment
    FROM public.payments p
    WHERE p.id = NEW.payment_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SUBSCRIPTION_PAYMENT_NOT_FOUND: payment does not exist';
    END IF;
    IF v_payment.user_id IS DISTINCT FROM NEW.user_id
       OR v_payment.package_id IS DISTINCT FROM NEW.package_id
       OR v_payment.package_slug IS DISTINCT FROM NEW.package_slug
       OR v_payment.kind IS DISTINCT FROM 'package'
       OR v_payment.currency IS DISTINCT FROM 'INR'
    THEN
      RAISE EXCEPTION 'SUBSCRIPTION_PAYMENT_MISMATCH: payment belongs to another user or package';
    END IF;
    IF v_payment.status IS DISTINCT FROM 'captured' THEN
      RAISE EXCEPTION 'SUBSCRIPTION_PAYMENT_NOT_CAPTURED: payment must be captured first';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_subscription_payment_link ON public.subscriptions;
CREATE TRIGGER validate_subscription_payment_link
  BEFORE INSERT OR UPDATE OF user_id, package_id, package_slug, payment_id
  ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.validate_subscription_payment_link();


-- ----------------------------------------------------------------------------
-- §3 Idempotent activity events are database-backed, not scan-only
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS activity_events_idempotency_idx
  ON public.activity_events (user_id, event, (metadata ->> '__idkey'))
  WHERE metadata ? '__idkey';

DROP FUNCTION IF EXISTS public.log_activity(UUID, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id         UUID,
  p_event           TEXT,
  p_metadata        JSONB DEFAULT '{}'::jsonb,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       BIGINT;
  v_meta     JSONB := coalesce(p_metadata, '{}'::jsonb);
  v_scrubbed JSONB;
  k          TEXT;
  v_lower    TEXT;
BEGIN
  IF p_user_id IS NULL OR nullif(btrim(p_event), '') IS NULL THEN
    RETURN NULL;
  END IF;

  IF nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NOT NULL THEN
    p_idempotency_key := btrim(p_idempotency_key);
    v_meta := v_meta || jsonb_build_object('__idkey', p_idempotency_key);
  ELSE
    p_idempotency_key := NULL;
  END IF;

  v_scrubbed := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(v_meta)
  LOOP
    v_lower := lower(k);
    IF v_lower ~ '(phone|mobile|email|contact|address|password|secret|token|signature|card|cvv|otp)'
       AND k <> '__idkey'
    THEN
      CONTINUE;
    END IF;
    v_scrubbed := v_scrubbed || jsonb_build_object(k, v_meta -> k);
  END LOOP;

  IF p_idempotency_key IS NULL THEN
    INSERT INTO public.activity_events (user_id, event, metadata)
    VALUES (p_user_id, btrim(p_event), v_scrubbed)
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.activity_events (user_id, event, metadata)
    VALUES (p_user_id, btrim(p_event), v_scrubbed)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT e.id INTO v_id
      FROM public.activity_events e
      WHERE e.user_id = p_user_id
        AND e.event = btrim(p_event)
        AND e.metadata ->> '__idkey' = p_idempotency_key
      LIMIT 1;
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_activity(uuid, text, jsonb, text) IS
  'SECURITY DEFINER activity writer. Sensitive metadata keys are scrubbed and supplied idempotency keys are protected by a unique database index, so concurrent webhook retries cannot duplicate payment/entitlement events.';

REVOKE ALL ON FUNCTION public.log_activity(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(uuid, text, jsonb, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §4 Membership activation — authoritative relationship + member lock
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
  v_pkg        public.packages%ROWTYPE;
  v_profile    public.profiles%ROWTYPE;
  v_pay        public.payments%ROWTYPE;
  v_started    TIMESTAMPTZ := now();
  v_expires    TIMESTAMPTZ;
  v_base       TIMESTAMPTZ;
  v_duration_days SMALLINT;
  v_sub_id     BIGINT;
  v_missing    TEXT;
  v_status     public.profile_status;
  v_is_renewal BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR p_package_id IS NULL THEN
    RAISE EXCEPTION 'activate_membership: user and package are required';
  END IF;

  -- Serialises verification/webhook/admin races for one account. The lock is
  -- transaction-scoped and therefore also protects the retry check below.
  PERFORM pg_advisory_xact_lock(hashtext('membership:' || p_user_id::text));

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'MEMBERSHIP_ACCOUNT_INACTIVE: deleted/deactivated accounts cannot be activated';
  END IF;

  SELECT * INTO v_pkg FROM public.packages p WHERE p.id = p_package_id;
  IF NOT FOUND OR v_pkg.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'activate_membership: package % not found or inactive', p_package_id;
  END IF;
  v_duration_days := v_pkg.duration_days;

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_pay
    FROM public.payments p
    WHERE p.id = p_payment_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'activate_membership: payment % not found', p_payment_id;
    END IF;
    IF v_pay.user_id IS DISTINCT FROM p_user_id
       OR v_pay.kind IS DISTINCT FROM 'package'
       OR v_pay.package_id IS DISTINCT FROM p_package_id
       OR v_pay.package_slug IS DISTINCT FROM v_pkg.slug
       OR v_pay.currency IS DISTINCT FROM 'INR'
    THEN
      RAISE EXCEPTION 'activate_membership: payment/user/package relationship mismatch';
    END IF;
    IF v_pay.status IN ('failed', 'cancelled', 'refunded') THEN
      RAISE EXCEPTION 'activate_membership: payment is not payable (%).', v_pay.status;
    END IF;

    -- The API/webhook has already cryptographically validated the provider
    -- result before it invokes this service-role RPC. The DB still requires a
    -- usable local order and the package snapshot; it never trusts a client
    -- amount or package argument.
    IF v_pay.razorpay_order_id IS NULL THEN
      RAISE EXCEPTION 'activate_membership: local Razorpay order is missing';
    END IF;
    IF v_pay.duration_days IS NOT NULL THEN
      v_duration_days := v_pay.duration_days;
    END IF;

    -- Retry check happens after relationship validation and row lock. Replaying
    -- one payment therefore returns the original subscription and cannot stack
    -- another period.
    SELECT s.id, s.expires_at INTO v_sub_id, v_expires
    FROM public.subscriptions s
    WHERE s.payment_id = p_payment_id
    LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      RETURN jsonb_build_object('subscription_id', v_sub_id, 'expires_at', v_expires, 'status', 'already_activated');
    END IF;
  END IF;

  -- Renewal stacking is the existing product behaviour: a live plan keeps its
  -- remaining time and the new package starts after it.
  SELECT max(s.expires_at) INTO v_base
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND s.expires_at > now();
  v_base := greatest(v_started, coalesce(v_base, v_started));
  v_is_renewal := v_base > v_started;
  v_expires := v_base + make_interval(days => v_duration_days);

  -- Mark the validated payment captured before the subscription insert. The
  -- subscription trigger can now enforce the captured-payment relationship.
  IF p_payment_id IS NOT NULL AND v_pay.status IS DISTINCT FROM 'captured' THEN
    UPDATE public.payments
    SET status = 'captured', updated_at = now()
    WHERE id = p_payment_id;
  END IF;

  INSERT INTO public.subscriptions
    (user_id, package_id, package_slug, status, started_at, expires_at, payment_id)
  VALUES
    (p_user_id, v_pkg.id, v_pkg.slug, 'active', v_started, v_expires, p_payment_id)
  RETURNING id INTO v_sub_id;

  IF p_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET membership_started_at = v_started,
        membership_expires_at = v_expires,
        updated_at = now()
    WHERE id = p_payment_id;

    PERFORM public.log_activity(
      p_user_id,
      'payment_captured',
      jsonb_build_object('payment_id', p_payment_id, 'package_slug', v_pkg.slug,
                         'kind', 'package', 'amount_inr', v_pay.amount_inr),
      'paycap:' || p_payment_id::text
    );
  END IF;

  -- Payment success does not silently rewrite unrelated profile data. It only
  -- uses the existing publish gate's status transition.
  BEGIN
    UPDATE public.matrimony_profiles mp
    SET status = 'active', updated_at = now()
    WHERE mp.user_id = p_user_id
      AND mp.status IN ('draft', 'hidden', 'expired', 'pending_review');
  EXCEPTION WHEN OTHERS THEN
    v_missing := SQLERRM;
  END;

  SELECT mp.status INTO v_status
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = p_user_id;

  PERFORM public.push_notification(
    p_user_id, 'payment_received', 'Payment received — welcome aboard',
    format('Your %s membership is active till %s.', v_pkg.name,
           to_char(v_expires AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')),
    jsonb_build_object('package_slug', v_pkg.slug, 'subscription_id', v_sub_id,
                       'amount_inr', v_pkg.price_inr), '/packages'
  );

  IF v_missing IS NOT NULL OR v_status IS DISTINCT FROM 'active' THEN
    PERFORM public.push_notification(
      p_user_id, 'admin_message', 'One more step to go live',
      'Your membership is active but your profile is not public yet — '
        || coalesce(regexp_replace(coalesce(v_missing, ''), '^PROFILE_INCOMPLETE: ?', 'Complete your profile and add: '), 'complete your profile')
        || '. Open the profile wizard to finish.',
      jsonb_build_object('profile_status', coalesce(v_status::text, 'draft')), '/profile/edit'
    );
  END IF;

  PERFORM public.log_activity(
    p_user_id, 'membership_activated',
    jsonb_build_object('package_slug', v_pkg.slug, 'subscription_id', v_sub_id,
                       'expires_at', v_expires,
                       'profile_status', coalesce(v_status::text, 'draft'),
                       'renewal', v_is_renewal),
    CASE WHEN p_payment_id IS NOT NULL THEN 'sub:' || p_payment_id::text ELSE NULL END
  );

  IF v_is_renewal THEN
    PERFORM public.log_activity(
      p_user_id, 'membership_renewed',
      jsonb_build_object('package_slug', v_pkg.slug, 'subscription_id', v_sub_id,
                         'expires_at', v_expires),
      'renew:' || v_sub_id::text
    );
  END IF;

  RETURN jsonb_build_object(
    'subscription_id', v_sub_id, 'package_slug', v_pkg.slug,
    'started_at', v_started, 'expires_at', v_expires,
    'profile_status', coalesce(v_status::text, 'draft'),
    'publish_note', v_missing, 'status', 'activated'
  );
END;
$$;

COMMENT ON FUNCTION public.activate_membership(uuid, bigint, uuid) IS
  'Service-role-only membership activation. Validates active user, active DB package, local payment ownership/kind/package/order/status, locks the member, and is idempotent per payment. Null payment_id remains the audited manual-admin activation path.';

REVOKE ALL ON FUNCTION public.activate_membership(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_membership(uuid, bigint, uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §5 Purchased boost activation — shared payment security + member lock
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_boost_purchase(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay      public.payments%ROWTYPE;
  v_ent      RECORD;
  v_live     RECORD;
  v_days     SMALLINT;
  v_now      TIMESTAMPTZ := now();
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ;
  v_boost_id BIGINT;
  v_ent_id   BIGINT;
  v_status   TEXT;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment id required';
  END IF;

  -- First learn the owner, then serialize every purchase/refund/retry for it.
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % not found', p_payment_id;
  END IF;
  IF v_pay.user_id IS NULL THEN
    RAISE EXCEPTION 'activate_boost_purchase: account is deleted';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || v_pay.user_id::text));

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_pay.kind IS DISTINCT FROM 'boost' THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % is not a boost purchase', p_payment_id;
  END IF;
  IF v_pay.status = 'refunded' THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % was refunded', p_payment_id;
  END IF;
  IF v_pay.status IN ('failed', 'cancelled') THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % is not payable (%)', p_payment_id, v_pay.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_pay.user_id AND p.is_active = TRUE) THEN
    RAISE EXCEPTION 'activate_boost_purchase: account is inactive';
  END IF;

  -- Check after the lock, so concurrent identical deliveries see one ledger
  -- row and return it rather than extending the period again.
  SELECT e.id, e.boost_id, b.expires_at INTO v_ent
  FROM public.profile_boost_entitlements e
  JOIN public.profile_boosts b ON b.id = e.boost_id
  WHERE e.payment_id = p_payment_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_activated', 'boost_id', v_ent.boost_id,
                              'entitlement_id', v_ent.id, 'expires_at', v_ent.expires_at);
  END IF;

  v_days := coalesce(v_pay.duration_days, public.boost_duration_days());

  IF v_pay.status IS DISTINCT FROM 'captured' THEN
    UPDATE public.payments SET status = 'captured', updated_at = v_now WHERE id = p_payment_id;
  END IF;

  SELECT b.id, b.expires_at INTO v_live
  FROM public.profile_boosts b
  WHERE b.user_id = v_pay.user_id AND b.status = 'active' AND b.expires_at > v_now
  ORDER BY b.expires_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_boost_id := v_live.id;
    v_start := v_live.expires_at;
    v_end := v_start + make_interval(days => v_days);
    UPDATE public.profile_boosts SET expires_at = v_end WHERE id = v_boost_id;
    v_status := 'stacked';
  ELSE
    v_start := v_now;
    v_end := v_now + make_interval(days => v_days);
    INSERT INTO public.profile_boosts (user_id, status, started_at, expires_at, created_via)
    VALUES (v_pay.user_id, 'active', v_start, v_end, 'purchase')
    RETURNING id INTO v_boost_id;
    v_status := 'activated';
  END IF;

  INSERT INTO public.profile_boost_entitlements
    (user_id, boost_id, source, payment_id, duration_days, starts_at, ends_at)
  VALUES (v_pay.user_id, v_boost_id, 'purchase', p_payment_id, v_days, v_start, v_end)
  RETURNING id INTO v_ent_id;

  PERFORM public.log_activity(
    v_pay.user_id, 'payment_captured',
    jsonb_build_object('payment_id', p_payment_id, 'kind', 'boost', 'amount_inr', v_pay.amount_inr),
    'paycap:' || p_payment_id::text
  );
  PERFORM public.push_notification(
    v_pay.user_id, 'admin_message', 'Profile Boost activated',
    CASE WHEN v_status = 'stacked'
      THEN 'Your purchased ' || v_days || '-day boost has been added to your running boost — your profile stays first in search and browse till '
           || to_char(v_end AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.'
      ELSE 'Your purchased boost is live — your profile appears first in search and browse for the next '
           || v_days || ' days (till ' || to_char(v_end AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || ').'
    END,
    jsonb_build_object('duration_days', v_days, 'expires_at', v_end, 'boost_id', v_boost_id,
                       'entitlement_id', v_ent_id), '/profile'
  );
  PERFORM public.log_activity(
    v_pay.user_id, 'boost_purchased',
    jsonb_build_object('payment_id', p_payment_id, 'boost_id', v_boost_id,
                       'entitlement_id', v_ent_id, 'duration_days', v_days,
                       'expires_at', v_end, 'result', v_status),
    'boostbuy:' || p_payment_id::text
  );
  IF v_status = 'activated' THEN
    PERFORM public.log_activity(
      v_pay.user_id, 'boost_activated',
      jsonb_build_object('boost_id', v_boost_id, 'entitlement_id', v_ent_id,
                         'source', 'purchase', 'duration_days', v_days,
                         'expires_at', v_end),
      'boostact:' || v_boost_id::text
    );
  END IF;

  RETURN jsonb_build_object('status', v_status, 'boost_id', v_boost_id,
                            'entitlement_id', v_ent_id, 'duration_days', v_days,
                            'expires_at', v_end);
END;
$$;

COMMENT ON FUNCTION public.activate_boost_purchase(uuid) IS
  'Service-role-only boost activation after a validated Razorpay payment. Locks the member, validates the local boost payment, appends one entitlement and is idempotent per payment.';

REVOKE ALL ON FUNCTION public.activate_boost_purchase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_boost_purchase(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6 Refund processing — exact-payment revocation + replay safety
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_membership(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay          public.payments%ROWTYPE;
  v_user         UUID;
  v_ent          public.profile_boost_entitlements%ROWTYPE;
  v_has_ent      BOOLEAN;
  v_now          TIMESTAMPTZ := now();
  v_unconsumed   INTERVAL;
  v_period       RECORD;
  v_period_status TEXT;
  v_prior_status public.payment_status;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'refund_membership: payment id required';
  END IF;

  -- Take the member lock before the payment lock when possible, matching both
  -- activation functions and eliminating a refund/activation double-extension.
  SELECT user_id INTO v_user FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_membership: payment % not found', p_payment_id;
  END IF;
  IF v_user IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('membership:' || v_user::text));
    PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || v_user::text));
  END IF;

  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  v_prior_status := v_pay.status;

  IF v_prior_status = 'refunded' THEN
    RETURN jsonb_build_object('kind', v_pay.kind, 'status', 'already_refunded');
  END IF;

  -- Preserve the existing product behaviour for a provider refund that arrives
  -- before local capture/entitlement creation: retain the payment row, revoke
  -- nothing, and make replay a no-op. Failed/cancelled attempts remain
  -- terminal and are not transformed into refunds.
  IF v_prior_status IN ('created', 'authorized') THEN
    UPDATE public.payments SET status = 'refunded', updated_at = v_now WHERE id = p_payment_id;
    IF v_pay.user_id IS NOT NULL THEN
      PERFORM public.log_activity(v_pay.user_id, 'payment_refunded',
        jsonb_build_object('payment_id', p_payment_id, 'kind', v_pay.kind, 'result', 'no_entitlement'),
        'payrefund:' || p_payment_id::text);
    END IF;
    RETURN jsonb_build_object('kind', v_pay.kind, 'status', 'refunded', 'revoked', 'none');
  END IF;
  IF v_prior_status IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'refund_membership: payment is not refundable (status=%)', v_prior_status;
  END IF;

  v_user := v_pay.user_id;

  IF v_pay.kind = 'boost' THEN
    SELECT * INTO v_ent
    FROM public.profile_boost_entitlements e
    WHERE e.payment_id = p_payment_id
    FOR UPDATE;
    v_has_ent := FOUND;

    UPDATE public.payments SET status = 'refunded', updated_at = v_now WHERE id = p_payment_id;

    -- A deleted account has its personal boost ledger cascaded, or its payment
    -- is detached. Either way, never guess at another user's entitlement.
    IF NOT v_has_ent OR v_user IS NULL THEN
      IF v_user IS NOT NULL THEN
        PERFORM public.push_notification(v_user, 'admin_message', 'Boost purchase refunded',
          'Your Profile Boost payment has been refunded.', jsonb_build_object('payment_id', p_payment_id), '/profile');
        PERFORM public.log_activity(v_user, 'payment_refunded',
          jsonb_build_object('payment_id', p_payment_id, 'kind', 'boost', 'result', 'no_entitlement'),
          'payrefund:' || p_payment_id::text);
        PERFORM public.log_activity(v_user, 'boost_refunded',
          jsonb_build_object('payment_id', p_payment_id, 'result', 'no_entitlement'),
          'boostrefund:' || p_payment_id::text);
      END IF;
      RETURN jsonb_build_object('kind', 'boost', 'status', 'refunded', 'revoked', 'none');
    END IF;

    v_unconsumed := greatest(v_ent.ends_at - greatest(v_ent.starts_at, v_now), interval '0');
    UPDATE public.profile_boost_entitlements
    SET status = 'revoked', revoked_at = v_now
    WHERE id = v_ent.id AND status = 'granted';

    IF v_unconsumed > interval '0' THEN
      UPDATE public.profile_boost_entitlements
      SET starts_at = starts_at - v_unconsumed, ends_at = ends_at - v_unconsumed
      WHERE boost_id = v_ent.boost_id AND id <> v_ent.id
        AND status = 'granted' AND starts_at > v_ent.starts_at;
      UPDATE public.profile_boosts
      SET expires_at = greatest(expires_at - v_unconsumed, started_at)
      WHERE id = v_ent.boost_id;
    END IF;

    UPDATE public.profile_boosts
    SET status = 'cancelled'
    WHERE id = v_ent.boost_id AND status = 'active' AND expires_at <= v_now;

    SELECT b.status::text AS status, b.expires_at INTO v_period
    FROM public.profile_boosts b WHERE b.id = v_ent.boost_id;
    v_period_status := coalesce(v_period.status, 'missing');

    PERFORM public.push_notification(
      v_user, 'admin_message', 'Boost purchase refunded',
      CASE WHEN v_period_status = 'active' AND v_period.expires_at > v_now
        THEN 'Your Profile Boost purchase has been refunded and its remaining days were removed. Your other boost time continues till '
             || to_char(v_period.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.'
        ELSE 'Your Profile Boost purchase has been refunded and the boost has been removed.' END,
      jsonb_build_object('payment_id', p_payment_id, 'entitlement_id', v_ent.id,
                         'boost_id', v_ent.boost_id), '/profile');
    PERFORM public.log_activity(v_user, 'payment_refunded',
      jsonb_build_object('payment_id', p_payment_id, 'kind', 'boost'),
      'payrefund:' || p_payment_id::text);
    PERFORM public.log_activity(v_user, 'boost_refunded',
      jsonb_build_object('payment_id', p_payment_id, 'entitlement_id', v_ent.id,
                         'boost_id', v_ent.boost_id,
                         'revoked_seconds', floor(extract(epoch FROM v_unconsumed)),
                         'period_status', v_period_status),
      'boostrefund:' || p_payment_id::text);

    RETURN jsonb_build_object('kind', 'boost', 'status', 'refunded',
                              'entitlement_id', v_ent.id, 'boost_id', v_ent.boost_id,
                              'revoked_seconds', floor(extract(epoch FROM v_unconsumed)),
                              'period_status', v_period_status,
                              'period_expires_at', v_period.expires_at);
  END IF;

  -- Membership refunds only cancel the subscription created by this payment;
  -- admin/manual subscriptions (payment_id NULL) are never revoked here.
  UPDATE public.payments SET status = 'refunded', updated_at = v_now WHERE id = p_payment_id;
  UPDATE public.subscriptions
  SET status = 'cancelled', updated_at = v_now
  WHERE payment_id = p_payment_id AND status = 'active';

  IF v_user IS NOT NULL THEN
    IF NOT public.has_live_membership(v_user) THEN
      UPDATE public.matrimony_profiles mp
      SET status = 'hidden', updated_at = now()
      WHERE mp.user_id = v_user AND mp.status = 'active';
    END IF;
    PERFORM public.push_notification(v_user, 'payment_received', 'Your payment was refunded',
      'The refunded membership has been revoked. If this was unexpected, contact support.',
      jsonb_build_object('payment_id', p_payment_id), '/packages');
    PERFORM public.log_activity(v_user, 'payment_refunded',
      jsonb_build_object('payment_id', p_payment_id, 'kind', 'package'),
      'payrefund:' || p_payment_id::text);
    PERFORM public.log_activity(v_user, 'membership_refunded',
      jsonb_build_object('payment_id', p_payment_id),
      'subrefund:' || p_payment_id::text);
  END IF;

  RETURN jsonb_build_object('kind', 'package', 'status', 'refunded');
END;
$$;

COMMENT ON FUNCTION public.refund_membership(uuid) IS
  'Service-role-only refund handler. It locks the owner/payment, cancels only the payment-linked subscription or boost entitlement, preserves the existing no-entitlement pre-capture refund behavior, retains deleted-user ledger rows, and is idempotent on replay.';

REVOKE ALL ON FUNCTION public.refund_membership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_membership(uuid) TO service_role;


-- Payment webhook events are service-role/server-only data.
COMMENT ON FUNCTION public.cancel_stale_payments() IS
  'Marks created payment attempts older than 24 hours as cancelled. It never changes authorized, captured, failed or refunded rows.';
