-- ============================================================================
-- Mali Vivah — Phase 2: purchasable profile boosts
-- ============================================================================
--   §1 created_via semantics — 'plan' (quota-counted, via boost_my_profile())
--      vs 'purchase:<payment_id>' (paid à la carte, never quota-counted).
--      Backfills existing rows, then narrows boost_my_profile()'s quota
--      counter to plan boosts only.
--   §2 activate_purchased_boost() — service-role-only activation for a
--      captured boost payment. Idempotent per payment, mirrors the
--      activate_membership() conventions (notification + activity event).
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260915130000 (profile_boosts,
-- boost_my_profile, push_notification, log_activity) and 20260919000000
-- (site_config for boost_duration_days).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 created_via semantics + quota narrowing
-- ----------------------------------------------------------------------------
UPDATE public.profile_boosts
SET created_via = 'plan'
WHERE created_via IS NULL OR btrim(created_via) = '';

COMMENT ON COLUMN public.profile_boosts.created_via IS
  'How the boost was granted: ''plan'' (counts against the membership boosts_included quota) or ''purchase:<payment_id>'' (paid à la carte, never quota-counted).';

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
  v_started  TIMESTAMPTZ;
  v_id       BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'boost_my_profile: not authenticated';
  END IF;

  -- Already boosted → idempotent (a purchased boost also counts as running).
  SELECT b.id, b.expires_at INTO v_id, v_started
  FROM public.profile_boosts b
  WHERE b.user_id = v_user AND b.status = 'active' AND b.expires_at > now()
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_active', 'boost_id', v_id, 'expires_at', v_started);
  END IF;

  v_included := (public.get_membership(v_user) -> 'benefits' ->> 'boosts_included')::numeric;
  IF v_included IS NULL OR v_included <= 0 THEN
    RAISE EXCEPTION 'BOOSTS_NOT_INCLUDED: your current plan does not include profile boosts';
  END IF;

  -- Count PLAN boosts used since the current membership started. Purchased
  -- boosts (created_via = 'purchase:…') never consume the plan quota.
  SELECT greatest(coalesce((public.get_membership(v_user) ->> 'started_at')::timestamptz, now() - interval '10 years'), now() - interval '10 years')
  INTO v_started;
  SELECT count(*) INTO v_used
  FROM public.profile_boosts b
  WHERE b.user_id = v_user
    AND b.created_via = 'plan'
    AND b.created_at >= v_started;
  IF v_used >= v_included THEN
    RAISE EXCEPTION 'BOOST_LIMIT_REACHED: your current plan includes % boosts', floor(v_included);
  END IF;

  INSERT INTO public.profile_boosts (user_id, created_via)
  VALUES (v_user, 'plan')
  RETURNING id INTO v_id;

  PERFORM public.log_activity(v_user, 'profile_boosted', jsonb_build_object('boost_id', v_id));

  RETURN jsonb_build_object(
    'status', 'active',
    'boost_id', v_id,
    'expires_at', now() + interval '7 days'
  );
END;
$$;

COMMENT ON FUNCTION public.boost_my_profile() IS
  'Activates a 7-day plan boost. Enforces the boosts_included quota within the current membership period (purchased boosts never consume quota); idempotent while any boost is running.';

REVOKE ALL ON FUNCTION public.boost_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boost_my_profile() TO authenticated;


-- ----------------------------------------------------------------------------
-- §2 activate_purchased_boost()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_purchased_boost(
  p_user_id    UUID,
  p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay      RECORD;
  v_days     INTEGER;
  v_boost_id BIGINT;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'activate_purchased_boost: user id and payment id required';
  END IF;

  SELECT * INTO v_pay
  FROM public.payments p
  WHERE p.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_purchased_boost: payment % not found', p_payment_id;
  END IF;
  IF v_pay.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'activate_purchased_boost: payment does not belong to user';
  END IF;
  IF coalesce(v_pay.metadata ->> 'kind', '') <> 'boost' THEN
    RAISE EXCEPTION 'activate_purchased_boost: payment % is not a boost purchase', p_payment_id;
  END IF;

  -- Idempotency: this payment already activated a boost → return it.
  SELECT b.id, b.expires_at INTO v_boost_id, v_expires
  FROM public.profile_boosts b
  WHERE b.user_id = p_user_id
    AND b.created_via = 'purchase:' || p_payment_id::text
  LIMIT 1;
  IF v_boost_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'boost_id', v_boost_id, 'expires_at', v_expires,
      'status', 'already_activated'
    );
  END IF;

  -- Boost length is operator-configurable (site_config.boost_duration_days).
  SELECT coalesce(nullif(btrim(c.value::text, '"'), ''), '7')::integer INTO v_days
  FROM public.site_config c
  WHERE c.key = 'boost_duration_days';
  v_days := greatest(coalesce(v_days, 7), 1);

  v_expires := now() + make_interval(days => v_days);

  INSERT INTO public.profile_boosts (user_id, created_via, expires_at)
  VALUES (p_user_id, 'purchase:' || p_payment_id::text, v_expires)
  RETURNING id INTO v_boost_id;

  UPDATE public.payments
  SET status = 'captured',
      updated_at = now()
  WHERE id = p_payment_id;

  PERFORM public.push_notification(
    p_user_id,
    'payment_received',
    'Profile boost is live',
    format('Your profile now appears first in Brides, Grooms and Search for the next %s days.', v_days),
    jsonb_build_object('boost_id', v_boost_id, 'payment_id', p_payment_id),
    '/profile'
  );

  PERFORM public.log_activity(
    p_user_id,
    'boost_purchased',
    jsonb_build_object('boost_id', v_boost_id, 'payment_id', p_payment_id,
                       'amount_inr', v_pay.amount_inr, 'expires_at', v_expires)
  );

  RETURN jsonb_build_object(
    'boost_id', v_boost_id,
    'expires_at', v_expires,
    'status', 'activated'
  );
END;
$$;

COMMENT ON FUNCTION public.activate_purchased_boost(uuid, uuid) IS
  'Activates a paid à la carte profile boost after server-side payment verification (the ONLY purchased-boost write path). Idempotent per payment; mirrors the activate_membership() conventions.';

REVOKE ALL ON FUNCTION public.activate_purchased_boost(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_purchased_boost(uuid, uuid) TO service_role;
