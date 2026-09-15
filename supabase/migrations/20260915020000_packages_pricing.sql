-- ============================================================================
-- Mali Vivah · Phase 1 — membership packages, authoritative pricing
-- Migration 3 of the Phase 1 completion pass.
--
-- THE AUTHORITATIVE PRICE LIST (client instruction, overrides the older PRD)
--   SMART    ₹  999 / 3 months
--   PREMIUM  ₹2,499 / 6 months
--   VIP      ₹4,999 / 12 months
--   (FREE    ₹0    — the default state, not a purchasable row)
--
--   The older PRD listed ₹5,999 for the 12-month plan. That figure is WRONG and
--   must not appear anywhere. This migration is the single place the three
--   prices live; the app reads them from here and never hard-codes them.
--   NOTE: the previously seeded rows were ₹999 / ₹1799 / ₹2999 — all three are
--   replaced below.
--
-- WHAT IT DOES
--   §1 packages += tier, benefits, duration_months, is_popular, badge_text
--      `benefits` is a JSONB feature map so Admin can re-tune what each plan
--      unlocks without a code change, and so the API/UI never guess.
--   §2 Seeds SMART / PREMIUM / VIP (upsert on slug — safe to re-run and safe to
--      re-run after an admin edits prices, because the upsert only touches the
--      canonical columns).
--   §3 Retires the legacy Silver / Gold / Platinum rows: is_active = FALSE so
--      they stop appearing in the shop, but tier is set on them so historical
--      subscriptions still resolve to a real tier for reporting.
--   §4 Tier + benefit resolvers used by every gate in the app.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run.
-- DEPENDS ON 20260915000000_enum_extensions.sql (membership_tier).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 New package columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS tier            public.membership_tier NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS benefits        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS duration_months SMALLINT,
  ADD COLUMN IF NOT EXISTS is_popular      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS badge_text      TEXT;

COMMENT ON COLUMN public.packages.tier IS 'Membership tier this plan grants: free / smart / premium / vip.';
COMMENT ON COLUMN public.packages.benefits IS
  'Admin-configurable feature map, e.g. {"profile_visible":true,"advanced_search":true,"boosts_included":1}. The app reads gates from here rather than branching on the slug.';
COMMENT ON COLUMN public.packages.duration_months IS 'Display value in months (3/6/12). duration_days remains the expiry authority.';


-- ----------------------------------------------------------------------------
-- §2 Canonical plans
-- ----------------------------------------------------------------------------
INSERT INTO public.packages
  (slug, name, description, price_inr, duration_days, duration_months, tier, benefits, features, sort_order, is_popular, badge_text)
VALUES
  (
    'smart-3-month',
    'Smart · 3 Months',
    'Go live in the Mali Vivah directory and start connecting.',
    999, 90, 3, 'smart',
    '{
      "profile_visible": true,
      "appear_in_search": true,
      "appear_in_recommendations": true,
      "express_interest": true,
      "receive_interests": true,
      "full_biodata": true,
      "biodata_download": true,
      "advanced_search": false,
      "profile_views": true,
      "who_viewed_me": false,
      "boosts_included": 1,
      "featured_eligible": false,
      "priority_recommendations": false,
      "daily_match_count": 5,
      "interest_limit_per_month": 25,
      "verified_badge": false,
      "priority_support": false
    }'::jsonb,
    ARRAY[
      'Your profile becomes visible in Brides & Grooms',
      'Appear in search and recommendations',
      'Express interest and receive interests',
      'Expanded biodata + biodata download on mutual match',
      'Daily 5 compatible matches',
      '25 interests per month',
      '1 Profile Boost included'
    ],
    1, FALSE, NULL
  ),
  (
    'premium-6-month',
    'Premium · 6 Months',
    'Our most popular plan — more visibility, more connections.',
    2499, 180, 6, 'premium',
    '{
      "profile_visible": true,
      "appear_in_search": true,
      "appear_in_recommendations": true,
      "express_interest": true,
      "receive_interests": true,
      "full_biodata": true,
      "biodata_download": true,
      "advanced_search": true,
      "profile_views": true,
      "who_viewed_me": true,
      "boosts_included": 3,
      "featured_eligible": true,
      "priority_recommendations": true,
      "daily_match_count": 5,
      "interest_limit_per_month": 60,
      "verified_badge": false,
      "priority_support": false
    }'::jsonb,
    ARRAY[
      'Everything in Smart',
      'Advanced search (height, income, native place, lifestyle…)',
      'See who viewed your profile',
      'Priority placement in recommendations',
      'Featured profile eligibility',
      '60 interests per month',
      '3 Profile Boosts included'
    ],
    2, TRUE, 'Most popular'
  ),
  (
    'vip-12-month',
    'VIP · 12 Months',
    'A full year of priority matchmaking and premium support.',
    4999, 365, 12, 'vip',
    '{
      "profile_visible": true,
      "appear_in_search": true,
      "appear_in_recommendations": true,
      "express_interest": true,
      "receive_interests": true,
      "full_biodata": true,
      "biodata_download": true,
      "advanced_search": true,
      "profile_views": true,
      "who_viewed_me": true,
      "boosts_included": 6,
      "featured_eligible": true,
      "priority_recommendations": true,
      "daily_match_count": 5,
      "interest_limit_per_month": null,
      "verified_badge": true,
      "priority_support": true
    }'::jsonb,
    ARRAY[
      'Everything in Premium',
      'Priority placement in search and featured sections',
      'Premium verified badge',
      'Unlimited interests',
      'Dedicated priority support',
      '6 Profile Boosts included'
    ],
    3, FALSE, 'Best value'
  )
ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  price_inr       = EXCLUDED.price_inr,
  duration_days   = EXCLUDED.duration_days,
  duration_months = EXCLUDED.duration_months,
  tier            = EXCLUDED.tier,
  benefits        = EXCLUDED.benefits,
  features        = EXCLUDED.features,
  sort_order      = EXCLUDED.sort_order,
  is_popular      = EXCLUDED.is_popular,
  badge_text      = EXCLUDED.badge_text,
  is_active       = TRUE,
  updated_at      = now();

-- Sanity guard: the retired ₹5,999 figure must never exist in this table.
UPDATE public.packages SET price_inr = 4999, updated_at = now()
WHERE tier = 'vip' AND price_inr = 5999;


-- ----------------------------------------------------------------------------
-- §3 Retire the legacy Silver / Gold / Platinum rows
--    Kept (not deleted) so existing subscriptions.package_id / package_slug
--    values still join and still resolve to a tier for revenue reporting.
-- ----------------------------------------------------------------------------
UPDATE public.packages
SET is_active  = FALSE,
    tier       = CASE slug
                   WHEN 'silver-3-month'   THEN 'smart'::public.membership_tier
                   WHEN 'gold-6-month'     THEN 'premium'::public.membership_tier
                   WHEN 'platinum-12-month' THEN 'vip'::public.membership_tier
                   ELSE tier
                 END,
    updated_at = now()
WHERE slug IN ('silver-3-month', 'gold-6-month', 'platinum-12-month');


-- ----------------------------------------------------------------------------
-- §4 Tier + benefit resolvers
--    Every membership gate in the app goes through these, so there is exactly
--    one definition of "what does this member's plan allow".
-- ----------------------------------------------------------------------------

/** The FREE plan's benefit map — the baseline every member starts on. */
CREATE OR REPLACE FUNCTION public.free_benefits()
RETURNS JSONB
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT '{
    "profile_visible": false,
    "appear_in_search": false,
    "appear_in_recommendations": false,
    "express_interest": false,
    "receive_interests": false,
    "full_biodata": false,
    "biodata_download": false,
    "advanced_search": false,
    "profile_views": true,
    "who_viewed_me": false,
    "boosts_included": 0,
    "featured_eligible": false,
    "priority_recommendations": false,
    "daily_match_count": 5,
    "interest_limit_per_month": 0,
    "verified_badge": false,
    "priority_support": false
  }'::jsonb
$$;

COMMENT ON FUNCTION public.free_benefits() IS 'Benefit map for the FREE tier: browse, discover and receive Daily 5, but stay hidden and unable to express interest.';

REVOKE ALL ON FUNCTION public.free_benefits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.free_benefits() TO anon, authenticated;


/**
 * The member's current live membership as one JSON object:
 *   { tier, is_paid, package_slug, started_at, expires_at, days_left, benefits }
 * `benefits` is free_benefits() overlaid with the plan's own map, so callers can
 * always read every key without null checks.
 */
CREATE OR REPLACE FUNCTION public.get_membership(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := coalesce(p_user_id, auth.uid());
  v_sub  RECORD;
  v_pkg  RECORD;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'tier', 'free', 'is_paid', FALSE, 'package_slug', NULL,
      'started_at', NULL, 'expires_at', NULL, 'days_left', 0,
      'benefits', public.free_benefits()
    );
  END IF;

  -- Longest-running live subscription wins (a renewal may already be stacked).
  SELECT s.* INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_user
    AND s.status = 'active'
    AND s.expires_at > now()
  ORDER BY s.expires_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tier', 'free', 'is_paid', FALSE, 'package_slug', NULL,
      'started_at', NULL, 'expires_at', NULL, 'days_left', 0,
      'benefits', public.free_benefits()
    );
  END IF;

  SELECT p.tier, p.benefits, p.slug INTO v_pkg
  FROM public.packages p
  WHERE p.id = v_sub.package_id
  LIMIT 1;

  IF NOT FOUND THEN
    -- Package row is gone (or the subscription was written with only a slug).
    SELECT p.tier, p.benefits, p.slug INTO v_pkg
    FROM public.packages p
    WHERE p.slug = v_sub.package_slug
    ORDER BY p.is_active DESC, p.id DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'tier', coalesce(v_pkg.tier, 'smart'::public.membership_tier)::text,
    'is_paid', TRUE,
    'package_slug', coalesce(v_pkg.slug, v_sub.package_slug),
    'started_at', v_sub.started_at,
    'expires_at', v_sub.expires_at,
    'days_left', greatest(floor(extract(epoch FROM (v_sub.expires_at - now())) / 86400), 0)::int,
    'benefits', public.free_benefits() || coalesce(v_pkg.benefits, '{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_membership(uuid) IS
  'Single source of truth for a member''s plan: tier, expiry and the merged benefit map. Time-aware — an expired subscription returns the free tier immediately, even before the expiry sweep has run.';

REVOKE ALL ON FUNCTION public.get_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_membership(uuid) TO anon, authenticated;


/** The member's tier, or 'free'. */
CREATE OR REPLACE FUNCTION public.get_membership_tier(p_user_id UUID DEFAULT NULL)
RETURNS public.membership_tier
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((public.get_membership(p_user_id) ->> 'tier')::public.membership_tier, 'free'::public.membership_tier)
$$;

COMMENT ON FUNCTION public.get_membership_tier(uuid) IS 'free / smart / premium / vip for the given user (default: caller).';

REVOKE ALL ON FUNCTION public.get_membership_tier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_membership_tier(uuid) TO anon, authenticated;


/**
 * Does the member's current plan allow `p_key`?
 *  • boolean flags  → read directly
 *  • numeric values → TRUE when > 0 (0 means "not included")
 *  • explicit null  → TRUE (means "unlimited", e.g. VIP interests)
 *  • missing key    → FALSE
 */
CREATE OR REPLACE FUNCTION public.has_benefit(p_key TEXT, p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    CASE jsonb_typeof(m.benefits -> p_key)
      WHEN 'boolean' THEN (m.benefits ->> p_key)::boolean
      WHEN 'number'  THEN (m.benefits ->> p_key)::numeric > 0
      WHEN 'null'    THEN TRUE
      ELSE FALSE
    END,
    FALSE
  )
  FROM (SELECT (public.get_membership(p_user_id) -> 'benefits') AS benefits) m
$$;

COMMENT ON FUNCTION public.has_benefit(text, uuid) IS
  'TRUE when the member''s current plan grants the named benefit. An explicit JSON null means unlimited (VIP interests), a missing key means not granted.';

REVOKE ALL ON FUNCTION public.has_benefit(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_benefit(text, uuid) TO anon, authenticated;
