-- ============================================================================
-- Mali Vivah · Profile Boost corrections — single duration source, explicit
-- boost entitlements, quota isolation, safe refunds
--
-- WHY
--   * Several boost paths hard-coded 7 days (table default, boost_my_profile(),
--     the admin grant, the expiry notification) although
--     profile_boost_config.duration_days already exists.
--   * A purchased boost that stacked onto a running boost MOVED its payment_id
--     onto that row and cleared the previous one — the earlier purchase lost
--     its identity, and refunding one payment could cancel whatever boost
--     happened to be live (package, admin or another purchase).
--   * The package quota (benefits.boosts_included) counted EVERY boost row,
--     so a purchased add-on or an admin support boost silently consumed the
--     member's included boosts.
--
-- MODEL (after this migration)
--   profile_boosts              = the VISIBLE boost period. At most one live
--                                 row per member (status='active' AND
--                                 expires_at > now()). Stacking a purchase
--                                 extends this row's expires_at — exactly the
--                                 product behaviour members already know.
--   profile_boost_entitlements  = the LEDGER: one row per grant, each with its
--                                 own source (package / admin / purchase), its
--                                 own contiguous time segment inside the
--                                 period it feeds (starts_at → ends_at), and
--                                 — for purchases only — the payment that
--                                 bought it (UNIQUE). Nothing ever overwrites
--                                 another entitlement's payment link.
--
--   duration      → profile_boost_config.duration_days, read at grant time by
--                   boost_duration_days(). No fallback: a missing/invalid
--                   configuration makes every activation path fail loudly.
--                   profile_boost_config.is_active keeps its ONE meaning —
--                   "may standalone boosts be SOLD" — and is not consulted by
--                   the package or admin paths.
--   quota         → boost_my_profile() counts only entitlements with
--                   source='package' created since the current membership
--                   started (membership-period accounting unchanged).
--   refund        → refund_membership() on a 'boost' payment revokes ONLY the
--                   entitlement that payment bought, removes just its
--                   UNCONSUMED remainder from the period (later segments slide
--                   earlier so the member keeps every other day they hold),
--                   and is idempotent. Package / admin / other purchases are
--                   never touched; a payment without an entitlement revokes
--                   nothing.
--
-- SECURITY
--   * Client grants: SELECT own rows on the ledger; nothing else. All writes
--     go through the SECURITY DEFINER RPCs below. activate_boost_purchase(),
--     admin_grant_boost() and refund_membership() stay service-role only;
--     boost_my_profile() stays authenticated-only.
--   * Every activation path serialises per member with an advisory lock so
--     concurrent webhook/verify/admin calls cannot create two live periods.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent). Preserves every existing boost + payment row.
-- DEPENDS ON 20260919010000_boost_purchases.sql — that file's ORIGINAL
-- version had a syntax error (double-quoted COMMENT string) and rolled back
-- when applied; §0 below refuses to run until the corrected file has been
-- applied, so nothing here can end up half-built.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard — fail before touching anything
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.profile_boost_config') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'kind')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'profile_boosts' AND column_name = 'payment_id')
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'boost_entitlements: prerequisite migration 20260919010000_boost_purchases.sql is not applied',
      HINT    = 'Its original version failed to parse. Run the corrected 20260919010000_boost_purchases.sql first, then re-run this file.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 profile_boosts — no more hidden 7-day default
--    Every writer must now supply expires_at explicitly (computed from the
--    configured duration). An INSERT that forgets it fails instead of
--    silently granting a week.
-- ----------------------------------------------------------------------------
ALTER TABLE public.profile_boosts ALTER COLUMN expires_at DROP DEFAULT;

COMMENT ON TABLE public.profile_boosts IS
  'The VISIBLE Profile Boost period — at most one live row per member (status=active AND expires_at>now()). Stacked purchases extend expires_at. Who paid for which slice lives in profile_boost_entitlements; expires_at is always computed from profile_boost_config.duration_days (no column default).';

COMMENT ON COLUMN public.profile_boosts.payment_id IS
  'DEPRECATED — superseded by profile_boost_entitlements.payment_id (one entitlement per payment). Kept only for rows written before 20260919060000; new rows leave it NULL.';

COMMENT ON COLUMN public.profile_boosts.created_via IS
  'Source of the entitlement that OPENED this period: package | admin | purchase. Later stacked entitlements are recorded in profile_boost_entitlements.';


-- ----------------------------------------------------------------------------
-- §2 boost_duration_days() — the single duration source
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.boost_duration_days()
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days SMALLINT;
BEGIN
  SELECT c.duration_days INTO v_days
  FROM public.profile_boost_config c
  WHERE c.id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOST_CONFIG_MISSING: profile_boost_config row 1 is missing — set the boost duration in Admin → Boosts';
  END IF;
  IF v_days IS NULL OR v_days < 1 OR v_days > 30 THEN
    RAISE EXCEPTION 'BOOST_CONFIG_INVALID: profile_boost_config.duration_days must be between 1 and 30 (found %)', v_days;
  END IF;

  RETURN v_days;
END;
$$;

COMMENT ON FUNCTION public.boost_duration_days() IS
  'Authoritative Profile Boost length in days, read from profile_boost_config.duration_days. Used by package-included, admin-granted AND purchased boosts. Raises BOOST_CONFIG_MISSING / BOOST_CONFIG_INVALID instead of falling back to a hard-coded value. Ignores is_active on purpose (that flag only gates standalone SALES).';

REVOKE ALL ON FUNCTION public.boost_duration_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boost_duration_days() TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §3 profile_boost_entitlements — the ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_boost_entitlements (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  -- The visible period this entitlement feeds (stacked purchases share one).
  boost_id      BIGINT NOT NULL REFERENCES public.profile_boosts (id) ON DELETE CASCADE,
  source        TEXT NOT NULL
                CHECK (source IN ('package', 'admin', 'purchase')),
  -- Purchases only. Default NO ACTION (not SET NULL) so the source/payment
  -- invariant below can never be broken by a cascade; payments only disappear
  -- together with the account, which removes these rows too.
  payment_id    UUID REFERENCES public.payments (id),
  -- The configured duration at grant time (audit value; the segment below is
  -- the authority for time accounting).
  duration_days SMALLINT NOT NULL CHECK (duration_days >= 1),
  -- This entitlement's contiguous slice of the period.
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'granted'
                CHECK (status IN ('granted', 'revoked')),
  -- Admin who granted it (admin source only).
  granted_by    UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,

  CONSTRAINT profile_boost_entitlements_window_chk
    CHECK (ends_at >= starts_at),
  -- purchase ⇔ payment: a purchased entitlement ALWAYS names its payment;
  -- package/admin entitlements NEVER carry one.
  CONSTRAINT profile_boost_entitlements_payment_source_chk
    CHECK ((source = 'purchase') = (payment_id IS NOT NULL)),
  CONSTRAINT profile_boost_entitlements_revoked_chk
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

COMMENT ON TABLE public.profile_boost_entitlements IS
  'Profile Boost ledger: one row per grant (package-included / admin-granted / purchased) with its own time slice inside the visible period (profile_boosts). Purchases map 1:1 to payments (UNIQUE payment_id) so a refund can revoke exactly what that payment bought. Written only by SECURITY DEFINER RPCs.';
COMMENT ON COLUMN public.profile_boost_entitlements.source IS
  'package = redeemed from packages.benefits.boosts_included (the ONLY source counted against that quota); admin = support grant (no payment); purchase = standalone add-on (payment_id set).';
COMMENT ON COLUMN public.profile_boost_entitlements.starts_at IS
  'Start of this entitlement''s slice of the period. Slices are contiguous: a stacked purchase starts where the previous slice ends. When an earlier slice is revoked, later slices slide earlier by the revoked slice''s unconsumed remainder.';

-- One entitlement per payment — a payment can never buy two boosts and a
-- boost purchase can never be re-attributed to another payment.
CREATE UNIQUE INDEX IF NOT EXISTS profile_boost_entitlements_one_per_payment_idx
  ON public.profile_boost_entitlements (payment_id)
  WHERE payment_id IS NOT NULL;

-- Quota accounting: package entitlements per member since a point in time.
CREATE INDEX IF NOT EXISTS profile_boost_entitlements_user_source_idx
  ON public.profile_boost_entitlements (user_id, source, created_at DESC);

-- Segment re-packing inside one period.
CREATE INDEX IF NOT EXISTS profile_boost_entitlements_boost_idx
  ON public.profile_boost_entitlements (boost_id, starts_at);

ALTER TABLE public.profile_boost_entitlements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile_boost_entitlements TO authenticated;
-- No INSERT/UPDATE/DELETE grants: writes happen only inside the RPCs below.

DROP POLICY IF EXISTS "Owner reads own boost entitlements" ON public.profile_boost_entitlements;
CREATE POLICY "Owner reads own boost entitlements"
  ON public.profile_boost_entitlements FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- Backfill: every existing boost row becomes one entitlement covering its whole
-- period, keeping its original created_at so membership-period quota
-- accounting is unchanged. Idempotent (skips rows that already have one).
--   * payment_id set                → purchase (linked to that payment)
--   * created_via = 'package'       → package (counts against the quota, as before)
--   * anything else                 → admin
--   * created_via = 'purchase' with the payment link lost by the old stacking
--     bug → no entitlement (nothing to refund against; the period itself is
--     untouched and keeps working).
INSERT INTO public.profile_boost_entitlements
  (user_id, boost_id, source, payment_id, duration_days, starts_at, ends_at, status, created_at, revoked_at)
SELECT
  b.user_id,
  b.id,
  CASE
    WHEN b.payment_id IS NOT NULL THEN 'purchase'
    WHEN b.created_via = 'package' THEN 'package'
    ELSE 'admin'
  END,
  b.payment_id,
  greatest(1, ceil(extract(epoch FROM (greatest(b.expires_at, b.started_at) - b.started_at)) / 86400))::smallint,
  b.started_at,
  greatest(b.expires_at, b.started_at),
  CASE WHEN b.status = 'cancelled' THEN 'revoked' ELSE 'granted' END,
  b.created_at,
  CASE WHEN b.status = 'cancelled' THEN now() ELSE NULL END
FROM public.profile_boosts b
WHERE NOT (b.created_via = 'purchase' AND b.payment_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.profile_boost_entitlements e WHERE e.boost_id = b.id
  )
  -- A payment can back only one entitlement (legacy data may hold duplicates).
  AND (b.payment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profile_boost_entitlements e WHERE e.payment_id = b.payment_id
  ));


-- ----------------------------------------------------------------------------
-- §4 boost_my_profile() — package-included boost (member RPC)
--    Unchanged contract: paid-member requirement, boosts_included quota within
--    the current membership period, idempotent while a boost is live, activity
--    event. Changed: configured duration; only PACKAGE entitlements count.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.boost_my_profile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_included NUMERIC;
  v_used     INTEGER;
  v_since    TIMESTAMPTZ;
  v_live     RECORD;
  v_days     SMALLINT;
  v_now      TIMESTAMPTZ := now();
  v_exp      TIMESTAMPTZ;
  v_id       BIGINT;
  v_ent      BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'boost_my_profile: not authenticated';
  END IF;

  -- One activation at a time per member (webhook / admin / self may race).
  PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || v_user::text));

  -- Already boosted → idempotent, no quota consumed.
  SELECT b.id, b.expires_at INTO v_live
  FROM public.profile_boosts b
  WHERE b.user_id = v_user AND b.status = 'active' AND b.expires_at > v_now
  ORDER BY b.expires_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_active', 'boost_id', v_live.id, 'expires_at', v_live.expires_at);
  END IF;

  v_included := (public.get_membership(v_user) -> 'benefits' ->> 'boosts_included')::numeric;
  IF v_included IS NULL OR v_included <= 0 THEN
    RAISE EXCEPTION 'BOOSTS_NOT_INCLUDED: your current plan does not include profile boosts';
  END IF;

  -- Count PACKAGE boosts redeemed since the current membership started.
  -- Purchased add-ons and admin support boosts never touch this quota.
  SELECT greatest(coalesce((public.get_membership(v_user) ->> 'started_at')::timestamptz, v_now - interval '10 years'), v_now - interval '10 years')
  INTO v_since;
  SELECT count(*) INTO v_used
  FROM public.profile_boost_entitlements e
  WHERE e.user_id = v_user
    AND e.source = 'package'
    AND e.created_at >= v_since;
  IF v_used >= v_included THEN
    RAISE EXCEPTION 'BOOST_LIMIT_REACHED: your current plan includes % boosts', floor(v_included);
  END IF;

  -- Configured duration (raises if the configuration is missing/invalid).
  v_days := public.boost_duration_days();
  v_exp  := v_now + make_interval(days => v_days);

  INSERT INTO public.profile_boosts (user_id, status, started_at, expires_at, created_via)
  VALUES (v_user, 'active', v_now, v_exp, 'package')
  RETURNING id INTO v_id;

  INSERT INTO public.profile_boost_entitlements
    (user_id, boost_id, source, payment_id, duration_days, starts_at, ends_at)
  VALUES
    (v_user, v_id, 'package', NULL, v_days, v_now, v_exp)
  RETURNING id INTO v_ent;

  PERFORM public.log_activity(
    v_user,
    'profile_boosted',
    jsonb_build_object('boost_id', v_id, 'entitlement_id', v_ent, 'source', 'package',
                       'duration_days', v_days, 'expires_at', v_exp)
  );

  RETURN jsonb_build_object(
    'status', 'active',
    'boost_id', v_id,
    'entitlement_id', v_ent,
    'duration_days', v_days,
    'expires_at', v_exp
  );
END;
$$;

COMMENT ON FUNCTION public.boost_my_profile() IS
  'Redeems one package-included Profile Boost for the configured duration (profile_boost_config.duration_days). Enforces the plan''s boosts_included quota within the current membership period counting ONLY package entitlements (purchases/admin grants do not consume it); idempotent while a boost is live. Free members get BOOSTS_NOT_INCLUDED.';

REVOKE ALL ON FUNCTION public.boost_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boost_my_profile() TO authenticated;


-- ----------------------------------------------------------------------------
-- §5 activate_boost_purchase(p_payment_id) — standalone purchase (service role)
--    Idempotent per payment. Stacks onto a live period by appending a NEW
--    entitlement slice — the earlier purchase keeps its own payment link.
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

  -- Idempotency: this payment already produced an entitlement → return it.
  SELECT e.id, e.boost_id, b.expires_at INTO v_ent
  FROM public.profile_boost_entitlements e
  JOIN public.profile_boosts b ON b.id = e.boost_id
  WHERE e.payment_id = p_payment_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_activated',
      'boost_id', v_ent.boost_id,
      'entitlement_id', v_ent.id,
      'expires_at', v_ent.expires_at
    );
  END IF;

  SELECT * INTO v_pay FROM public.payments p WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % not found', p_payment_id;
  END IF;
  IF v_pay.kind IS DISTINCT FROM 'boost' THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % is not a boost purchase', p_payment_id;
  END IF;
  IF v_pay.status = 'refunded' THEN
    RAISE EXCEPTION 'activate_boost_purchase: payment % was refunded', p_payment_id;
  END IF;

  -- Configured duration (raises if the configuration is missing/invalid).
  -- is_active is deliberately NOT checked here: it gates SELLING (order API);
  -- a payment that was already captured is always honoured.
  v_days := public.boost_duration_days();

  PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || v_pay.user_id::text));

  UPDATE public.payments
  SET status = 'captured',
      updated_at = v_now
  WHERE id = p_payment_id;

  -- Live period? Append the new slice after the current end (stacking).
  SELECT b.id, b.expires_at INTO v_live
  FROM public.profile_boosts b
  WHERE b.user_id = v_pay.user_id
    AND b.status = 'active'
    AND b.expires_at > v_now
  ORDER BY b.expires_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_boost_id := v_live.id;
    v_start    := v_live.expires_at;
    v_end      := v_start + make_interval(days => v_days);

    UPDATE public.profile_boosts
    SET expires_at = v_end
    WHERE id = v_boost_id;

    v_status := 'stacked';
  ELSE
    v_start := v_now;
    v_end   := v_now + make_interval(days => v_days);

    INSERT INTO public.profile_boosts (user_id, status, started_at, expires_at, created_via)
    VALUES (v_pay.user_id, 'active', v_start, v_end, 'purchase')
    RETURNING id INTO v_boost_id;

    v_status := 'activated';
  END IF;

  INSERT INTO public.profile_boost_entitlements
    (user_id, boost_id, source, payment_id, duration_days, starts_at, ends_at)
  VALUES
    (v_pay.user_id, v_boost_id, 'purchase', p_payment_id, v_days, v_start, v_end)
  RETURNING id INTO v_ent_id;

  PERFORM public.push_notification(
    v_pay.user_id,
    'admin_message',
    'Profile Boost activated',
    CASE WHEN v_status = 'stacked'
      THEN 'Your purchased ' || v_days || '-day boost has been added to your running boost — your profile stays first in search and browse till '
           || to_char(v_end AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.'
      ELSE 'Your purchased boost is live — your profile appears first in search and browse for the next '
           || v_days || ' days (till ' || to_char(v_end AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || ').'
    END,
    jsonb_build_object('duration_days', v_days, 'expires_at', v_end, 'boost_id', v_boost_id, 'entitlement_id', v_ent_id),
    '/profile'
  );

  PERFORM public.log_activity(
    v_pay.user_id,
    'boost_purchased',
    jsonb_build_object('payment_id', p_payment_id, 'boost_id', v_boost_id, 'entitlement_id', v_ent_id,
                       'duration_days', v_days, 'expires_at', v_end, 'result', v_status)
  );

  RETURN jsonb_build_object(
    'status', v_status,
    'boost_id', v_boost_id,
    'entitlement_id', v_ent_id,
    'duration_days', v_days,
    'expires_at', v_end
  );
END;
$$;

COMMENT ON FUNCTION public.activate_boost_purchase(uuid) IS
  'Service-role activation for a verified boost payment. Idempotent per payment. Creates a purchase entitlement for the configured duration; if a boost is already live the new slice is appended (expires_at extended) WITHOUT touching earlier entitlements'' payment links. Marks the payment captured, notifies + audit-logs.';

REVOKE ALL ON FUNCTION public.activate_boost_purchase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_boost_purchase(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6 admin_grant_boost(p_user_id, p_granted_by) — support grant (service role)
--    Replaces the server action's direct INSERT (which relied on the 7-day
--    column default). No payment, never counts against the package quota.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_boost(
  p_user_id    UUID,
  p_granted_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live     RECORD;
  v_days     SMALLINT;
  v_now      TIMESTAMPTZ := now();
  v_exp      TIMESTAMPTZ;
  v_boost_id BIGINT;
  v_ent_id   BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_grant_boost: user id required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'admin_grant_boost: member % not found', p_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || p_user_id::text));

  SELECT b.id, b.expires_at INTO v_live
  FROM public.profile_boosts b
  WHERE b.user_id = p_user_id AND b.status = 'active' AND b.expires_at > v_now
  ORDER BY b.expires_at DESC
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'BOOST_ALREADY_ACTIVE: this member already has an active boost (till %)',
      to_char(v_live.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY');
  END IF;

  v_days := public.boost_duration_days();
  v_exp  := v_now + make_interval(days => v_days);

  INSERT INTO public.profile_boosts (user_id, status, started_at, expires_at, created_via)
  VALUES (p_user_id, 'active', v_now, v_exp, 'admin')
  RETURNING id INTO v_boost_id;

  INSERT INTO public.profile_boost_entitlements
    (user_id, boost_id, source, payment_id, duration_days, starts_at, ends_at, granted_by)
  VALUES
    (p_user_id, v_boost_id, 'admin', NULL, v_days, v_now, v_exp, p_granted_by)
  RETURNING id INTO v_ent_id;

  PERFORM public.push_notification(
    p_user_id,
    'admin_message',
    'Profile boost activated',
    'Our team has activated a ' || v_days || '-day Profile Boost for your profile — you appear first in search till '
      || to_char(v_exp AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.',
    jsonb_build_object('duration_days', v_days, 'expires_at', v_exp, 'boost_id', v_boost_id, 'entitlement_id', v_ent_id),
    '/profile'
  );

  PERFORM public.log_activity(
    p_user_id,
    'boost_granted',
    jsonb_build_object('boost_id', v_boost_id, 'entitlement_id', v_ent_id, 'source', 'admin',
                       'duration_days', v_days, 'expires_at', v_exp, 'granted_by', p_granted_by)
  );

  RETURN jsonb_build_object(
    'status', 'granted',
    'boost_id', v_boost_id,
    'entitlement_id', v_ent_id,
    'duration_days', v_days,
    'expires_at', v_exp
  );
END;
$$;

COMMENT ON FUNCTION public.admin_grant_boost(uuid, uuid) IS
  'Service-role support tool: grants an admin-origin Profile Boost for the configured duration (profile_boost_config.duration_days). No payment is attached and it never consumes the member''s package quota. Refuses while a boost is live (BOOST_ALREADY_ACTIVE). Notifies + audit-logs with the real duration.';

REVOKE ALL ON FUNCTION public.admin_grant_boost(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_boost(uuid, uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §7 refund_membership(p_payment_id) — boost branch made exact + idempotent
--    Membership branch preserved verbatim from 20260919010000.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_membership(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay        public.payments%ROWTYPE;
  v_user       UUID;
  v_ent        public.profile_boost_entitlements%ROWTYPE;
  v_has_ent    BOOLEAN;
  v_now        TIMESTAMPTZ := now();
  v_unconsumed INTERVAL;
  v_period     RECORD;
  v_period_status TEXT;
BEGIN
  SELECT * INTO v_pay FROM public.payments p WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_membership: payment % not found', p_payment_id;
  END IF;
  v_user := v_pay.user_id;

  IF v_pay.kind = 'boost' THEN
    PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || v_user::text));

    -- The ONE entitlement this payment bought (UNIQUE payment_id).
    SELECT * INTO v_ent
    FROM public.profile_boost_entitlements e
    WHERE e.payment_id = p_payment_id
    FOR UPDATE;
    v_has_ent := FOUND;

    -- Already revoked → idempotent no-op (payment stays refunded, no second
    -- notification, nothing else is touched).
    IF v_has_ent AND v_ent.status = 'revoked' THEN
      UPDATE public.payments SET status = 'refunded', updated_at = v_now
      WHERE id = p_payment_id AND status <> 'refunded';
      RETURN jsonb_build_object('kind', 'boost', 'status', 'already_refunded',
                                'entitlement_id', v_ent.id, 'boost_id', v_ent.boost_id);
    END IF;

    UPDATE public.payments SET status = 'refunded', updated_at = v_now
    WHERE id = p_payment_id;

    -- No entitlement (never activated, or a pre-ledger purchase whose link was
    -- lost): mark the payment refunded and revoke NOTHING — never guess.
    IF NOT v_has_ent THEN
      IF v_pay.status IS DISTINCT FROM 'refunded' THEN
        PERFORM public.push_notification(
          v_user,
          'admin_message',
          'Boost purchase refunded',
          'Your Profile Boost payment has been refunded.',
          jsonb_build_object('payment_id', p_payment_id),
          '/profile'
        );
        PERFORM public.log_activity(v_user, 'boost_refunded',
          jsonb_build_object('payment_id', p_payment_id, 'result', 'no_entitlement'));
      END IF;
      RETURN jsonb_build_object(
        'kind', 'boost',
        'status', CASE WHEN v_pay.status IS DISTINCT FROM 'refunded' THEN 'refunded' ELSE 'already_refunded' END,
        'revoked', 'none'
      );
    END IF;

    -- Only the part of THIS slice that has not been consumed yet comes off the
    -- period; days already enjoyed are history and other slices are untouched.
    v_unconsumed := greatest(v_ent.ends_at - greatest(v_ent.starts_at, v_now), interval '0');

    UPDATE public.profile_boost_entitlements
    SET status = 'revoked', revoked_at = v_now
    WHERE id = v_ent.id;

    IF v_unconsumed > interval '0' THEN
      -- Later slices in the same period slide earlier so the member keeps
      -- every day the OTHER entitlements gave them, back to back.
      UPDATE public.profile_boost_entitlements
      SET starts_at = starts_at - v_unconsumed,
          ends_at   = ends_at   - v_unconsumed
      WHERE boost_id = v_ent.boost_id
        AND id <> v_ent.id
        AND status = 'granted'
        AND starts_at > v_ent.starts_at;

      UPDATE public.profile_boosts
      SET expires_at = greatest(expires_at - v_unconsumed, started_at)
      WHERE id = v_ent.boost_id;
    END IF;

    -- Nothing left in the period → it is over now (not merely "expired").
    UPDATE public.profile_boosts
    SET status = 'cancelled'
    WHERE id = v_ent.boost_id
      AND status = 'active'
      AND expires_at <= v_now;

    SELECT b.status::text AS status, b.expires_at INTO v_period
    FROM public.profile_boosts b WHERE b.id = v_ent.boost_id;
    v_period_status := coalesce(v_period.status, 'missing');

    PERFORM public.push_notification(
      v_user,
      'admin_message',
      'Boost purchase refunded',
      CASE WHEN v_period_status = 'active' AND v_period.expires_at > v_now
        THEN 'Your Profile Boost purchase has been refunded and its remaining days were removed. Your other boost time continues till '
             || to_char(v_period.expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.'
        ELSE 'Your Profile Boost purchase has been refunded and the boost has been removed.'
      END,
      jsonb_build_object('payment_id', p_payment_id, 'entitlement_id', v_ent.id, 'boost_id', v_ent.boost_id),
      '/profile'
    );

    PERFORM public.log_activity(v_user, 'boost_refunded',
      jsonb_build_object('payment_id', p_payment_id, 'entitlement_id', v_ent.id, 'boost_id', v_ent.boost_id,
                         'revoked_seconds', floor(extract(epoch FROM v_unconsumed)),
                         'period_status', v_period_status, 'period_expires_at', v_period.expires_at));

    RETURN jsonb_build_object(
      'kind', 'boost',
      'status', 'refunded',
      'entitlement_id', v_ent.id,
      'boost_id', v_ent.boost_id,
      'revoked_seconds', floor(extract(epoch FROM v_unconsumed)),
      'period_status', v_period_status,
      'period_expires_at', v_period.expires_at
    );
  END IF;

  -- Membership refund (existing behaviour, preserved).
  UPDATE public.payments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_payment_id;

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
  'Revokes a captured payment. Membership payments cancel the subscription (and hide the profile when no live plan remains). Boost payments revoke ONLY the entitlement that payment bought — its unconsumed remainder comes off the period, later slices slide earlier, package/admin/other purchases are never touched — and the call is idempotent. Service role only.';

REVOKE ALL ON FUNCTION public.refund_membership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_membership(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §8 sweep_expired_memberships() — expiry notification without "7-day"
--    Membership part preserved verbatim from 20260915130000; the boost
--    notification now states the period's real length.
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
  v_boosts   INTEGER := 0;
  v_row      RECORD;
  v_days     INTEGER;
BEGIN
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

  UPDATE public.matrimony_profiles mp
  SET status = 'expired', updated_at = now()
  WHERE mp.status = 'active'
    AND NOT public.has_live_membership(mp.user_id);
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  FOR v_row IN
    UPDATE public.profile_boosts b
    SET status = 'expired'
    WHERE b.status = 'active'
      AND b.expires_at <= now()
    RETURNING b.id, b.user_id, b.started_at, b.expires_at
  LOOP
    v_boosts := v_boosts + 1;
    -- Real length of THIS period (stacked purchases make it longer than one
    -- configured duration), rounded to whole days.
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
  END LOOP;

  RETURN jsonb_build_object(
    'expired_subscriptions', v_subs,
    'expired_profiles', v_profiles,
    'expired_boosts', v_boosts
  );
END;
$$;

COMMENT ON FUNCTION public.sweep_expired_memberships() IS
  'Expires lapsed subscriptions (profiles active→expired, Renew CTA) and lapsed Profile Boost periods (notification states the period''s real length — no fixed duration is assumed). Idempotent. Run via cron; every gate is time-aware so it stays correct between runs.';

REVOKE ALL ON FUNCTION public.sweep_expired_memberships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_memberships() TO service_role;
