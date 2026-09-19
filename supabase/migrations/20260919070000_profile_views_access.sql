-- ============================================================================
-- Mali Vivah · Profile-view ACCESS model (PRD alignment)
--
-- WHY
--   The PRD splits profile-view information into TWO distinct capabilities:
--     • "Profile views"            = the aggregate COUNT   → benefit profile_views
--     • "Who viewed your profile"  = the VISITOR LIST      → benefit who_viewed_me
--   and grants NEITHER of them to the FREE tier.
--
--   Before this migration:
--     a. free_benefits() carried "profile_views": true, so a free member was
--        treated as entitled to the count.
--     b. profile_views RLS let ANY authenticated member SELECT every row where
--        viewed_id = auth.uid(). A free member could therefore read the count
--        (and the raw visitor rows) straight from PostgREST, bypassing the
--        /profile/views benefit check entirely — the gate lived only in the UI.
--
-- WHAT THIS MIGRATION DOES  (access only — tracking is untouched)
--   §1 free_benefits(): "profile_views" → false. FREE gets neither the count
--      nor the visitor list. Paid plans keep their own maps verbatim
--      (Smart: count only; Premium/VIP: count + who viewed me).
--   §2 profile_views SELECT policy is narrowed to the member's OWN rows AND
--      has_benefit('who_viewed_me') — direct row access is the visitor-list
--      capability, so only plans that actually own it may read rows. The
--      INSERT policy (viewer_id = auth.uid()) is unchanged: every member keeps
--      recording views, they just cannot read other people's or ungated data.
--   §3 my_profile_view_stats() — the ONE server-authoritative way for a member
--      to obtain their own profile-view COUNT. SECURITY DEFINER, re-checks
--      has_benefit('profile_views', auth.uid()) and returns no number at all
--      to a member without the benefit. It never exposes viewer identities.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not touch guard_profile_view() (self-view / non-public target /
--     blocked-pair rules) or notify_profile_view(): actual tracking — viewer
--     id, viewed id, timestamp, ACTIVE_PAID-only accumulation — is unchanged.
--   * It does not change package entitlements, pricing, payments or boosts.
--   * It does not restrict internal analytics: activity_events keeps its
--     'profile_viewed' stream (service-role only), which is a separate concern
--     from what the MEMBER may see about themselves.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (CREATE OR REPLACE + DROP POLICY IF EXISTS).
-- DEPENDS ON 20260915020000_packages_pricing.sql (has_benefit/free_benefits)
--        and 20260911000000_matrimony_profiles.sql (profile_views + RLS).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 FREE tier no longer grants the profile-view count
-- ----------------------------------------------------------------------------
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
    "profile_views": false,
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

COMMENT ON FUNCTION public.free_benefits() IS
  'Benefit map for the FREE tier: browse, discover and receive Daily 5, but stay hidden, unable to express interest and without any profile-view insight (neither the count nor the visitor list).';

REVOKE ALL ON FUNCTION public.free_benefits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.free_benefits() TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §2 RLS — raw visitor rows are the who_viewed_me capability
--    (a member without it cannot SELECT, so it cannot be counted either)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Member reads own visitors" ON public.profile_views;
CREATE POLICY "Member reads own visitors"
  ON public.profile_views FOR SELECT TO authenticated
  USING (
    viewed_id = auth.uid()
    AND public.has_benefit('who_viewed_me', auth.uid())
  );

-- Unchanged, restated so the file is self-describing: the viewer records the
-- view. Tracking must keep working for every tier, paid or free.
DROP POLICY IF EXISTS "Viewer records a view" ON public.profile_views;
CREATE POLICY "Viewer records a view"
  ON public.profile_views FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid());


-- ----------------------------------------------------------------------------
-- §3 my_profile_view_stats() — server-authoritative profile-view COUNT
-- ----------------------------------------------------------------------------
/**
 * The caller's own profile-view summary:
 *   { allowed, total, last_30_days, last_viewed_at, who_viewed_me }
 *
 *   allowed        — has_benefit('profile_views'): FALSE for FREE and for any
 *                    plan whose map does not grant it.
 *   total          — lifetime count of views of the caller's profile, or NULL
 *                    when not allowed (no number is ever returned to a member
 *                    without the benefit).
 *   who_viewed_me  — whether the caller may also open the visitor list; lets
 *                    the UI link to /profile/views without a second round trip.
 *
 * Only ever reports on auth.uid() — there is no parameter, so one member can
 * never ask about another. Viewer identities are NOT part of the payload.
 */
CREATE OR REPLACE FUNCTION public.my_profile_view_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_allowed BOOLEAN;
  v_total   INTEGER;
  v_recent  INTEGER;
  v_last    TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', FALSE, 'total', NULL, 'last_30_days', NULL,
      'last_viewed_at', NULL, 'who_viewed_me', FALSE
    );
  END IF;

  v_allowed := public.has_benefit('profile_views', v_user);

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'allowed', FALSE, 'total', NULL, 'last_30_days', NULL,
      'last_viewed_at', NULL, 'who_viewed_me', FALSE
    );
  END IF;

  SELECT count(*)::int,
         count(*) FILTER (WHERE pv.viewed_at > now() - interval '30 days')::int,
         max(pv.viewed_at)
    INTO v_total, v_recent, v_last
  FROM public.profile_views pv
  WHERE pv.viewed_id = v_user
    AND pv.viewer_id <> v_user;

  RETURN jsonb_build_object(
    'allowed', TRUE,
    'total', coalesce(v_total, 0),
    'last_30_days', coalesce(v_recent, 0),
    'last_viewed_at', v_last,
    'who_viewed_me', public.has_benefit('who_viewed_me', v_user)
  );
END;
$$;

COMMENT ON FUNCTION public.my_profile_view_stats() IS
  'The caller''s own profile-view COUNT, gated on has_benefit(''profile_views''). Returns allowed=false with a NULL total for members without the benefit (FREE). Never returns viewer identities — that is the separate who_viewed_me capability.';

REVOKE ALL ON FUNCTION public.my_profile_view_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_profile_view_stats() TO authenticated;
