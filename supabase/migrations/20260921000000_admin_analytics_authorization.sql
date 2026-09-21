-- ============================================================================
-- Mali Vivah · Admin Analytics authorization — ONE authoritative admin check
--
-- THE BUG THIS FIXES (Admin → Analytics rendered
-- "Could not load analytics: admin_analytics: admin only." for a real admin)
--
--   The admin panel authorises /admin with `profiles.is_admin` read through
--   public.is_admin() on the MEMBER's session (src/lib/admin/server.ts).
--   is_admin() resolves the member as `auth.uid()`.
--
--   The analytics RPC, however, was invoked with the SERVICE-ROLE client
--   (createAdminClient()). A service-role PostgREST call carries NO user JWT,
--   so inside the function auth.uid() is NULL, is_admin() is FALSE, and the
--   old gate raised 'admin_analytics: admin only' — for the very admin the
--   panel had just authorised. The two checks were the same DEFINITION
--   (profiles.is_admin) evaluated against two different IDENTITIES.
--
-- THE FIX
--   admin_analytics() now gates on public.admin_assert_actor(p_admin_id) —
--   the single authoritative admin check shared by every other admin RPC
--   (20260919120000 §6a: members, verification, packages, payments, reports,
--   privacy lifecycle, platinum campaign). It:
--     * refuses anonymous callers outright;
--     * for a signed-in caller requires auth.uid() to be an is_admin profile
--       AND to equal the p_admin_id it claims to act as;
--     * for the service-role control plane requires p_admin_id to name a real
--       is_admin profile — a leaked service key alone can no longer read
--       analytics anonymously (a tightening, not a relaxation).
--   No admin authorization is removed, no email/user id is hard-coded, no RLS
--   is disabled, and nothing becomes publicly readable: the RPC stays
--   SECURITY DEFINER with a pinned search_path and EXECUTE stays revoked from
--   PUBLIC/anon/authenticated (now service_role only, matching every other
--   admin RPC).
--
-- ALSO IN THIS FILE
--   * The old `admin_analytics(integer)` signature is DROPPED, not left
--     alongside the new one: the repository keeps no duplicate function
--     names / live overloads (docs/audits/step13-evidence.md).
--   * Extra KPIs the analytics page can now show, all COUNTs over the same
--     authoritative tables the product gates on (profiles, subscriptions,
--     matrimony_profiles, payments, reports) — paid/free members, hidden and
--     verified profiles, subscriptions expiring within 7 days, live
--     promotional (Platinum launch) subscriptions, reports in window /
--     resolved, and a per-package live mix. Nothing is synthesised: a metric
--     with no rows is 0, exactly as before.
--   * The IST day axis is corrected. The old bounds converted the IST
--     wall-clock midnight back to timestamptz, so to_char() re-rendered every
--     label in the session timezone (UTC on every Supabase project) and the
--     axis ended YESTERDAY: the current IST day was never a bucket, and all of
--     today's signups / revenue / interests / messages / searches / profile
--     views silently disappeared from the six charts. p_days still bounds the
--     query exactly as before (7 / 14 / 30 / 90 now return 7 / 14 / 30 / 90
--     buckets ending today).
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent): DROP … IF EXISTS + CREATE OR REPLACE, and the
-- grants/comments are re-asserted every time.
-- DEPENDS ON 20260919110000_activity_tracking_analytics.sql (the analytics
-- body + event vocabulary) and 20260919120000_admin_member_management.sql
-- (admin_assert_actor). Deploy together with the updated
-- src/app/admin/analytics/page.tsx, which now passes p_admin_id.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard — fail before touching anything
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.admin_assert_actor(uuid)') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'admin_analytics_authorization: admin_assert_actor(uuid) is missing',
      HINT    = 'Apply 20260919120000_admin_member_management.sql first.';
  END IF;
  IF to_regprocedure('public.admin_analytics(integer)') IS NULL
     AND to_regprocedure('public.admin_analytics(integer, uuid)') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'admin_analytics_authorization: admin_analytics() is missing',
      HINT    = 'Apply 20260919110000_activity_tracking_analytics.sql first.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 Retire the old signature (no overloads: one admin_analytics definition)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_analytics(integer);
DROP FUNCTION IF EXISTS public.admin_analytics(integer, uuid);


-- ----------------------------------------------------------------------------
-- §2 admin_analytics(p_days, p_admin_id)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_analytics(
  p_days     INTEGER DEFAULT 14,
  p_admin_id UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := greatest(1, least(coalesce(p_days, 14), 365));
  v_since TIMESTAMPTZ := now() - (v_days || ' days')::interval;
  v_result JSONB;
BEGIN
  -- ONE authoritative admin check, shared by every admin RPC in this
  -- database (20260919120000 §6a). It resolves BOTH invocation styles:
  --   * service-role caller (the Next.js admin panel) -> p_admin_id must
  --     name a real profiles.is_admin row, so a leaked service key alone
  --     cannot read analytics anonymously;
  --   * signed-in caller -> auth.uid() must itself be an is_admin profile
  --     AND must equal p_admin_id.
  -- It is deliberately NOT is_admin() alone: with the service-role key
  -- auth.uid() is NULL, so is_admin() is FALSE and the old gate rejected
  -- the very admin the panel had already authorised.
  PERFORM public.admin_assert_actor(p_admin_id);

  WITH
  -- KPIs (totals, not windowed)
  kpi_total_members   AS (SELECT count(*)::int AS n FROM public.profiles),
  kpi_live_profiles   AS (SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE status = 'active'),
  kpi_live_subs       AS (SELECT count(*)::int AS n FROM public.subscriptions WHERE status = 'active' AND expires_at > now()),
  kpi_active_boosts   AS (SELECT count(*)::int AS n FROM public.profile_boosts WHERE status = 'active' AND expires_at > now()),
  kpi_live_moments    AS (SELECT count(*)::int AS n FROM public.moments WHERE is_removed = FALSE AND expires_at > now()),
  kpi_pending_verify  AS (SELECT count(*)::int AS n FROM public.verification_requests WHERE status = 'pending'),
  kpi_open_reports    AS (SELECT count(*)::int AS n FROM public.reports WHERE status IN ('open', 'reviewing')),

  -- Authoritative member/entitlement split (never fabricated: every figure is
  -- a COUNT over the same tables the rest of the product gates on).
  kpi_paid_members    AS (SELECT count(DISTINCT s.user_id)::int AS n FROM public.subscriptions s WHERE s.status = 'active' AND s.expires_at > now()),
  kpi_free_members    AS (SELECT count(*)::int AS n FROM public.profiles p
                          WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s
                                            WHERE s.user_id = p.id AND s.status = 'active' AND s.expires_at > now())),
  kpi_hidden_profiles AS (SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE status = 'hidden'),
  kpi_verified_profiles AS (SELECT count(*)::int AS n FROM public.matrimony_profiles WHERE verified_at IS NOT NULL),
  kpi_expiring_subs   AS (SELECT count(*)::int AS n FROM public.subscriptions
                          WHERE status = 'active' AND expires_at > now() AND expires_at <= now() + interval '7 days'),
  kpi_promo_subs      AS (SELECT count(*)::int AS n FROM public.subscriptions s
                          WHERE s.status = 'active' AND s.expires_at > now() AND s.payment_id IS NULL),
  kpi_reports_window  AS (SELECT count(*)::int AS n FROM public.reports WHERE created_at >= v_since),
  kpi_reports_resolved AS (SELECT count(*)::int AS n FROM public.reports WHERE status = 'resolved'),

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
  -- IST calendar-day axis, ending on TODAY (IST). Deliberately a plain
  -- timestamp series: converting it to timestamptz would re-render the labels
  -- in the session timezone (UTC) and drop the current IST day off the axis.
  days AS (
    SELECT to_char(d, 'YYYY-MM-DD') AS day
    FROM generate_series(
      date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') - ((v_days - 1) || ' days')::interval,
      date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata'),
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

  -- Live subscriptions per package + all-time captured revenue per package
  -- (authoritative: the subscriptions and payments tables, grouped
  --  separately so no aggregate is correlated inside another aggregate).
  package_active AS (
    SELECT coalesce(nullif(btrim(s.package_slug), ''), '(unknown)') AS slug,
           count(*)::int AS active
    FROM public.subscriptions s
    WHERE s.status = 'active' AND s.expires_at > now()
    GROUP BY 1
  ),
  package_revenue AS (
    SELECT coalesce(nullif(btrim(p.package_slug), ''), '(unknown)') AS slug,
           coalesce(sum(p.amount_inr), 0)::int AS revenue_total
    FROM public.payments p
    WHERE p.kind = 'package' AND p.status = 'captured'
    GROUP BY 1
  ),
  package_mix AS (
    SELECT a.slug, a.active, coalesce(r.revenue_total, 0)::int AS revenue_total
    FROM package_active a
    LEFT JOIN package_revenue r ON r.slug = a.slug
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
      'open_reports',         (SELECT n FROM kpi_open_reports),
      'paid_members',         (SELECT n FROM kpi_paid_members),
      'free_members',         (SELECT n FROM kpi_free_members),
      'hidden_profiles',      (SELECT n FROM kpi_hidden_profiles),
      'verified_profiles',    (SELECT n FROM kpi_verified_profiles),
      'expiring_subscriptions', (SELECT n FROM kpi_expiring_subs),
      'live_promotional_subscriptions', (SELECT n FROM kpi_promo_subs),
      'reports_window',       (SELECT n FROM kpi_reports_window),
      'reports_resolved',     (SELECT n FROM kpi_reports_resolved)
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
    'packages', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'package_slug', slug, 'active', active, 'revenue_total', revenue_total
      ) ORDER BY active DESC, slug), '[]'::jsonb) FROM package_mix),
    'event_vocabulary', (SELECT to_jsonb(public.canonical_activity_events()))
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_analytics(integer, uuid) IS
  'Admin-only analytics RPC. Authorised by admin_assert_actor(p_admin_id) — the single authoritative admin check shared by every admin RPC — so it works for the service-role admin panel (which has no auth.uid()) and for a signed-in admin, and refuses everyone else. Returns KPIs, IST daily buckets, top cities, live package mix and recent activity, all bounded by the requested window (default 14 days, max 365). Reads from authoritative business tables (no double-counting, no fabricated figures). Does not return contact / payment secrets.';

REVOKE ALL ON FUNCTION public.admin_analytics(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics(integer, uuid) TO service_role;
