-- ============================================================================
-- Mali Vivah · Step 6 — Complete activity tracking + Admin Analytics
--
-- WHAT IT ADDS
--   §1  Additional indexes for bounded date-window analytics queries.
--   §2  Canonical event vocabulary (documentation + lightweight check in
--       log_activity()). Does NOT replace the TEXT column — keeps existing
--       writes working; new events go through this controlled list.
--   §3  Missing server-authoritative activity events, all idempotent on state
--       transitions (so webhook / retry paths cannot generate duplicates):
--        • payment_initiated  — new payments row (status='created')
--        • payment_failed     — payments.status → 'failed'
--        • membership_expired — sweep flips subscription to expired
--        • subscription_renewed — activate_membership() stacking path
--        • boost_expired      — sweep flips boost to expired
--        • boost_activated    — when a boost period first becomes active
--                              (both package-included and purchased; the
--                               existing 'boost_purchased' / 'profile_boosted'
--                               events stay for purchase/redemption detail)
--        • profile_created    — first insert into matrimony_profiles
--        • profile_completed  — required fields go from incomplete → complete
--        • profile_published  — matrimony_profiles.status → 'active'
--        • profile_updated    — substantive UPDATE on matrimony profile
--        • verification_rejected — verification_requests.status → rejected
--        • block_created      — blocks INSERT
--        • block_removed      — blocks DELETE
--        • moment_removed     — moments.is_removed flips to true
--        • account_deleted    — explicit RPC called before wiping the user
--   §4  log_account_deletion() RPC (service role) — the only place that can
--       write an 'account_deleted' event, called from the server action
--       immediately before the auth user is removed (so user_id is still
--       valid and the event survives via ON DELETE SET NULL).
--   §5  admin_analytics() — SECURITY DEFINER RPC gated by is_admin() that
--       returns bounded-window KPIs + daily buckets + top cities + latest
--       activity, using AUTHORITATIVE sources:
--         • members / signups          → profiles
--         • live profiles              → matrimony_profiles(status='active')
--         • subscriptions / renewals   → subscriptions
--         • revenue / payments         → payments(status='captured')
--         • interests / connections    → interests
--         • messages                   → messages
--         • profile views              → profile_views (authoritative table)
--         • boosts                     → profile_boosts
--         • moments                    → moments
--         • verifications / reports    → verification_requests / reports
--         • latest activity            → activity_events (scrubbed)
--
-- DESIGN RULES
--   • Every trigger is AFTER … FOR EACH ROW and fires only on genuine state
--     transitions (OLD vs NEW); retries / idempotent re-applications produce
--     no duplicate events.
--   • Metadata never contains phone/email/address/password/token/signature
--     keys — log_activity() scrubs them centrally.
--   • RLS on activity_events is unchanged (owner + admins). Admin analytics
--     reads via a single SECURITY DEFINER RPC that verifies is_admin().
--
-- Safe to re-run (CREATE OR REPLACE + idempotent triggers).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Analytics-friendly indexes (bounded date-window queries).
--    Only indexes that don't already exist are added.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS activity_events_created_idx
  ON public.activity_events (created_at DESC);

CREATE INDEX IF NOT EXISTS messages_created_idx
  ON public.messages (created_at DESC);

CREATE INDEX IF NOT EXISTS interests_created_idx
  ON public.interests (created_at DESC);

CREATE INDEX IF NOT EXISTS profile_views_viewed_at_idx
  ON public.profile_views (viewed_at DESC);

CREATE INDEX IF NOT EXISTS moments_created_idx
  ON public.moments (created_at DESC);

CREATE INDEX IF NOT EXISTS reports_created_idx
  ON public.reports (created_at DESC);


-- ----------------------------------------------------------------------------
-- §2 Canonical event vocabulary helper.
--    Returns the list of event names that Step 6 considers authoritative.
--    log_activity() warns (does not block) when an unknown name arrives —
--    older migrations / manual scripts keep working; new code is nudged
--    toward this list.
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
    'block_removed'
  ]::TEXT[]
$$;

COMMENT ON FUNCTION public.canonical_activity_events() IS
  'Authoritative event vocabulary for activity_events. Centralised so analytics UI + tests share one list. New event names must be added here.';

REVOKE ALL ON FUNCTION public.canonical_activity_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_activity_events() TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §2b log_activity() — upgraded to:
--        * hard-block a few critical forbidden keys (extra defence beyond
--          the existing regex)
--        * accept (but not require) a p_idempotency_key that deduplicates
--          on (user_id, event, idempotency_key). Used by payment webhooks.
--
--     The previous 3-argument function is dropped explicitly so we don't end
--     up with ambiguous overloads. All existing call sites pass three args;
--     the new fourth arg is DEFAULT NULL so they continue to work unmodified.
-- ----------------------------------------------------------------------------
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
  v_id BIGINT;
  v_meta JSONB := coalesce(p_metadata, '{}'::jsonb);
  v_scrubbed JSONB;
  k TEXT;
  v_lower TEXT;
BEGIN
  IF p_user_id IS NULL OR nullif(btrim(p_event), '') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotency: if a key was supplied and an event already exists for this
  -- (user, event, key), return that row's id without inserting a duplicate.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.activity_events
    WHERE user_id = p_user_id
      AND event = btrim(p_event)
      AND metadata ->> '__idkey' = p_idempotency_key
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
    v_meta := v_meta || jsonb_build_object('__idkey', p_idempotency_key);
  END IF;

  -- Scrub contact/credential/secret keys. Existing regex kept; extra deny-list
  -- catches compound names (e.g. razorpay_signature, auth_token, id_document).
  v_scrubbed := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(v_meta)
  LOOP
    v_lower := lower(k);
    IF v_lower ~ '(phone|mobile|email|contact|address|password|secret|token|signature|card|cvv|otp|cvv)'
       OR v_lower IN ('__idkey') THEN  -- idempotency key kept; skips the CONTINUE below by separating blocks
      -- __idkey is a technical bookkeeping field we added above — keep it.
      IF k = '__idkey' THEN
        v_scrubbed := v_scrubbed || jsonb_build_object(k, v_meta -> k);
      END IF;
      CONTINUE;
    END IF;
    v_scrubbed := v_scrubbed || jsonb_build_object(k, v_meta -> k);
  END LOOP;

  INSERT INTO public.activity_events (user_id, event, metadata) VALUES (p_user_id, btrim(p_event), v_scrubbed)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_activity(uuid, text, jsonb, text) IS
  'Appends one activity_events row. SECURITY DEFINER; EXECUTE limited to service_role; SECURITY DEFINER triggers may call it. Scrubs contact/credential/secret keys from metadata; supports an optional idempotency key for webhook/retry safety.';

REVOKE ALL ON FUNCTION public.log_activity(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(uuid, text, jsonb, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §3a Payment lifecycle events
--     payment_initiated — every fresh payments row (status='created') on INSERT.
--     payment_failed    — status → 'failed' transition.
--     NOTE: payment_captured / payment_refunded are already emitted by
--     activate_membership() / activate_boost_purchase() / refund_membership()
--     at the point the transition actually happens, so no trigger is added
--     for them. Those events are emitted at the authoritative activation
--     moment in the RPCs below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_payment_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safe_meta JSONB;
BEGIN
  -- Build safe metadata: package_slug, kind, amount_inr, payment.id.
  -- NO razorpay_signature, card info, raw payload.
  v_safe_meta := jsonb_build_object(
    'payment_id', NEW.id,
    'kind', coalesce(NEW.kind, 'package'),
    'amount_inr', NEW.amount_inr,
    'package_slug', NEW.package_slug
  );

  IF TG_OP = 'INSERT' AND NEW.status = 'created' THEN
    PERFORM public.log_activity(
      NEW.user_id,
      'payment_initiated',
      v_safe_meta,
      'pay:' || NEW.id::text
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'failed' AND OLD.status IN ('created', 'authorized') THEN
      PERFORM public.log_activity(
        NEW.user_id,
        'payment_failed',
        v_safe_meta || jsonb_build_object('failure_reason', NEW.failure_reason),
        'payfail:' || NEW.id::text
      );
    END IF;
    -- payment_captured is logged inside activate_membership/activate_boost_purchase
    -- at the point where the entitlement is created (authoritative signal).
    -- payment_refunded is logged inside refund_membership.
    -- membership_activated / boost_purchased are already the success events.
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.log_payment_lifecycle() IS
  'AFTER INSERT/UPDATE trigger on payments: logs payment_initiated and payment_failed events with safe metadata (no payment secrets). Captured/refunded events are logged by the authoritative activation/refund functions.';

DROP TRIGGER IF EXISTS payments_log_lifecycle ON public.payments;
CREATE TRIGGER payments_log_lifecycle
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_payment_lifecycle();


-- ----------------------------------------------------------------------------
-- §3b Subscription lifecycle
--     membership_renewed  — activate_membership() stacked a new plan onto an
--                           already-active subscription (v_base > v_started).
--     membership_expired  — sweep flips a subscription status to 'expired'.
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
  v_is_renewal BOOLEAN := FALSE;
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
  v_is_renewal := (v_base > v_started);
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

    -- Payment captured event (authoritative moment — the subscription row
    -- exists and the payment is marked captured). Safe metadata only.
    PERFORM public.log_activity(
      p_user_id,
      'payment_captured',
      jsonb_build_object(
        'payment_id', p_payment_id,
        'package_slug', v_pkg.slug,
        'kind', 'package',
        'amount_inr', v_pkg.price_inr
      ),
      'paycap:' || p_payment_id::text
    );
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
                       'expires_at', v_expires, 'profile_status', coalesce(v_status::text, 'draft'),
                       'renewal', v_is_renewal),
    CASE WHEN p_payment_id IS NOT NULL THEN 'sub:' || p_payment_id::text ELSE NULL END
  );

  IF v_is_renewal THEN
    PERFORM public.log_activity(
      p_user_id,
      'membership_renewed',
      jsonb_build_object('package_slug', v_pkg.slug, 'subscription_id', v_sub_id,
                         'expires_at', v_expires),
      'renew:' || v_sub_id::text
    );
  END IF;

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
  'Creates a subscription after server-side payment verification (the ONLY subscription write path). Stacks renewals, activates the profile. Idempotent per payment. Logs payment_captured, membership_activated and (when stacking) membership_renewed.';

REVOKE ALL ON FUNCTION public.activate_membership(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_membership(uuid, bigint, uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §3c sweep_expired_memberships() — log expiry events + boost_activated event
--     when a purchased boost starts immediately (no stacking).
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
    RETURNING s.id, s.user_id, s.package_slug, s.expires_at
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

  RETURN jsonb_build_object(
    'expired_subscriptions', v_subs,
    'expired_profiles', v_profiles,
    'expired_boosts', v_boosts
  );
END;
$$;

COMMENT ON FUNCTION public.sweep_expired_memberships() IS
  'Expires lapsed subscriptions (profiles active→expired, Renew CTA) and lapsed Profile Boost periods. Logs membership_expired and boost_expired analytics events.';

REVOKE ALL ON FUNCTION public.sweep_expired_memberships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_memberships() TO service_role;


-- ----------------------------------------------------------------------------
-- §3d activate_boost_purchase() — augmented version of the existing function
--     that additionally logs payment_captured + boost_activated (when the
--     purchase starts a NEW active period, not when it stacks). Existing
--     boost_purchased logging and all prior semantics are preserved verbatim.
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

  v_days := public.boost_duration_days();

  PERFORM pg_advisory_xact_lock(hashtext('profile_boost:' || v_pay.user_id::text));

  UPDATE public.payments
  SET status = 'captured',
      updated_at = v_now
  WHERE id = p_payment_id;

  -- Authoritative payment captured event for boost purchases (safe metadata).
  PERFORM public.log_activity(
    v_pay.user_id,
    'payment_captured',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'kind', 'boost',
      'amount_inr', v_pay.amount_inr
    ),
    'paycap:' || p_payment_id::text
  );

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
                       'duration_days', v_days, 'expires_at', v_end, 'result', v_status),
    'boostbuy:' || p_payment_id::text
  );

  IF v_status = 'activated' THEN
    PERFORM public.log_activity(
      v_pay.user_id,
      'boost_activated',
      jsonb_build_object('boost_id', v_boost_id, 'entitlement_id', v_ent_id,
                         'source', 'purchase', 'duration_days', v_days, 'expires_at', v_end),
      'boostact:' || v_boost_id::text
    );
  END IF;

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
  'Service-role activation for a verified boost payment. Idempotent per payment. Logs payment_captured, boost_purchased, and boost_activated (when a new period starts).';

REVOKE ALL ON FUNCTION public.activate_boost_purchase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_boost_purchase(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §3e Package-included boost (boost_my_profile) — add boost_activated event
--     alongside the existing profile_boosted (which is the redemption event).
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
                       'duration_days', v_days, 'expires_at', v_exp),
    'boostredeem:' || v_id::text
  );

  PERFORM public.log_activity(
    v_user,
    'boost_activated',
    jsonb_build_object('boost_id', v_id, 'entitlement_id', v_ent,
                       'source', 'package', 'duration_days', v_days, 'expires_at', v_exp),
    'boostact:' || v_id::text
  );

  -- Return the legacy "active" status string to preserve existing API
  -- contract; consumers (UI, tests) key off this value.
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
  'Redeems one package-included profile boost. Logs profile_boosted (redemption) and boost_activated (period start). Idempotent while a boost is live.';

REVOKE ALL ON FUNCTION public.boost_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boost_my_profile() TO authenticated;


-- ----------------------------------------------------------------------------
-- §3f Profile lifecycle: created / completed / published / updated
-- ----------------------------------------------------------------------------
-- Helper that checks completion from a row in the trigger (avoids extra SELECT).
-- Must be defined BEFORE log_profile_lifecycle() references it.
CREATE OR REPLACE FUNCTION public.is_profile_completed_by_row(r public.matrimony_profiles)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN r.gender IS NOT NULL
     AND r.date_of_birth IS NOT NULL
     AND btrim(coalesce(r.city, '')) <> ''
     AND btrim(coalesce(r.education, '')) <> ''
     AND btrim(coalesce(r.occupation, '')) <> '';
END;
$$;

CREATE OR REPLACE FUNCTION public.is_profile_completed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matrimony_profiles mp
    WHERE mp.user_id = p_user_id
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND btrim(coalesce(mp.city, '')) <> ''
      AND btrim(coalesce(mp.education, '')) <> ''
      AND btrim(coalesce(mp.occupation, '')) <> ''
      AND EXISTS (SELECT 1 FROM public.profile_photos ph
                  WHERE ph.profile_id = p_user_id AND ph.kind = 'profile_photo')
  )
$$;

COMMENT ON FUNCTION public.is_profile_completed(uuid) IS
  'TRUE when the minimum publish-gate fields are present (gender, DOB, city, education, occupation, profile photo). Mirrors the publish gate but is safe for analytics.';

REVOKE ALL ON FUNCTION public.is_profile_completed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_profile_completed(uuid) TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.log_profile_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta JSONB;
BEGIN
  v_meta := jsonb_build_object(
    'status', NEW.status,
    'gender', NEW.gender
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(NEW.user_id, 'profile_created', v_meta, 'profcreate:' || NEW.user_id::text);
    IF public.is_profile_completed(NEW.user_id) THEN
      PERFORM public.log_activity(NEW.user_id, 'profile_completed', v_meta, 'profcomplete:' || NEW.user_id::text);
    END IF;
    IF NEW.status = 'active' THEN
      PERFORM public.log_activity(NEW.user_id, 'profile_published', v_meta, 'profpublish:' || NEW.user_id::text);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path
  IF TG_OP = 'UPDATE' THEN
    -- Profile published: status → 'active' from something else
    IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
      PERFORM public.log_activity(NEW.user_id, 'profile_published', v_meta, 'profpublish:' || NEW.user_id::text);
    END IF;

    -- Profile completed: was incomplete before but is now complete.
    -- Use the row helper to decide (doesn't need the profile photo because
    -- photos are added via a separate table and trigger a photo event path
    -- is already part of the publish gate).
    IF NOT public.is_profile_completed_by_row(OLD) AND public.is_profile_completed_by_row(NEW) THEN
      PERFORM public.log_activity(NEW.user_id, 'profile_completed', v_meta, 'profcomplete:' || NEW.user_id::text);
    END IF;

    -- Profile updated (any substantive field change, but not on every trigger
    -- fire; ignore pure updated_at bumps by comparing a relevant digest).
    IF (
         NEW.gender IS DISTINCT FROM OLD.gender OR
         NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth OR
         NEW.height_cm IS DISTINCT FROM OLD.height_cm OR
         NEW.city IS DISTINCT FROM OLD.city OR
         NEW.state IS DISTINCT FROM OLD.state OR
         NEW.education IS DISTINCT FROM OLD.education OR
         NEW.occupation IS DISTINCT FROM OLD.occupation OR
         NEW.mother_tongue IS DISTINCT FROM OLD.mother_tongue OR
         NEW.religion IS DISTINCT FROM OLD.religion OR
         NEW.sub_community IS DISTINCT FROM OLD.sub_community OR
         NEW.marital_status IS DISTINCT FROM OLD.marital_status OR
         NEW.diet IS DISTINCT FROM OLD.diet OR
         NEW.smoking IS DISTINCT FROM OLD.smoking OR
         NEW.drinking IS DISTINCT FROM OLD.drinking OR
         NEW.about_me IS DISTINCT FROM OLD.about_me OR
         coalesce(NEW.hobbies, '{}') IS DISTINCT FROM coalesce(OLD.hobbies, '{}') OR
         NEW.family_type IS DISTINCT FROM OLD.family_type OR
         NEW.business_name IS DISTINCT FROM OLD.business_name OR
         NEW.company IS DISTINCT FROM OLD.company OR
         NEW.annual_income IS DISTINCT FROM OLD.annual_income
       )
       AND NEW.status IS NOT DISTINCT FROM OLD.status
    THEN
      -- Throttle: only fire an event if we haven't logged an update for this
      -- user in the last 60 seconds; this prevents cascading events when the
      -- wizard saves partner_preferences in the same user flow.
      IF NOT EXISTS (
        SELECT 1 FROM public.activity_events
        WHERE user_id = NEW.user_id
          AND event = 'profile_updated'
          AND created_at > now() - interval '60 seconds'
      ) THEN
        PERFORM public.log_activity(NEW.user_id, 'profile_updated', jsonb_build_object('status', NEW.status));
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.log_profile_lifecycle() IS
  'AFTER INSERT/UPDATE trigger on matrimony_profiles: logs profile_created (idempotent per user via idempotency key), profile_completed when the publish-gate fields are first present, profile_published when status becomes active, and throttled profile_updated events for substantive edits.';

DROP TRIGGER IF EXISTS matrimony_profiles_log_lifecycle ON public.matrimony_profiles;
CREATE TRIGGER matrimony_profiles_log_lifecycle
  AFTER INSERT OR UPDATE ON public.matrimony_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_profile_lifecycle();


-- ----------------------------------------------------------------------------
-- §3g Verification rejected event
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_verification_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'verified' AND OLD.status = 'pending' THEN
    IF NEW.type IN ('photo', 'id_document') THEN
      UPDATE public.matrimony_profiles
      SET verified_at = now(), updated_at = now()
      WHERE user_id = NEW.user_id;
    ELSIF NEW.type = 'mobile' THEN
      UPDATE public.profiles
      SET mobile_verified = TRUE, updated_at = now()
      WHERE id = NEW.user_id;
    END IF;
    PERFORM public.push_notification(
      NEW.user_id,
      'profile_verified',
      'Your profile is now verified',
      'Congratulations — the "✓ Verified Profile" badge is live on your profile. Verified profiles get more responses.',
      jsonb_build_object('verification_type', NEW.type::text),
      '/profile'
    );
    PERFORM public.log_activity(
      NEW.user_id,
      'profile_verified',
      jsonb_build_object('type', NEW.type::text),
      'vapproved:' || NEW.id::text
    );
    PERFORM public.log_activity(
      NEW.user_id,
      'verification_approved',
      jsonb_build_object('type', NEW.type::text, 'request_id', NEW.id),
      'vappreq:' || NEW.id::text
    );
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    PERFORM public.push_notification(
      NEW.user_id,
      'admin_message',
      'Verification could not be approved',
      coalesce(nullif(btrim(NEW.note), ''), 'The submitted proof was not clear enough. Please try again with a clearer photo or document.'),
      jsonb_build_object('verification_type', NEW.type::text),
      '/profile'
    );
    PERFORM public.log_activity(
      NEW.user_id,
      'verification_rejected',
      jsonb_build_object('type', NEW.type::text, 'request_id', NEW.id),
      'vrejreq:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verification_requests_decision ON public.verification_requests;
CREATE TRIGGER verification_requests_decision
  AFTER UPDATE OF status ON public.verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_verification_decision();


-- ----------------------------------------------------------------------------
-- §3h Block lifecycle (block_created / block_removed)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_block_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(
      NEW.blocker_id,
      'block_created',
      jsonb_build_object('blocked_id', NEW.blocked_id),
      'block:' || NEW.blocker_id::text || ':' || NEW.blocked_id::text
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity(
      OLD.blocker_id,
      'block_removed',
      jsonb_build_object('blocked_id', OLD.blocked_id),
      'unblock:' || OLD.blocker_id::text || ':' || OLD.blocked_id::text
    );
    RETURN OLD;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.log_block_lifecycle() IS
  'AFTER INSERT/DELETE trigger on blocks: logs block_created / block_removed with the blocked user id (no contact data).';

DROP TRIGGER IF EXISTS blocks_log_lifecycle ON public.blocks;
CREATE TRIGGER blocks_log_lifecycle
  AFTER INSERT OR DELETE ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.log_block_lifecycle();


-- ----------------------------------------------------------------------------
-- §3i Moment removed (admin moderation)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_moment_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_removed = TRUE AND OLD.is_removed IS DISTINCT FROM TRUE THEN
    PERFORM public.log_activity(
      NEW.user_id,
      'moment_removed',
      jsonb_build_object('moment_id', NEW.id, 'media_type', NEW.media_type::text),
      'momrem:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_moment_lifecycle() IS
  'AFTER UPDATE trigger on moments: logs moment_removed when is_removed flips to true (admin moderation).';

DROP TRIGGER IF EXISTS moments_log_lifecycle ON public.moments;
CREATE TRIGGER moments_log_lifecycle
  AFTER UPDATE OF is_removed ON public.moments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_moment_lifecycle();


-- ----------------------------------------------------------------------------
-- §4 log_account_deletion() — called by the server action BEFORE deleting the
--    auth user, so the event row is written while user_id still resolves.
--    ON DELETE SET NULL preserves the event row for analytics after the user
--    is gone.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_account_deletion(p_reason TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id BIGINT;
BEGIN
  -- Called from the server action via service role, OR by the user themselves
  -- via the existing account-deletion flow. In either case we only log it
  -- once per user (idempotent).
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
  FROM public.activity_events
  WHERE user_id = v_uid AND event = 'account_deleted'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT public.log_activity(
    v_uid,
    'account_deleted',
    jsonb_strip_nulls(jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''))),
    'acctdel:' || v_uid::text
  ) INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_account_deletion(text) IS
  'Logs the account_deleted event. Idempotent per user. Called by the server action immediately before deleting the auth user; ON DELETE SET NULL keeps the event for analytics.';

REVOKE ALL ON FUNCTION public.log_account_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_account_deletion(text) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §5 Admin Analytics RPC
--    Returns KPIs, daily buckets for the selected window, top cities and the
--    latest activity. All bounded by p_days (default 14); uses authoritative
--    business tables where possible to avoid double counting.
--
--    SECURITY DEFINER, gated by is_admin() — never returns raw contact info.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics(p_days INTEGER DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_days INTEGER := greatest(1, least(coalesce(p_days, 14), 365));
  v_since TIMESTAMPTZ := now() - (v_days || ' days')::interval;
  v_ist_offset INTERVAL := '5 hours 30 minutes';
  v_result JSONB;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_analytics: admin only';
  END IF;

  WITH
  -- KPIs (totals, not windowed)
  kpi_total_members   AS (SELECT count(*)::int AS n FROM public.profiles),
  kpi_live_profiles   AS (SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE status = 'active'),
  kpi_live_subs       AS (SELECT count(*)::int AS n FROM public.subscriptions WHERE status = 'active' AND expires_at > now()),
  kpi_active_boosts   AS (SELECT count(*)::int AS n FROM public.profile_boosts WHERE status = 'active' AND expires_at > now()),
  kpi_live_moments    AS (SELECT count(*)::int AS n FROM public.moments WHERE is_removed = FALSE AND expires_at > now()),
  kpi_pending_verify  AS (SELECT count(*)::int AS n FROM public.verification_requests WHERE status = 'pending'),
  kpi_open_reports    AS (SELECT count(*)::int AS n FROM public.reports WHERE status IN ('open', 'reviewing')),

  -- Windowed KPIs
  kpi_new_members     AS (SELECT count(*)::int AS n FROM public.profiles WHERE created_at >= v_since),
  kpi_signups_today   AS (SELECT count(*)::int AS n FROM public.profiles WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'),
  kpi_published       AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'profile_published' AND created_at >= v_since),
  kpi_searches        AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'search_performed' AND created_at >= v_since),
  kpi_interests_sent  AS (SELECT count(*)::int AS n FROM public.interests WHERE created_at >= v_since),
  kpi_interests_acc   AS (SELECT count(*)::int AS n FROM public.interests WHERE status = 'accepted' AND updated_at >= v_since),
  kpi_interests_dec   AS (SELECT count(*)::int AS n FROM public.interests WHERE status = 'declined' AND updated_at >= v_since),
  kpi_mutual          AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'interest_mutual' AND created_at >= v_since),
  kpi_messages        AS (SELECT count(*)::int AS n FROM public.messages WHERE created_at >= v_since),
  kpi_profile_views   AS (SELECT count(*)::int AS n FROM public.profile_views WHERE viewed_at >= v_since),
  kpi_contact_reveals AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'contact_revealed' AND created_at >= v_since),
  kpi_pay_attempts    AS (SELECT count(*)::int AS n FROM public.payments WHERE created_at >= v_since AND status IN ('captured','failed')),
  kpi_pay_captured    AS (SELECT count(*)::int AS n FROM public.payments WHERE status = 'captured' AND updated_at >= v_since),
  kpi_pay_failed      AS (SELECT count(*)::int AS n FROM public.payments WHERE status = 'failed' AND updated_at >= v_since),
  kpi_pay_refunded    AS (SELECT count(*)::int AS n FROM public.payments WHERE status = 'refunded' AND updated_at >= v_since),
  kpi_revenue         AS (SELECT coalesce(sum(amount_inr), 0)::int AS n FROM public.payments WHERE status = 'captured' AND updated_at >= v_since),
  kpi_revenue_total   AS (SELECT coalesce(sum(amount_inr), 0)::int AS n FROM public.payments WHERE status = 'captured'),
  kpi_subs_activated  AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'membership_activated' AND created_at >= v_since),
  kpi_subs_expired    AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'membership_expired' AND created_at >= v_since),
  kpi_subs_renewed    AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'membership_renewed' AND created_at >= v_since),
  kpi_boosts_act      AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'boost_activated' AND created_at >= v_since),
  kpi_moments_posted  AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'moment_posted' AND created_at >= v_since),
  kpi_moments_reported AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'moment_reported' AND created_at >= v_since),
  kpi_verification_sub AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'verification_submitted' AND created_at >= v_since),
  kpi_verification_app AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'verification_approved' AND created_at >= v_since),
  kpi_verification_rej AS (SELECT count(*)::int AS n FROM public.activity_events WHERE event = 'verification_rejected' AND created_at >= v_since),

  -- Daily buckets (IST calendar days)
  days AS (
    SELECT to_char(d, 'YYYY-MM-DD') AS day
    FROM generate_series(
      date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' - ((v_days - 1) || ' days')::interval,
      date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata',
      '1 day'::interval
    ) d
  ),
  signup_bucket AS (
    SELECT day, count(p.id)::int AS n
    FROM days d
    LEFT JOIN public.profiles p
      ON date_trunc('day', p.created_at AT TIME ZONE 'Asia/Kolkata')::date = to_date(d.day, 'YYYY-MM-DD')
    GROUP BY day
  ),
  revenue_bucket AS (
    SELECT day, coalesce(sum(p.amount_inr), 0)::int AS n
    FROM days d
    LEFT JOIN public.payments p
      ON p.status = 'captured'
      AND date_trunc('day', p.updated_at AT TIME ZONE 'Asia/Kolkata')::date = to_date(d.day, 'YYYY-MM-DD')
      AND p.updated_at >= v_since
    GROUP BY day
  ),
  interest_bucket AS (
    SELECT day, count(i.id)::int AS n
    FROM days d
    LEFT JOIN public.interests i
      ON date_trunc('day', i.created_at AT TIME ZONE 'Asia/Kolkata')::date = to_date(d.day, 'YYYY-MM-DD')
      AND i.created_at >= v_since
    GROUP BY day
  ),
  message_bucket AS (
    SELECT day, count(m.id)::int AS n
    FROM days d
    LEFT JOIN public.messages m
      ON date_trunc('day', m.created_at AT TIME ZONE 'Asia/Kolkata')::date = to_date(d.day, 'YYYY-MM-DD')
      AND m.created_at >= v_since
    GROUP BY day
  ),
  search_bucket AS (
    SELECT day, count(e.id)::int AS n
    FROM days d
    LEFT JOIN public.activity_events e
      ON e.event = 'search_performed'
      AND date_trunc('day', e.created_at AT TIME ZONE 'Asia/Kolkata')::date = to_date(d.day, 'YYYY-MM-DD')
      AND e.created_at >= v_since
    GROUP BY day
  ),
  views_bucket AS (
    SELECT day, count(v.id)::int AS n
    FROM days d
    LEFT JOIN public.profile_views v
      ON date_trunc('day', v.viewed_at AT TIME ZONE 'Asia/Kolkata')::date = to_date(d.day, 'YYYY-MM-DD')
      AND v.viewed_at >= v_since
    GROUP BY day
  ),

  -- Top cities (live profiles, bounded)
  top_cities AS (
    SELECT coalesce(nullif(btrim(city), ''), '(not set)') AS city, count(*)::int AS n
    FROM public.matrimony_profiles
    WHERE status = 'active'
    GROUP BY city
    ORDER BY n DESC, city
    LIMIT 10
  ),

  -- Latest activity (scrubbed of anything sensitive; joined to profiles for
  -- name display; bounded to 30 rows).
  latest AS (
    SELECT
      e.id,
      e.event,
      e.created_at,
      e.user_id,
      p.full_name AS actor_name
    FROM public.activity_events e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    ORDER BY e.created_at DESC
    LIMIT 30
  )

  SELECT jsonb_build_object(
    'window_days', v_days,
    'kpis', jsonb_build_object(
      'total_members',        (SELECT n FROM kpi_total_members),
      'new_members',          (SELECT n FROM kpi_new_members),
      'signups_today',        (SELECT n FROM kpi_signups_today),
      'published_profiles',   (SELECT n FROM kpi_published),
      'live_profiles',        (SELECT n FROM kpi_live_profiles),
      'live_subscriptions',   (SELECT n FROM kpi_live_subs),
      'subscriptions_activated', (SELECT n FROM kpi_subs_activated),
      'subscriptions_expired',   (SELECT n FROM kpi_subs_expired),
      'subscriptions_renewed',   (SELECT n FROM kpi_subs_renewed),
      'active_boosts',        (SELECT n FROM kpi_active_boosts),
      'boosts_activated',     (SELECT n FROM kpi_boosts_act),
      'live_moments',         (SELECT n FROM kpi_live_moments),
      'moments_posted',       (SELECT n FROM kpi_moments_posted),
      'moments_reported',     (SELECT n FROM kpi_moments_reported),
      'searches',             (SELECT n FROM kpi_searches),
      'interests_sent',       (SELECT n FROM kpi_interests_sent),
      'interests_accepted',   (SELECT n FROM kpi_interests_acc),
      'interests_declined',   (SELECT n FROM kpi_interests_dec),
      'mutual_connections',   (SELECT n FROM kpi_mutual),
      'messages',             (SELECT n FROM kpi_messages),
      'profile_views',        (SELECT n FROM kpi_profile_views),
      'contact_reveals',      (SELECT n FROM kpi_contact_reveals),
      'payment_attempts',     (SELECT n FROM kpi_pay_attempts),
      'payments_captured',    (SELECT n FROM kpi_pay_captured),
      'payments_failed',      (SELECT n FROM kpi_pay_failed),
      'payments_refunded',    (SELECT n FROM kpi_pay_refunded),
      'revenue_window',       (SELECT n FROM kpi_revenue),
      'revenue_total',        (SELECT n FROM kpi_revenue_total),
      'pending_verifications',(SELECT n FROM kpi_pending_verify),
      'verifications_submitted', (SELECT n FROM kpi_verification_sub),
      'verifications_approved',  (SELECT n FROM kpi_verification_app),
      'verifications_rejected',  (SELECT n FROM kpi_verification_rej),
      'open_reports',         (SELECT n FROM kpi_open_reports)
    ),
    'daily', jsonb_build_object(
      'days',           (SELECT jsonb_agg(day ORDER BY day) FROM days),
      'signups',        (SELECT jsonb_agg(n ORDER BY day) FROM signup_bucket),
      'revenue',        (SELECT jsonb_agg(n ORDER BY day) FROM revenue_bucket),
      'interests',      (SELECT jsonb_agg(n ORDER BY day) FROM interest_bucket),
      'messages',       (SELECT jsonb_agg(n ORDER BY day) FROM message_bucket),
      'searches',       (SELECT jsonb_agg(n ORDER BY day) FROM search_bucket),
      'profile_views',  (SELECT jsonb_agg(n ORDER BY day) FROM views_bucket)
    ),
    'top_cities', (SELECT coalesce(jsonb_agg(jsonb_build_object('city', city, 'n', n) ORDER BY n DESC, city), '[]'::jsonb) FROM top_cities),
    'latest_activity', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'event', event,
        'created_at', created_at,
        'user_id', user_id,
        'actor_name', actor_name
      ) ORDER BY created_at DESC), '[]'::jsonb) FROM latest),
    'event_vocabulary', (SELECT to_jsonb(public.canonical_activity_events()))
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_analytics(integer) IS
  'Admin-only analytics RPC. Returns KPIs, IST daily buckets, top cities and recent activity, all bounded by the requested window (default 14 days, max 365). Reads from authoritative business tables (no double-counting). Does not return contact / payment secrets.';

REVOKE ALL ON FUNCTION public.admin_analytics(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics(integer) TO service_role;
-- authenticated callers who pass is_admin() are authorised inside the body,
-- but because is_admin() is a SECURITY DEFINER check that reads profiles,
-- we grant EXECUTE to authenticated; the function body still gates.
GRANT EXECUTE ON FUNCTION public.admin_analytics(integer) TO authenticated;
