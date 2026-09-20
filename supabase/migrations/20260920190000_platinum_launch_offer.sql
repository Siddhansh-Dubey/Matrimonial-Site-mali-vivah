-- ============================================================================
-- Mali Vivah · PLATINUM LAUNCH OFFER — temporary launch promotion (2 of 2)
--
-- THE FEATURE (business rules implemented here, all server-authoritative)
--   1. FIRST 100 — the first 100 eligible members to complete their profile
--      receive a FREE 30-DAY PLATINUM membership (one per member, atomic
--      slot allocation under a campaign row lock; two simultaneous members
--      can never both receive slot 100).
--   2. 24-HOUR DEMO — once all 100 launch slots are claimed, any member who
--      completes the required profile details receives exactly ONE free
--      24-hour Platinum demo. Never twice, never restarted by re-editing
--      the profile, never after a first-100 grant.
--
-- WHAT THIS DELIBERATELY DOES *NOT* DO
--   * It does NOT create a second membership system. Platinum is granted as
--     an ordinary row in public.subscriptions — the existing authoritative
--     membership mechanism — so EVERY existing gate (has_live_membership,
--     is_profile_public, get_membership, has_benefit, express_interest,
--     chat, Daily 5, boosts, sweeps) honours it with zero changes.
--   * It does NOT touch Razorpay: no payment row is ever created, the
--     promotional packages are is_active = FALSE / price_inr = 0, so
--     validate_payment_snapshot() makes a Platinum "purchase" impossible
--     and activate_membership() rejects the promotional packages.
--   * It does NOT change the paid price list (Smart ₹999/90, Premium
--     ₹2,499/180, VIP ₹4,999/365), the paid packages, or any existing
--     migration.
--   * It does NOT count users. The first-100 counter is the claim ledger
--     below — it starts at 0/100 no matter how many development/test
--     accounts already exist in auth.users / profiles / matrimony_profiles.
--   * It does NOT shorten, downgrade or delay an existing paid membership:
--     a promotional grant OVERLAPS the current time window (starts now) and
--     never rewrites a paid subscription row. get_membership() keeps
--     picking the longest-running live subscription, so a paid member's
--     tier stays authoritative for as long as it runs.
--
-- ARCHITECTURE
--   platinum_launch_campaigns   one row per campaign. Seeded with
--                               campaign_key = 'FIRST_100_PLATINUM',
--                               total_slots = 100, enabled = TRUE.
--                               Service-role writable only (admin panel).
--   platinum_launch_claims      the LEDGER and the authoritative counter:
--                               one row per member per campaign
--                               (UNIQUE(campaign_id, user_id) — enforced by
--                               the database, not by application logic),
--                               grant_type 'first_100' (counts toward the
--                               100 slots, carries slot_number) or
--                               'demo_24h' (unlimited count, does NOT
--                               consume a slot), the subscription it
--                               granted, server-generated start/expiry and
--                               source/promotion markers for analytics.
--   packages                    two NON-purchasable promotional plan rows
--                               ('platinum-launch-30d', 'platinum-demo-24h',
--                               tier 'platinum' from migration
--                               20260920180000, price 0, is_active FALSE) so
--                               subscriptions keep their package_id/
--                               package_slug NOT NULL contract and
--                               get_membership() resolves the real benefit
--                               map for Platinum members.
--   claim_platinum_launch_offer()  the ONE grant path (authenticated,
--                               auth.uid() only — no user argument, so a
--                               member can never claim for anyone else).
--                               Idempotent: refresh / double click / retry /
--                               duplicate request all return the SAME
--                               already-granted state.
--   get_my_platinum_launch()    read-only state for the member UI.
--   reset_platinum_launch_campaign(p_confirm)  service-role-only
--                               DEVELOPMENT/ADMIN reset back to 0/100 —
--                               deletes ONLY this campaign's claims and the
--                               promotional subscriptions they created.
--                               Never touches users, profiles, paid
--                               subscriptions, payments or activity history.
--   log_platinum_promotion_expiry()  trigger that records the
--                               'platinum_promotion_expired' analytics event
--                               when the existing expiry sweeps flip a
--                               promotional subscription to expired.
--
-- TRIGGER POINT (product lifecycle)
--   Bare registration does NOT grant anything. The promotion claims when the
--   SERVER determines the member's profile satisfies the canonical publish
--   gate — the very same checklist enforce_publishable_profile() /
--   admin_profile_missing() enforce (gender, 18+ date of birth, city,
--   education, occupation, profile photo AND the mandatory family photo),
--   and only for accounts in good standing (active account, not suspended,
--   not rejected, no admin hold). The app calls claim_platinum_launch_offer()
--   after a successful profile save and lazily on the dashboard (same
--   pattern as sweep_my_membership); the decision itself lives entirely in
--   this RPC — the browser is never trusted for eligibility, slot numbers,
--   durations or dates.
--
-- SECURITY
--   * campaigns: RLS on, no grants to anon/authenticated — members cannot
--     read or manipulate campaign state; the member-facing RPCs expose only
--     the caller's own entitlement (never campaign ids or counters).
--   * claims: members may SELECT their OWN rows; every write path is a
--     SECURITY DEFINER RPC. The reset RPC is service-role only.
--   * Concurrency: per-member advisory lock + campaign row FOR UPDATE +
--     the UNIQUE(campaign_id, user_id) index and the partial unique
--     slot index — three independent guarantees that duplicate or
--     simultaneous claims cannot exceed the 100 slots.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: every statement is idempotent and the seeds NEVER
-- overwrite live campaign/package state (ON CONFLICT DO NOTHING).
-- DEPENDS ON 20260920180000_enum_tier_platinum.sql (membership_tier
-- 'platinum' — added in its own file because PostgreSQL forbids using a new
-- enum value inside the transaction that created it) and on every earlier
-- migration (packages, subscriptions, payments lockdown, activity stream,
-- notifications, admin_profile_missing, publish gate).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard — fail before touching anything
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL
     OR to_regclass('public.packages') IS NULL
     OR to_regprocedure('public.admin_profile_missing(uuid)') IS NULL
     OR to_regprocedure('public.log_activity(uuid, text, jsonb, text)') IS NULL
     OR to_regprocedure('public.push_notification(uuid, public.notification_type, text, text, jsonb, text)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'membership_tier' AND t.typnamespace = 'public'::regnamespace
         AND e.enumlabel = 'platinum'
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'platinum_launch_offer: prerequisite migrations are not applied',
      HINT    = 'Run every earlier file in supabase/migrations/ first, including 20260920180000_enum_tier_platinum.sql.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 Promotional Platinum plan rows — NON-purchasable, price 0
--    They exist so a promotional grant is an ordinary subscription row that
--    satisfies validate_subscription_payment_link (package_id + slug) and
--    resolves through get_membership()/has_benefit() like any plan.
--    is_active = FALSE means:
--      * the /packages shop and admin manual-activation never list them,
--      * validate_payment_snapshot() rejects any payment attempt for them
--        (PAYMENT_PACKAGE_INVALID) — a Platinum "purchase" cannot exist,
--      * activate_membership() rejects them — the claim RPC below is the
--        ONLY path that can create a Platinum subscription.
--    Benefits: Platinum carries every capability the product gates on a live
--    membership (visibility, search incl. advanced, recommendations,
--    interests, full biodata + download, profile views + who-viewed-me,
--    featured eligibility, Daily 5). verified_badge / priority_support stay
--    FALSE — those follow real verification / operations, never a promotion.
--    ON CONFLICT DO NOTHING: re-running this migration never resurrects or
--    re-tunes the rows; the promotional configuration is fixed by design.
-- ----------------------------------------------------------------------------
INSERT INTO public.packages
  (slug, name, description, price_inr, duration_days, duration_months, tier, benefits, features, sort_order, is_active, is_popular, badge_text)
VALUES
  (
    'platinum-launch-30d',
    'Platinum · Launch Offer (30 days)',
    'FREE 30-day Platinum membership for the first 100 members of the Mali Vivah launch. Promotional grant only — never purchasable.',
    0, 30, 1, 'platinum',
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
      "interest_limit_per_month": null,
      "verified_badge": false,
      "priority_support": false
    }'::jsonb,
    ARRAY[
      'Everything a paid member can do, free for 30 days',
      'Public profile in Brides & Grooms, search and recommendations',
      'Unlimited Express Interest',
      'Advanced search + who viewed your profile',
      'Biodata download on mutual match',
      '3 Profile Boosts included'
    ],
    90, FALSE, FALSE, NULL
  ),
  (
    'platinum-demo-24h',
    'Platinum · 24-Hour Demo',
    'FREE 24-hour Platinum demo for members who complete their profile after the first-100 launch slots are claimed. Promotional grant only — never purchasable, once per member.',
    0, 1, NULL, 'platinum',
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
      "boosts_included": 1,
      "featured_eligible": true,
      "priority_recommendations": true,
      "daily_match_count": 5,
      "interest_limit_per_month": 25,
      "verified_badge": false,
      "priority_support": false
    }'::jsonb,
    ARRAY[
      '24 hours of full Platinum access, free',
      'Public profile in Brides & Grooms, search and recommendations',
      'Express Interest (25 this month)',
      'Advanced search + who viewed your profile',
      '1 Profile Boost included'
    ],
    91, FALSE, FALSE, NULL
  )
ON CONFLICT (slug) DO NOTHING;

COMMENT ON COLUMN public.packages.tier IS
  'Membership tier this plan grants: free / smart / premium / vip, plus the promotional-only ''platinum'' tier (launch offer rows — never purchasable, price 0, is_active FALSE).';


-- ----------------------------------------------------------------------------
-- §2 platinum_launch_campaigns — dedicated campaign state
--    The first-100 counter lives in the claim ledger (§3), NEVER in a count
--    of users/profiles: pre-existing development accounts cannot consume
--    launch slots. Production starts at 0/100 claimed by definition.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platinum_launch_campaigns (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_key TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  total_slots  INTEGER NOT NULL DEFAULT 100,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platinum_launch_campaigns_slots_pos CHECK (total_slots > 0)
);

COMMENT ON TABLE public.platinum_launch_campaigns IS
  'Launch-promotion campaign state (Platinum Launch Offer). Service-role writable only (admin panel); members cannot read or manipulate it — the member-facing RPCs expose only the caller''s own entitlement. The claimed-slot counter is the platinum_launch_claims ledger, counted under the row lock of this table; it never counts users.';
COMMENT ON COLUMN public.platinum_launch_campaigns.campaign_key IS
  'Stable key referenced by code and tests: FIRST_100_PLATINUM.';
COMMENT ON COLUMN public.platinum_launch_campaigns.total_slots IS
  'How many first-100 grants may exist (claims with grant_type=''first_100''). 24-hour demo claims do NOT consume slots.';
COMMENT ON COLUMN public.platinum_launch_campaigns.enabled IS
  'Master switch for the whole promotion (first-100 AND demo). Admin → Launch offer toggles it.';

DROP TRIGGER IF EXISTS set_platinum_launch_campaigns_updated_at ON public.platinum_launch_campaigns;
CREATE TRIGGER set_platinum_launch_campaigns_updated_at
  BEFORE UPDATE ON public.platinum_launch_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the launch campaign. DO NOTHING (not DO UPDATE): re-running this
-- migration must never re-enable a campaign an admin switched off, nor
-- rewrite slots/keys on a live deployment.
INSERT INTO public.platinum_launch_campaigns (campaign_key, name, description, total_slots, enabled)
VALUES (
  'FIRST_100_PLATINUM',
  'Platinum Launch Offer — First 100',
  'First 100 eligible members receive a free 30-day Platinum membership; after the slots are claimed, every member who completes the required profile details receives one free 24-hour Platinum demo.',
  100,
  TRUE
)
ON CONFLICT (campaign_key) DO NOTHING;

ALTER TABLE public.platinum_launch_campaigns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platinum_launch_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platinum_launch_campaigns TO service_role;
-- No RLS policies on purpose: only the service role (BYPASSRLS) and the
-- SECURITY DEFINER RPCs below ever read campaign state.


-- ----------------------------------------------------------------------------
-- §3 platinum_launch_claims — the claim/entitlement ledger
--    Authoritative for: who received which grant, exactly once
--    (UNIQUE(campaign_id, user_id)), which slot, which subscription row it
--    created, and the server-generated grant window.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platinum_launch_claims (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES public.platinum_launch_campaigns (id),
  user_id         UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  grant_type      TEXT NOT NULL CHECK (grant_type IN ('first_100', 'demo_24h')),
  -- 1..total_slots for first_100 grants; NULL for demos (they consume no slot).
  slot_number     INTEGER,
  -- The subscription row this claim created (the entitlement). SET NULL keeps
  -- the ledger readable even if the subscription row is ever removed.
  subscription_id BIGINT REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  -- Promotional package snapshot ('platinum-launch-30d' / 'platinum-demo-24h').
  package_slug    TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'launch_promotion'
                  CHECK (source = 'launch_promotion'),
  promotion       TEXT NOT NULL
                  CHECK (promotion IN ('first_100_platinum', 'platinum_24h_demo')),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  start_at        TIMESTAMPTZ NOT NULL,
  expiry_at       TIMESTAMPTZ NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one launch grant per member per campaign — enforced by the
  -- database, so no retry/refresh/race can produce a second 30-day grant or
  -- a second 24-hour demo, and a first-100 member can never later receive
  -- the demo from the same campaign.
  CONSTRAINT platinum_launch_claims_one_per_member UNIQUE (campaign_id, user_id),
  CONSTRAINT platinum_launch_claims_window_chk CHECK (expiry_at > start_at),
  CONSTRAINT platinum_launch_claims_slot_chk CHECK ((grant_type = 'first_100') = (slot_number IS NOT NULL)),
  CONSTRAINT platinum_launch_claims_slot_pos CHECK (slot_number IS NULL OR slot_number > 0),
  CONSTRAINT platinum_launch_claims_promotion_chk
    CHECK ((grant_type = 'first_100') = (promotion = 'first_100_platinum'))
);

COMMENT ON TABLE public.platinum_launch_claims IS
  'Launch-promotion entitlement ledger: one row per member per campaign (UNIQUE), grant_type first_100 (counts toward total_slots) or demo_24h (does not). Written ONLY by claim_platinum_launch_offer(); removed ONLY by reset_platinum_launch_campaign() (development/admin reset) or by account deletion (CASCADE). Members may SELECT their own rows.';
COMMENT ON COLUMN public.platinum_launch_claims.slot_number IS
  'Server-assigned launch slot (1..100) — allocated under the campaign row lock; never supplied by a client.';
COMMENT ON COLUMN public.platinum_launch_claims.start_at IS
  'Server-generated grant start (now() at claim time). Browsers never compute grant dates.';
COMMENT ON COLUMN public.platinum_launch_claims.metadata IS
  'Non-sensitive grant context (campaign key, publish note). Never stores contact details.';

-- One slot is awarded once.
CREATE UNIQUE INDEX IF NOT EXISTS platinum_launch_claims_slot_uniq
  ON public.platinum_launch_claims (campaign_id, slot_number)
  WHERE slot_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS platinum_launch_claims_campaign_type_idx
  ON public.platinum_launch_claims (campaign_id, grant_type, granted_at);
CREATE INDEX IF NOT EXISTS platinum_launch_claims_user_idx
  ON public.platinum_launch_claims (user_id);

ALTER TABLE public.platinum_launch_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platinum_launch_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platinum_launch_claims TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platinum_launch_claims TO service_role;

DROP POLICY IF EXISTS "Owner reads own launch claims" ON public.platinum_launch_claims;
CREATE POLICY "Owner reads own launch claims"
  ON public.platinum_launch_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies or grants for members: every write goes
-- through the SECURITY DEFINER RPCs (§5, §7).


-- ----------------------------------------------------------------------------
-- §4 platinum_launch_state_for(p_user_id) — one JSON shape for every surface
--    Internal helper (no direct grants to members); the two RPCs below wrap
--    it. Deliberately exposes NO campaign id, key or slot counters beyond
--    the member's own slot number.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platinum_launch_state_for(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cl  RECORD;
  v_sub RECORD;
  v_started TIMESTAMPTZ;
  v_expires TIMESTAMPTZ;
  v_live    BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('has_grant', FALSE);
  END IF;

  SELECT cl.*
  INTO v_cl
  FROM public.platinum_launch_claims cl
  WHERE cl.user_id = p_user_id
  ORDER BY cl.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_grant', FALSE);
  END IF;

  SELECT s.status, s.started_at, s.expires_at
  INTO v_sub
  FROM public.subscriptions s
  WHERE s.id = v_cl.subscription_id;

  v_started := coalesce(v_sub.started_at, v_cl.start_at);
  v_expires := coalesce(v_sub.expires_at, v_cl.expiry_at);
  -- The subscription row is the live entitlement authority (time-aware, like
  -- has_live_membership): a promotional grant is live only while its
  -- subscription is active and unexpired.
  v_live := coalesce(v_sub.status = 'active' AND v_sub.expires_at > now(), FALSE);

  RETURN jsonb_build_object(
    'has_grant', TRUE,
    'grant_type', v_cl.grant_type,
    'promotion', v_cl.promotion,
    'slot_number', v_cl.slot_number,
    'package_slug', v_cl.package_slug,
    'subscription_id', v_cl.subscription_id,
    'tier', 'platinum',
    'granted_at', v_cl.granted_at,
    'started_at', v_started,
    'expires_at', v_expires,
    'is_live', v_live,
    'seconds_left', CASE WHEN v_live
                         THEN greatest(floor(extract(epoch FROM (v_expires - now())))::bigint, 0)
                         ELSE 0 END
  );
END;
$$;

COMMENT ON FUNCTION public.platinum_launch_state_for(uuid) IS
  'INTERNAL helper: the caller''s Platinum Launch Offer state as JSON ({has_grant, grant_type, promotion, slot_number, package_slug, subscription_id, tier, granted_at, started_at, expires_at, is_live, seconds_left}). Exposes no campaign ids or counters. Wrapped by claim_platinum_launch_offer() and get_my_platinum_launch().';

REVOKE ALL ON FUNCTION public.platinum_launch_state_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platinum_launch_state_for(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §5 claim_platinum_launch_offer() — the ONE atomic, idempotent grant path
--
--    Order of operations (all server-side; the browser supplies NOTHING but
--    the session):
--      1. authenticate (auth.uid() — no user argument exists, so a member
--         can never claim for another user);
--      2. per-member advisory lock — serialises double-click / refresh /
--         retry / duplicate requests for the SAME member;
--      3. existing claim → return it ('already_claimed'): a member receives
--         exactly ONE launch grant ever (30-day OR demo, never both, never
--         twice — rules C, D, E);
--      4. campaign enabled check;
--      5. account + admin-state gates: active account, profile row exists,
--         not suspended / rejected / admin-held — existing admin, suspension
--         and visibility rules remain authoritative (rule G). No claim row
--         is written for an ineligible member, so no slot is wasted;
--      6. canonical profile-completion check: admin_profile_missing() —
--         the SAME publish-gate checklist the product already enforces
--         (gender, 18+ DOB, city, education, occupation, profile photo,
--         mandatory family photo). No second definition is invented;
--      7. lock the campaign row FOR UPDATE — serialises ALL members;
--      8. count grant_type='first_100' claims IN THE LEDGER (never a count
--         of users/profiles) → below total_slots: first_100 with
--         slot_number = count + 1; otherwise demo_24h (rule B);
--      9. insert the subscription (existing membership mechanism,
--         payment_id NULL — never a payment row, rule 18/19) starting NOW
--         for the package duration (30 days / 24 hours, server-generated —
--         overlapping, never extending or shortening a paid membership,
--         rules F/3/8);
--     10. insert the claim; the UNIQUE(campaign_id, user_id) index is the
--         final arbiter — on a (practically impossible under the locks)
--         unique violation the just-created subscription is removed again
--         and the winning claim's state is returned;
--     11. publish attempt: complete draft/hidden/expired profiles go
--         'active' exactly like activate_membership() does after a payment
--         (the publish gate re-validates; pending_review / suspended /
--         rejected are NEVER overridden);
--     12. notification + analytics event ('platinum_first_100_granted' /
--         'platinum_demo_24h_granted', idempotency-keyed).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_platinum_launch_offer()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_campaign    RECORD;
  v_cl          RECORD;
  v_is_active   BOOLEAN;
  v_mp          RECORD;
  v_missing     TEXT[];
  v_claimed     INTEGER;
  v_grant_type  TEXT;
  v_slot        INTEGER;
  v_promotion   TEXT;
  v_pkg         RECORD;
  v_sub_id      BIGINT;
  v_claim_id    BIGINT;
  v_started     TIMESTAMPTZ := now();
  v_expires     TIMESTAMPTZ;
  v_status      public.profile_status;
  v_publish_err TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in to claim the Platinum launch offer';
  END IF;

  -- (2) Serialise retries for this member (transaction-scoped, same pattern
  --     as activate_membership's per-member lock).
  PERFORM pg_advisory_xact_lock(hashtext('platinum_launch_claim:' || v_user::text));

  SELECT c.*
  INTO v_campaign
  FROM public.platinum_launch_campaigns c
  WHERE c.campaign_key = 'FIRST_100_PLATINUM'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLATINUM_CAMPAIGN_MISSING: the launch campaign is not configured';
  END IF;

  -- (3) Idempotency / one-grant-per-member: repeated calls (refresh, double
  --     click, retry, re-completing the profile) return the existing state
  --     and can never create a second entitlement or restart the window.
  SELECT cl.*
  INTO v_cl
  FROM public.platinum_launch_claims cl
  WHERE cl.campaign_id = v_campaign.id
    AND cl.user_id = v_user;
  IF FOUND THEN
    RETURN public.platinum_launch_state_for(v_user)
           || jsonb_build_object('status', 'already_claimed');
  END IF;

  -- (4) Master switch.
  IF NOT v_campaign.enabled THEN
    RETURN jsonb_build_object(
      'status', 'campaign_disabled',
      'has_grant', FALSE,
      'detail', 'The Platinum launch offer is not running right now.'
    );
  END IF;

  -- (5) Account + admin-state gates. Admin suspension / hold / rejection and
  --     account deletion stay authoritative: no grant, and — importantly —
  --     no claim row, so no launch slot is consumed by a blocked account.
  SELECT p.is_active INTO v_is_active
  FROM public.profiles p
  WHERE p.id = v_user;
  IF NOT FOUND OR v_is_active IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object(
      'status', 'not_eligible', 'has_grant', FALSE,
      'reason', 'account_inactive',
      'detail', 'This account cannot receive the launch offer.'
    );
  END IF;

  SELECT mp.status, mp.admin_hidden_at
  INTO v_mp
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_eligible', 'has_grant', FALSE,
      'reason', 'profile_missing',
      'detail', 'Create your matrimony profile to receive the launch offer.'
    );
  END IF;
  IF v_mp.status IN ('suspended', 'rejected') OR v_mp.admin_hidden_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'not_eligible', 'has_grant', FALSE,
      'reason', 'admin_restricted',
      'detail', 'This profile is under admin review or restriction.'
    );
  END IF;

  -- (6) Canonical completion: the publish-gate checklist itself (gender,
  --     18+ DOB, city, education, occupation, profile photo, family photo).
  v_missing := public.admin_profile_missing(v_user);
  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'status', 'not_eligible', 'has_grant', FALSE,
      'reason', 'profile_incomplete',
      'missing', to_jsonb(v_missing),
      'detail', 'Complete your required profile details to receive the launch offer.'
    );
  END IF;

  -- (7) Lock the campaign row: from here, every other member's claim waits
  --     until this transaction ends — the ledger count below can never let
  --     two simultaneous members both receive slot 100.
  SELECT c.*
  INTO v_campaign
  FROM public.platinum_launch_campaigns c
  WHERE c.id = v_campaign.id
  FOR UPDATE;
  IF NOT v_campaign.enabled THEN
    RETURN jsonb_build_object(
      'status', 'campaign_disabled', 'has_grant', FALSE,
      'detail', 'The Platinum launch offer is not running right now.'
    );
  END IF;

  -- (8) Slot allocation from the LEDGER (never a user/profile count).
  SELECT count(*)::int
  INTO v_claimed
  FROM public.platinum_launch_claims cl
  WHERE cl.campaign_id = v_campaign.id
    AND cl.grant_type = 'first_100';

  IF v_claimed < v_campaign.total_slots THEN
    v_grant_type := 'first_100';
    v_promotion  := 'first_100_platinum';
    v_slot       := v_claimed + 1;
    SELECT p.* INTO v_pkg FROM public.packages p WHERE p.slug = 'platinum-launch-30d' LIMIT 1;
  ELSE
    -- Campaign exhausted → exactly one 24-hour demo (rules B, C).
    v_grant_type := 'demo_24h';
    v_promotion  := 'platinum_24h_demo';
    v_slot       := NULL;
    SELECT p.* INTO v_pkg FROM public.packages p WHERE p.slug = 'platinum-demo-24h' LIMIT 1;
  END IF;

  IF NOT FOUND OR v_pkg.is_active IS NOT FALSE OR v_pkg.price_inr <> 0 THEN
    RAISE EXCEPTION 'PLATINUM_PACKAGE_MISSING: promotional package % is missing or misconfigured',
      CASE WHEN v_grant_type = 'first_100' THEN 'platinum-launch-30d' ELSE 'platinum-demo-24h' END;
  END IF;

  -- Server-generated window (never client-supplied). The promotional grant
  -- OVERLAPS any live paid membership instead of stacking after it, so a
  -- paid plan is never shortened, delayed, downgraded or masked (rules F,
  -- 3, 8). duration_days is the package authority: 30 days / 1 day (24 h).
  v_expires := v_started + make_interval(days => v_pkg.duration_days);

  -- (9) The entitlement is an ordinary subscription row — the existing
  --     authoritative membership mechanism. payment_id stays NULL: this is
  --     a promotion, never a purchase, and no payment row is created.
  INSERT INTO public.subscriptions
    (user_id, package_id, package_slug, status, started_at, expires_at, payment_id)
  VALUES
    (v_user, v_pkg.id, v_pkg.slug, 'active', v_started, v_expires, NULL)
  RETURNING id INTO v_sub_id;

  -- (10) Ledger row. The UNIQUE index is the final arbiter.
  BEGIN
    INSERT INTO public.platinum_launch_claims
      (campaign_id, user_id, grant_type, slot_number, subscription_id, package_slug,
       source, promotion, granted_at, start_at, expiry_at, metadata)
    VALUES
      (v_campaign.id, v_user, v_grant_type, v_slot, v_sub_id, v_pkg.slug,
       'launch_promotion', v_promotion, v_started, v_started, v_expires,
       jsonb_build_object('campaign_key', v_campaign.campaign_key))
    RETURNING id INTO v_claim_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race against the member's own concurrent claim (only reachable
    -- if the advisory lock were ever bypassed): undo the duplicate
    -- subscription and report the winner's state.
    DELETE FROM public.subscriptions WHERE id = v_sub_id;
    RETURN public.platinum_launch_state_for(v_user)
           || jsonb_build_object('status', 'already_claimed');
  END;

  -- (11) Publish attempt — identical semantics to activate_membership():
  --      a complete profile goes live with the membership; the gate keeps
  --      rejecting incomplete ones and admin states are never overridden.
  BEGIN
    UPDATE public.matrimony_profiles mp
    SET status = 'active', updated_at = now()
    WHERE mp.user_id = v_user
      AND mp.status IN ('draft', 'hidden', 'expired');
  EXCEPTION WHEN OTHERS THEN
    v_publish_err := SQLERRM;
  END;

  SELECT mp.status INTO v_status
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = v_user;

  -- (12) Member notification (existing bell) — never worded as a payment.
  IF v_grant_type = 'first_100' THEN
    PERFORM public.push_notification(
      v_user,
      'admin_message',
      'You are one of the first 100 members!',
      format('You have received 30 days of Platinum access free, active till %s. No payment needed — enjoy full Platinum capabilities.',
             to_char(v_expires AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH:MI AM')),
      jsonb_build_object('promotion', v_promotion, 'grant_type', v_grant_type,
                         'slot_number', v_slot, 'expires_at', v_expires),
      '/profile'
    );
  ELSE
    PERFORM public.push_notification(
      v_user,
      'admin_message',
      'Your free 24-hour Platinum demo is active',
      format('Explore Platinum capabilities until %s. No payment needed — pick any package afterwards to stay visible.',
             to_char(v_expires AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH:MI AM')),
      jsonb_build_object('promotion', v_promotion, 'grant_type', v_grant_type,
                         'expires_at', v_expires),
      '/profile'
    );
  END IF;

  PERFORM public.log_activity(
    v_user,
    CASE WHEN v_grant_type = 'first_100' THEN 'platinum_first_100_granted'
         ELSE 'platinum_demo_24h_granted' END,
    jsonb_build_object(
      'source', 'launch_promotion',
      'promotion', v_promotion,
      'grant_type', v_grant_type,
      'slot_number', v_slot,
      'package_slug', v_pkg.slug,
      'subscription_id', v_sub_id,
      'started_at', v_started,
      'expires_at', v_expires,
      'profile_status', coalesce(v_status::text, 'draft')
    ),
    'platinumlaunch:' || v_claim_id::text
  );

  RETURN public.platinum_launch_state_for(v_user)
         || jsonb_build_object(
              'status', 'granted',
              'profile_status', coalesce(v_status::text, 'draft'),
              'publish_note', v_publish_err
            );
END;
$$;

COMMENT ON FUNCTION public.claim_platinum_launch_offer() IS
  'The ONE Platinum Launch Offer grant path (authenticated; auth.uid() only — no arguments, so a member can never claim for another user). Atomic first-100 allocation (per-member advisory lock + campaign row FOR UPDATE + unique ledger indexes): first 100 eligible members get a free 30-day Platinum subscription, everyone after gets exactly one free 24-hour Platinum demo once the required profile details are complete. Idempotent — repeated calls return the existing grant and can never duplicate or restart it. Grants are ordinary subscription rows with payment_id NULL (never a Razorpay payment) and never shorten or delay a paid membership. Existing admin/suspension/visibility rules stay authoritative.';

REVOKE ALL ON FUNCTION public.claim_platinum_launch_offer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_platinum_launch_offer() TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §6 get_my_platinum_launch() — read-only member state (dashboards, wizard)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_platinum_launch()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in to view your Platinum launch offer state';
  END IF;
  RETURN public.platinum_launch_state_for(v_user);
END;
$$;

COMMENT ON FUNCTION public.get_my_platinum_launch() IS
  'Read-only Platinum Launch Offer state for the signed-in member ({has_grant, grant_type, promotion, slot_number, package_slug, started_at, expires_at, is_live, seconds_left, …}). No parameters — always reports on auth.uid(). Exposes no campaign ids or counters.';

REVOKE ALL ON FUNCTION public.get_my_platinum_launch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_platinum_launch() TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §7 reset_platinum_launch_campaign(p_confirm) — DEVELOPMENT / ADMIN reset
--
--    Returns the FIRST-100 promotion to 0/100 claimed WITHOUT touching
--    anything else:
--      * deletes ONLY this campaign's claim rows and ONLY the promotional
--        subscription rows they created (belt-and-braces: a subscription is
--        only deleted when its id is recorded in the ledger AND it has
--        payment_id IS NULL AND a promotional package slug — paid
--        subscriptions, Razorpay payments and purchases can never match);
--      * never deletes users, profiles, matrimony data, payments, boosts or
--        activity history (past grant events are retained);
--      * restores profile-status truth afterwards (a profile that was
--        'active' only because of a promotional grant falls back to
--        'expired', the same rule sweep_expired_memberships() applies);
--      * leaves the campaign row itself (key, name, total_slots, enabled)
--        as configured.
--    Typed confirmation: p_confirm must equal the campaign key. EXECUTE is
--    service-role only — members and anon callers are rejected by GRANTs
--    before the body runs, and the Next.js admin action additionally
--    re-verifies is_admin and writes an admin_audit_log row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_platinum_launch_campaign(p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign    RECORD;
  v_sub_deleted INTEGER := 0;
  v_claims      INTEGER := 0;
  v_first100    INTEGER := 0;
  v_demos       INTEGER := 0;
  v_profiles    INTEGER := 0;
BEGIN
  SELECT c.*
  INTO v_campaign
  FROM public.platinum_launch_campaigns c
  WHERE c.campaign_key = 'FIRST_100_PLATINUM'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLATINUM_CAMPAIGN_MISSING: the launch campaign is not configured';
  END IF;

  IF nullif(btrim(coalesce(p_confirm, '')), '') IS DISTINCT FROM v_campaign.campaign_key THEN
    RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED: pass the campaign key (%) as typed confirmation', v_campaign.campaign_key;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('platinum_launch_reset:' || v_campaign.id::text));

  SELECT count(*)::int,
         count(*) FILTER (WHERE grant_type = 'first_100')::int,
         count(*) FILTER (WHERE grant_type = 'demo_24h')::int
  INTO v_claims, v_first100, v_demos
  FROM public.platinum_launch_claims
  WHERE campaign_id = v_campaign.id;

  -- 1. Remove ONLY the promotional entitlements this ledger created.
  DELETE FROM public.subscriptions s
  USING public.platinum_launch_claims cl
  WHERE cl.campaign_id = v_campaign.id
    AND s.id = cl.subscription_id
    AND s.payment_id IS NULL
    AND s.package_slug IN ('platinum-launch-30d', 'platinum-demo-24h');
  GET DIAGNOSTICS v_sub_deleted = ROW_COUNT;

  -- 2. Clear the ledger — the campaign is back to 0/100 claimed.
  DELETE FROM public.platinum_launch_claims
  WHERE campaign_id = v_campaign.id;

  -- 3. Restore profile-status truth for anyone who was live ONLY through a
  --    promotional grant (same rule as the existing sweeps; paid members are
  --    untouched because has_live_membership() still sees their paid rows).
  UPDATE public.matrimony_profiles mp
  SET status = 'expired', updated_at = now()
  WHERE mp.status = 'active'
    AND NOT public.has_live_membership(mp.user_id);
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  -- 4. Touch the campaign (updated_at); key/name/slots/enabled untouched.
  UPDATE public.platinum_launch_campaigns
  SET updated_at = now()
  WHERE id = v_campaign.id;

  RETURN jsonb_build_object(
    'status', 'reset_complete',
    'campaign_key', v_campaign.campaign_key,
    'total_slots', v_campaign.total_slots,
    'claimed_slots', 0,
    'removed_claims', v_claims,
    'removed_first_100_claims', v_first100,
    'removed_demo_claims', v_demos,
    'removed_promotional_subscriptions', v_sub_deleted,
    'profiles_set_expired', v_profiles
  );
END;
$$;

COMMENT ON FUNCTION public.reset_platinum_launch_campaign(text) IS
  'DEVELOPMENT/ADMIN ONLY. Resets the Platinum Launch Offer to 0/100 claimed: deletes the campaign''s claim rows and exactly the promotional subscriptions they created (payment_id NULL + promotional slug), then restores profile-status truth. Never deletes users, profiles, paid subscriptions, payments or activity history; leaves campaign configuration intact. Requires the campaign key as typed confirmation. Service-role EXECUTE only — normal users cannot call it.';

REVOKE ALL ON FUNCTION public.reset_platinum_launch_campaign(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_platinum_launch_campaign(text) TO service_role;


-- ----------------------------------------------------------------------------
-- §8 Promotion expiry analytics — the existing sweeps stay authoritative
--    sweep_expired_memberships() / sweep_my_membership() already flip lapsed
--    promotional subscriptions to 'expired' and hide the profile when no
--    other live membership remains (rules 6, 15). This trigger only ADDS the
--    promotional analytics event + a promo-worded notification so an expiry
--    is distinguishable from a paid lapse in the activity stream.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_platinum_promotion_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promotion TEXT;
BEGIN
  IF NEW.status = 'expired' AND OLD.status IS DISTINCT FROM 'expired'
     AND NEW.package_slug IN ('platinum-launch-30d', 'platinum-demo-24h')
  THEN
    v_promotion := CASE NEW.package_slug
                     WHEN 'platinum-launch-30d' THEN 'first_100_platinum'
                     ELSE 'platinum_24h_demo'
                   END;
    PERFORM public.log_activity(
      NEW.user_id,
      'platinum_promotion_expired',
      jsonb_build_object(
        'source', 'launch_promotion',
        'promotion', v_promotion,
        'package_slug', NEW.package_slug,
        'subscription_id', NEW.id,
        'expired_at', NEW.expires_at
      ),
      'platinumexp:' || NEW.id::text
    );
    PERFORM public.push_notification(
      NEW.user_id,
      'admin_message',
      'Your free Platinum access has ended',
      'Your promotional Platinum period has expired and your profile is hidden again. Pick any package to stay visible — the launch offer was a one-time free grant.',
      jsonb_build_object('promotion', v_promotion, 'subscription_id', NEW.id),
      '/packages'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_platinum_promotion_expiry() IS
  'AFTER UPDATE OF status trigger on subscriptions: when the existing expiry sweeps flip a promotional Platinum subscription to expired, records the platinum_promotion_expired activity event (idempotent) and sends a promo-worded notification. Never changes the sweep''s own behaviour.';

DROP TRIGGER IF EXISTS subscriptions_log_promotion_expiry ON public.subscriptions;
CREATE TRIGGER subscriptions_log_promotion_expiry
  AFTER UPDATE OF status ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.log_platinum_promotion_expiry();


-- ----------------------------------------------------------------------------
-- §9 Canonical activity vocabulary += the three promotional events
--    (log_activity warns on unknown names; the convention is that new event
--    names are added here — every existing name is preserved verbatim.)
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
    -- Platinum Launch Offer (promotional grants — never payments)
    'platinum_first_100_granted',
    'platinum_demo_24h_granted',
    'platinum_promotion_expired'
  ]::TEXT[]
$$;

COMMENT ON FUNCTION public.canonical_activity_events() IS
  'Authoritative event vocabulary for activity_events. Centralised so analytics UI + tests share one list. New event names must be added here. (boost_granted is the admin boost event — Step 1 semantics, no second boost system. The platinum_* events are the launch-promotion grants/expiry — promotional, never payments.)';

REVOKE ALL ON FUNCTION public.canonical_activity_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_activity_events() TO anon, authenticated, service_role;
