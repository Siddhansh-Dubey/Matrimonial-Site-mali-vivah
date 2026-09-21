-- ============================================================================
-- Mali Vivah · Admin membership REVOCATION (entitlement, not money)
--
-- THE GAP
--   The admin panel could ACTIVATE a membership (activate_membership, the same
--   RPC Razorpay uses) and could process a financial REFUND
--   (refund_membership), but it had no way to simply STOP an active paid
--   membership for a support reason — a mistaken activation, a fraudulent
--   payment, a refund handled outside Razorpay, a manual correction. The only
--   levers were "suspend the whole profile" or "mark the payment refunded",
--   and the second one rewrites the financial record, which is wrong when no
--   money actually moved back.
--
-- REVOCATION ≠ REFUND (deliberately separate, both preserved)
--   refund_membership(payment_id)  → financial reversal: payments.status
--                                    becomes 'refunded'. Used when Razorpay
--                                    really returned the money.
--   admin_revoke_membership(...)   → entitlement reversal ONLY. The payments
--                                    row is never touched: status stays
--                                    'captured', razorpay_order_id,
--                                    razorpay_payment_id, amount_inr,
--                                    currency and created_at stay byte-for-byte
--                                    what they were. Nothing is deleted, no
--                                    refund is faked, no history is erased.
--
-- WHAT IS REVOKED — AND WHAT IS NOT
--   The authoritative membership mechanism in this database is ONE table:
--   public.subscriptions ("a member is paid while ANY row is active and
--   unexpired" — has_live_membership(), get_membership(), has_benefit(),
--   express_interest(), chat, Daily 5, search, visibility and both expiry
--   sweeps all read it). This RPC cancels exactly ONE of those rows — the live
--   PAID entitlement — and then lets the EXISTING time-aware gates recompute
--   everything else. There is no second membership system and no duplicated
--   capability logic here.
--
--   Because a member can hold several entitlements at once, the selection is
--   explicit:
--     * payment-backed subscriptions (Razorpay) — revocable;
--     * admin/manual activations of a real paid package (payment_id NULL,
--       e.g. Premium granted from Admin → Members) — revocable;
--     * PROMOTIONAL Platinum launch grants ('platinum-launch-30d',
--       'platinum-demo-24h', tier 'platinum', price 0, payment_id NULL) —
--       NEVER selected by default. They are a free launch promise, not a paid
--       membership; revoking "Premium" must not confiscate them.
--     * Profile Boosts (profile_boosts / profile_boost_entitlements) — NOT
--       touched. Featured status (featured_profiles) — NOT touched (it already
--       self-suppresses when the profile stops being public).
--   If another entitlement is still live after the cancellation,
--   has_live_membership() stays TRUE, the profile keeps its paid visibility,
--   search/matching/Express Interest keep working, and the profile status is
--   NOT changed. Only when nothing live remains does the profile leave the
--   directory — and it lands on 'expired', the exact status the existing
--   sweep_expired_memberships() / sweep_my_membership() produce for a lapsed
--   membership.
--
-- SECURITY
--   * SECURITY DEFINER with a pinned search_path, EXECUTE for service_role
--     ONLY (revoked from PUBLIC/anon/authenticated) — the browser can never
--     call it, and a member JWT cannot either.
--   * Authorised by public.admin_assert_actor(p_admin_id): the SAME single
--     authoritative admin check every other admin RPC uses. A leaked service
--     key alone cannot revoke anything anonymously — p_admin_id must name a
--     real profiles.is_admin row.
--   * No argument is trusted as authority: the target subscription is looked
--     up in the database, must belong to p_user_id, and promotional grants are
--     excluded. A client cannot forge a revocation by supplying ids, slugs,
--     amounts or a "reason" that changes behaviour.
--   * Existing self-protection rules apply: ADMIN_SELF_ACTION (you cannot
--     revoke your own membership here), the account must exist.
--   * Concurrency: the same per-member advisory lock activate_membership() and
--     refund_membership() take (hashtext('membership:' || user_id)) plus a row
--     lock on the member and the subscription, so a revocation racing a
--     webhook activation or a refund cannot double-apply or resurrect time.
--   * Idempotent: a second call finds no live paid entitlement and returns
--     changed=false instead of erroring; the activity event carries an
--     idempotency key ('subrevoke:<subscription id>').
--   * Audited in the EXISTING admin_audit_log (admin id, member id,
--     subscription id, package id/slug/tier, previous and new status, the
--     preserved payment identity and amount, reason and note, timestamps) and
--     recorded in the EXISTING activity_events stream + notifications. No
--     second audit system.
--
-- PRICING / RAZORPAY
--   Unchanged. Smart ₹999/90 · Premium ₹2,499/180 · VIP ₹4,999/365 stay
--   authoritative, no package row is edited, and no part of the Razorpay
--   order → checkout → verify → webhook → payment → activation chain is
--   touched.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- DEPENDS ON 20260919120000_admin_member_management.sql (admin_assert_actor),
-- 20260920150000_payment_membership_lifecycle_audit.sql (payment/subscription
-- lifecycle) and 20260920190000_platinum_launch_offer.sql (promotional
-- packages). Deploy together with the new `revokeMembership` server action and
-- the Admin → Member page control.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.admin_assert_actor(uuid)') IS NULL
     OR to_regprocedure('public.has_live_membership(uuid)') IS NULL
     OR to_regprocedure('public.get_membership(uuid)') IS NULL
     OR to_regprocedure('public.log_activity(uuid, text, jsonb, text)') IS NULL
     OR to_regprocedure('public.push_notification(uuid, public.notification_type, text, text, jsonb, text)') IS NULL
     OR to_regclass('public.admin_audit_log') IS NULL
     OR to_regclass('public.subscriptions') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'admin_revoke_membership: prerequisite migrations are not applied',
      HINT    = 'Apply every earlier file in supabase/migrations/ first.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 admin_revoke_membership() — the one revocation path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revoke_membership(
  p_admin_id        UUID,
  p_user_id         UUID,
  p_reason          TEXT    DEFAULT NULL,
  p_note            TEXT    DEFAULT NULL,
  p_subscription_id BIGINT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_reasons TEXT[] := ARRAY[
    'refund',                -- money returned (or being returned) out of band
    'fraud',                 -- fraudulent / suspicious / chargeback-risk payment
    'incorrect_activation',  -- the plan was activated by mistake
    'support_action',        -- support decision
    'manual_correction',     -- data correction
    'other'
  ];

  v_profile   public.profiles%ROWTYPE;
  v_sub       public.subscriptions%ROWTYPE;
  v_pay       public.payments%ROWTYPE;
  v_mp_before public.matrimony_profiles%ROWTYPE;
  v_mp_after  public.matrimony_profiles%ROWTYPE;
  v_tier      public.membership_tier;
  v_pkg_name  TEXT;
  v_reason    TEXT := lower(btrim(coalesce(p_reason, '')));
  v_note      TEXT := nullif(btrim(coalesce(p_note, '')), '');
  v_still_live BOOLEAN;
  v_promotional BOOLEAN;
  v_remaining JSONB;
BEGIN
  -- ONE authoritative admin check (shared with every other admin RPC).
  PERFORM public.admin_assert_actor(p_admin_id);

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_SELF_ACTION: you cannot revoke your own membership here';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: choose why the membership is being revoked';
  END IF;
  IF NOT (v_reason = ANY (c_reasons)) THEN
    RAISE EXCEPTION 'INVALID_REASON: unknown revocation reason %', v_reason;
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    v_note := left(v_note, 1000);
  END IF;

  -- Same lock activate_membership() and refund_membership() take, so a
  -- revocation cannot race a webhook activation or a refund for one member.
  PERFORM pg_advisory_xact_lock(hashtext('membership:' || p_user_id::text));

  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no such member';
  END IF;

  SELECT mp.* INTO v_mp_before
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = p_user_id;

  --------------------------------------------------------------------------
  -- Identify the entitlement to revoke.
  --------------------------------------------------------------------------
  IF p_subscription_id IS NOT NULL THEN
    SELECT s.* INTO v_sub
    FROM public.subscriptions s
    WHERE s.id = p_subscription_id AND s.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: that subscription does not belong to this member';
    END IF;

    SELECT pk.tier, pk.name INTO v_tier, v_pkg_name
    FROM public.packages pk WHERE pk.id = v_sub.package_id;
    v_promotional := coalesce(v_tier = 'platinum', FALSE)
                     OR v_sub.package_slug IN ('platinum-launch-30d', 'platinum-demo-24h');

    -- Promotional launch grants are a separate promise, never a paid
    -- membership. Refuse rather than silently confiscating a free grant.
    IF v_promotional THEN
      RAISE EXCEPTION 'PROMOTIONAL_ENTITLEMENT: promotional Platinum grants are not paid memberships; let them expire or reset the launch campaign';
    END IF;

    IF v_sub.status IS DISTINCT FROM 'active' OR v_sub.expires_at <= now() THEN
      -- Idempotent replay: already gone. Report the truth, change nothing.
      RETURN jsonb_build_object(
        'status', 'already_revoked', 'changed', FALSE,
        'subscription_id', v_sub.id,
        'package_slug', v_sub.package_slug,
        'tier', coalesce(v_tier::text, 'unknown'),
        'subscription_status', v_sub.status::text,
        'expires_at', v_sub.expires_at,
        'live_membership', public.has_live_membership(p_user_id),
        'membership', public.get_membership(p_user_id)
      );
    END IF;
  ELSE
    -- Default target: the live PAID entitlement with the longest remaining
    -- runway (the same row get_membership() reports to the admin UI). A
    -- promotional Platinum grant is excluded, so revoking "Premium" can never
    -- touch the launch offer.
    SELECT s.* INTO v_sub
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status = 'active'
      AND s.expires_at > now()
      AND (s.payment_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.packages pk
                          WHERE pk.id = s.package_id
                            AND (pk.tier = 'platinum'
                                 OR pk.slug IN ('platinum-launch-30d', 'platinum-demo-24h'))))
    ORDER BY s.expires_at DESC, s.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'status', 'no_active_paid_membership', 'changed', FALSE,
        'live_membership', public.has_live_membership(p_user_id),
        'promotional_live', EXISTS (
          SELECT 1 FROM public.subscriptions s2
          JOIN public.packages pk2 ON pk2.id = s2.package_id
          WHERE s2.user_id = p_user_id AND s2.status = 'active' AND s2.expires_at > now()
            AND (pk2.tier = 'platinum' OR pk2.slug IN ('platinum-launch-30d', 'platinum-demo-24h'))
        ),
        'membership', public.get_membership(p_user_id)
      );
    END IF;

    SELECT pk.tier, pk.name INTO v_tier, v_pkg_name
    FROM public.packages pk WHERE pk.id = v_sub.package_id;
    v_promotional := FALSE;
  END IF;

  -- The payment row is READ, never written. Its identity and amount are
  -- carried into the audit record so the money trail survives the revocation.
  IF v_sub.payment_id IS NOT NULL THEN
    SELECT p.* INTO v_pay FROM public.payments p WHERE p.id = v_sub.payment_id;
  END IF;

  --------------------------------------------------------------------------
  -- Revoke the entitlement.
  --------------------------------------------------------------------------
  UPDATE public.subscriptions
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_sub.id AND status = 'active';

  --------------------------------------------------------------------------
  -- Recalculate the effective membership state with the EXISTING gates.
  --------------------------------------------------------------------------
  v_still_live := public.has_live_membership(p_user_id);

  IF NOT v_still_live THEN
    -- Nothing live remains: leave the directory exactly the way the existing
    -- expiry sweeps do ('active' → 'expired'). Every other non-active status
    -- (draft / pending_review / hidden / rejected / suspended) is a decision
    -- that belongs to the publish gate or to moderation and is NOT rewritten.
    UPDATE public.matrimony_profiles
    SET status = 'expired', updated_at = now()
    WHERE user_id = p_user_id AND status = 'active';
  END IF;

  SELECT mp.* INTO v_mp_after FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'subscription_id', s.id,
           'package_slug', s.package_slug,
           'promotional', EXISTS (SELECT 1 FROM public.packages pk
                                  WHERE pk.id = s.package_id
                                    AND (pk.tier = 'platinum'
                                         OR pk.slug IN ('platinum-launch-30d', 'platinum-demo-24h'))),
           'expires_at', s.expires_at
         ) ORDER BY s.expires_at DESC), '[]'::jsonb)
  INTO v_remaining
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id AND s.status = 'active' AND s.expires_at > now();

  --------------------------------------------------------------------------
  -- Audit (existing admin_audit_log) — the money trail is preserved here.
  --------------------------------------------------------------------------
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    p_admin_id,
    'admin_membership_revoked',
    'membership',
    p_user_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id',             p_user_id,
      'subscription_id',     v_sub.id,
      'package_id',          v_sub.package_id,
      'package_slug',        v_sub.package_slug,
      'package_name',        v_pkg_name,
      'tier',                coalesce(v_tier::text, 'unknown'),
      'previous_status',     'active',
      'new_status',          'cancelled',
      'started_at',          v_sub.started_at,
      'expires_at',          v_sub.expires_at,
      -- Preserved payment identity: revocation never rewrites any of these.
      'payment_id',          v_sub.payment_id,
      'razorpay_order_id',   v_pay.razorpay_order_id,
      'razorpay_payment_id', v_pay.razorpay_payment_id,
      'amount_inr',          v_pay.amount_inr,
      'currency',            v_pay.currency,
      'payment_status',      v_pay.status::text,
      'payment_created_at',  v_pay.created_at,
      'payment_untouched',   TRUE,
      -- State before / after.
      'reason',              v_reason,
      'note',                v_note,
      'live_membership_after', v_still_live,
      'profile_status_before', v_mp_before.status::text,
      'profile_status_after',  v_mp_after.status::text,
      'is_public_after',       public.is_profile_public(p_user_id),
      'boost_still_active',    public.has_active_boost(p_user_id),
      'featured_untouched',    EXISTS (SELECT 1 FROM public.featured_profiles f WHERE f.profile_id = p_user_id)
    ))
  );

  --------------------------------------------------------------------------
  -- Member-facing activity event (existing stream). State facts only — never
  -- the admin's reason, note or id (members can read their own stream).
  --------------------------------------------------------------------------
  PERFORM public.log_activity(
    p_user_id,
    'admin_membership_revoked',
    jsonb_build_object(
      'subscription_id', v_sub.id,
      'package_slug', v_sub.package_slug,
      'tier', coalesce(v_tier::text, 'unknown'),
      'previous_status', 'active',
      'new_status', 'cancelled',
      'live_membership_after', v_still_live,
      'profile_status_after', v_mp_after.status::text
    ),
    'subrevoke:' || v_sub.id::text
  );

  --------------------------------------------------------------------------
  -- Notify the member through the existing notification architecture.
  --------------------------------------------------------------------------
  PERFORM public.push_notification(
    p_user_id,
    'admin_message',
    CASE WHEN v_still_live
      THEN format('Your %s membership was revoked', coalesce(v_pkg_name, v_sub.package_slug, 'paid'))
      ELSE 'Your membership has been revoked'
    END,
    CASE WHEN v_still_live
      THEN 'One of your memberships was revoked by our team. You still have active access till '
           || to_char((public.get_membership(p_user_id) ->> 'expires_at')::timestamptz AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
           || '. Contact support if you believe this is a mistake.'
      ELSE 'Your ' || coalesce(v_pkg_name, v_sub.package_slug, 'paid') || ' membership has been revoked and your profile is no longer visible in Browse, Search or matches. Your payment record is unchanged. Contact support if you believe this is a mistake.'
    END,
    jsonb_build_object('subscription_id', v_sub.id, 'package_slug', v_sub.package_slug,
                       'live_membership', v_still_live),
    '/packages'
  );

  RETURN jsonb_build_object(
    'status', 'revoked',
    'changed', TRUE,
    'subscription_id', v_sub.id,
    'package_id', v_sub.package_id,
    'package_slug', v_sub.package_slug,
    'package_name', v_pkg_name,
    'tier', coalesce(v_tier::text, 'unknown'),
    'promotional', v_promotional,
    'previous_status', 'active',
    'new_status', 'cancelled',
    'started_at', v_sub.started_at,
    'expires_at', v_sub.expires_at,
    'payment_id', v_sub.payment_id,
    'razorpay_order_id', v_pay.razorpay_order_id,
    'razorpay_payment_id', v_pay.razorpay_payment_id,
    'amount_inr', v_pay.amount_inr,
    'payment_status', v_pay.status::text,
    'reason', v_reason,
    'live_membership_after', v_still_live,
    'remaining_entitlements', coalesce(v_remaining, '[]'::jsonb),
    'profile_status_before', v_mp_before.status::text,
    'profile_status_after', v_mp_after.status::text,
    'is_public_after', public.is_profile_public(p_user_id),
    'boost_still_active', public.has_active_boost(p_user_id),
    'membership', public.get_membership(p_user_id)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_revoke_membership(uuid, uuid, text, text, bigint) IS
  'Admin-only revocation of ONE active PAID membership entitlement (Razorpay-backed or an admin/manual activation of a real paid package). Service role only; authorised by admin_assert_actor(p_admin_id); per-member advisory + row locks; idempotent. Cancels the subscriptions row, then lets has_live_membership()/get_membership()/is_profile_public() recompute access — another live entitlement (including a promotional Platinum grant) keeps the member paid and visible. NEVER touches the payments row (order id, payment id, amount, currency, status and timestamps are preserved and copied into admin_audit_log), never touches boosts or featured status, and never fakes a refund. Writes admin_audit_log + activity_events + a notification. reason ∈ refund|fraud|incorrect_activation|support_action|manual_correction|other.';

REVOKE ALL ON FUNCTION public.admin_revoke_membership(uuid, uuid, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_membership(uuid, uuid, text, text, bigint) TO service_role;


-- ----------------------------------------------------------------------------
-- §2 Canonical activity vocabulary += revocation (+ the OTP event that
--    complete_mobile_otp_verification() has always written but that was never
--    added to the authoritative list). Every existing name is preserved
--    verbatim — this is the repository's single vocabulary definition.
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
    'mobile_otp_verified',
    -- Success stories
    'story_submitted',
    -- Safety / trust
    'block_created',
    'block_removed',
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
    'admin_manual_membership_activation',
    -- Admin membership revocation (entitlement only — never a refund)
    'admin_membership_revoked',
    -- Platinum Launch Offer (promotional grants — never payments)
    'platinum_first_100_granted',
    'platinum_demo_24h_granted',
    'platinum_promotion_expired'
  ]::TEXT[]
$$;

COMMENT ON FUNCTION public.canonical_activity_events() IS
  'Authoritative event vocabulary for activity_events. Centralised so analytics UI + tests share one list. New event names must be added here. (boost_granted is the admin boost event — Step 1 semantics, no second boost system. The platinum_* events are the launch-promotion grants/expiry — promotional, never payments. admin_membership_revoked is the admin entitlement revocation — it is NOT payment_refunded: the payment record is preserved. mobile_otp_verified was already written by complete_mobile_otp_verification() and is now listed.)';

REVOKE ALL ON FUNCTION public.canonical_activity_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_activity_events() TO anon, authenticated, service_role;
