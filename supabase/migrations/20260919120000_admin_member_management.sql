-- ============================================================================
-- Mali Vivah · Step 7 — complete Admin Member / User Management
--
-- WHAT IT ADDS
--   The admin panel already had Suspend / Verify / Feature / manual package
--   activation and a service-role boost grant (admin_grant_boost, Step 1).
--   What was missing was an AUTHORITATIVE, state-aware server side for the
--   remaining PRD admin actions — Approve, Edit, Hide, Reactivate, Delete —
--   and a way to tell an admin "hide" apart from every other reason a
--   profile is not public. Nothing here creates a second status system, a
--   second boost system or a second audit system:
--
--   §1  matrimony_profiles gains an ADMIN HOLD (admin_hidden_at / _by /
--       _reason) and SUSPENSION bookkeeping (suspended_at / _by /
--       suspension_reason / status_before_suspension). The `status` column
--       keeps its existing vocabulary — draft, pending_review, hidden
--       (APPROVED_FREE), active (ACTIVE_PAID), suspended, expired, rejected —
--       so Admin Hide is an orthogonal flag, distinguishable from
--       suspension, expiry, user privacy settings and incomplete drafts.
--   §2  is_profile_public() v2 — the ONE publicity rule additionally requires
--       admin_hidden_at IS NULL. Every public surface (search_matches,
--       get_public_profile, Daily 5, featured, express_interest, profile
--       views) already gates on this function, so a hidden profile
--       disappears everywhere at once.
--   §3  RLS tightening (never loosening): the two "members read active…"
--       policies on matrimony_profiles / profile_photos also require the
--       admin hold to be clear, so a direct table read cannot see a row the
--       RPCs refuse to return.
--   §4  profile_visibility_reason() v2 — new 'admin_hidden' reason so the
--       member's dashboard tells the truth (no internal reason is shown).
--   §5  canonical_activity_events() — admin_member_* vocabulary.
--   §6  Admin RPCs (service role only; every one re-verifies that the acting
--       admin is a real is_admin profile and that an authenticated caller,
--       if any, is that same admin):
--         admin_member_state()            snapshot for the detail page/tests
--         admin_set_profile_suspended()   suspend / state-aware unsuspend
--         admin_set_profile_hidden()      admin hold on / off
--         admin_reactivate_profile()      state-aware reactivate
--         admin_approve_profile()         approve (never bypasses completion,
--                                         never bypasses payment: free ⇒ hidden)
--         admin_reject_profile()          send back for changes (existing
--                                         'rejected' status)
--         admin_update_member_profile()   allow-listed edit of profile +
--                                         partner preferences (+ full_name)
--         admin_prepare_member_deletion() guards + audit + activity BEFORE the
--                                         server action removes the auth user
--         admin_list_members()            server-side filtered / paged list
--       Each state change writes ONE admin_audit_log row (with the internal
--       reason) and ONE activity_events row (safe metadata only — members can
--       read their own activity, so reasons and admin ids never go there).
--
-- STATE RULES (unchanged model, now enforced in one place)
--   • Unsuspend / Reactivate never invents a paid state: live membership →
--     'active' (through the publish gate), lapsed membership → 'expired',
--     never paid → 'hidden' (APPROVED_FREE), never-published → back to the
--     status it had before suspension.
--   • Approve requires the same completeness checklist as the publish gate
--     and lands on 'active' only with a live membership, otherwise 'hidden'.
--   • Hide keeps status, membership, subscriptions and payments untouched.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent). DEPENDS ON migrations up to 20260919110000.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §0 Prerequisite guard
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.log_activity(uuid, text, jsonb, text)') IS NULL
     OR to_regprocedure('public.canonical_activity_events()') IS NULL
     OR to_regprocedure('public.admin_grant_boost(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'admin_member_management: prerequisite migrations (20260919060000, 20260919110000) are not applied',
      HINT    = 'Run every earlier file in supabase/migrations/ first.';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- §1 Admin hold + suspension bookkeeping on matrimony_profiles
-- ----------------------------------------------------------------------------
ALTER TABLE public.matrimony_profiles
  ADD COLUMN IF NOT EXISTS admin_hidden_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_hidden_by          UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_hidden_reason      TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by             UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason        TEXT,
  ADD COLUMN IF NOT EXISTS status_before_suspension public.profile_status;

COMMENT ON COLUMN public.matrimony_profiles.admin_hidden_at IS
  'ADMIN HOLD: set by admin_set_profile_hidden(). While set the profile is never public (is_profile_public), whatever its status or membership. Orthogonal to status so hide is distinguishable from suspension / expiry / user privacy / drafts. Cleared by unhide / reactivate.';
COMMENT ON COLUMN public.matrimony_profiles.admin_hidden_reason IS
  'Internal note for the admin hold (admin-only; never returned to members).';
COMMENT ON COLUMN public.matrimony_profiles.suspended_at IS
  'When an admin suspended this profile (status = suspended). Cleared on unsuspend / reactivate.';
COMMENT ON COLUMN public.matrimony_profiles.suspension_reason IS
  'Internal suspension note (admin-only; never returned to members).';
COMMENT ON COLUMN public.matrimony_profiles.status_before_suspension IS
  'Status at the moment of suspension so a state-aware unsuspend can restore a never-published draft as a draft instead of guessing.';

CREATE INDEX IF NOT EXISTS matrimony_profiles_admin_hidden_idx
  ON public.matrimony_profiles (admin_hidden_at)
  WHERE admin_hidden_at IS NOT NULL;

-- Rows suspended before this migration: keep them suspended and record an
-- approximate timestamp so the admin UI can show *something*; the prior
-- status is unknown and stays NULL (the restore logic treats NULL as
-- "approved" and lets membership decide).
UPDATE public.matrimony_profiles
SET suspended_at = coalesce(updated_at, now())
WHERE status = 'suspended'
  AND suspended_at IS NULL;


-- ----------------------------------------------------------------------------
-- §2 is_profile_public() v2 — admin hold added to the ONE publicity rule
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_profile_public(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matrimony_profiles mp
    JOIN public.profiles p ON p.id = mp.user_id
    WHERE mp.user_id = p_user_id
      AND mp.status = 'active'
      AND mp.admin_hidden_at IS NULL
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND p.is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM public.profile_photos ph
        WHERE ph.profile_id = mp.user_id AND ph.kind = 'profile_photo'
      )
      AND EXISTS (
        SELECT 1 FROM public.profile_photos ph
        WHERE ph.profile_id = mp.user_id AND ph.kind = 'family_photo'
      )
      AND public.has_live_membership(mp.user_id)
  );
$$;

COMMENT ON FUNCTION public.is_profile_public(uuid) IS
  'The ONE publicity rule: status=active + no admin hold (admin_hidden_at IS NULL) + gender + date of birth + active account + profile photo + family photo + live (unexpired) membership. Used by search_matches(), get_public_profile(), recommendations, Daily 5, featured and express_interest so every surface agrees. Never called from RLS policies on matrimony_profiles.';

REVOKE ALL ON FUNCTION public.is_profile_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_profile_public(uuid) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §3 RLS — direct table reads agree with the RPCs (tightening only)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members read active matrimony profiles" ON public.matrimony_profiles;
CREATE POLICY "Members read active matrimony profiles"
  ON public.matrimony_profiles FOR SELECT TO authenticated
  USING (status = 'active' AND admin_hidden_at IS NULL);

DROP POLICY IF EXISTS "Members read photos of active profiles" ON public.profile_photos;
CREATE POLICY "Members read photos of active profiles"
  ON public.profile_photos FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.matrimony_profiles mp
    WHERE mp.user_id = profile_photos.profile_id
      AND mp.status = 'active'
      AND mp.admin_hidden_at IS NULL
  ));


-- ----------------------------------------------------------------------------
-- §4 profile_visibility_reason() v2 — 'admin_hidden' reason
--    Body identical to 20260915100000 except for the new branch (2b). The
--    member sees a neutral headline; the internal reason stays admin-only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profile_visibility_reason(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A signed-in member may only ever inspect their own row.
  v_user       UUID := coalesce(auth.uid(), p_user_id);
  v_mp         public.matrimony_profiles%ROWTYPE;
  v_account    BOOLEAN := FALSE;
  v_missing    TEXT[]  := ARRAY[]::TEXT[];
  v_public     BOOLEAN := FALSE;
  v_paid       BOOLEAN := FALSE;
  v_ever_sub   BOOLEAN := FALSE;
  v_expires    TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'status', NULL, 'is_public', FALSE, 'reason', 'not_signed_in',
      'missing', '[]'::jsonb,
      'headline', 'Sign in to manage your profile',
      'detail', 'You need an account to create a matrimony profile.',
      'cta', jsonb_build_object('label', 'Log in / Register', 'href', '/login')
    );
  END IF;

  SELECT (p.is_active) INTO v_account FROM public.profiles p WHERE p.id = v_user;
  v_account := coalesce(v_account, FALSE);

  SELECT mp.* INTO v_mp
  FROM public.matrimony_profiles mp
  WHERE mp.user_id = v_user;

  v_paid := public.has_live_membership(v_user);
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s WHERE s.user_id = v_user
  ) INTO v_ever_sub;
  SELECT max(s.expires_at) INTO v_expires
  FROM public.subscriptions s WHERE s.user_id = v_user;

  -- Completeness checklist (identical to the publish gate).
  IF v_mp.user_id IS NULL THEN
    v_missing := array_append(v_missing, 'profile');
  ELSE
    IF v_mp.gender IS NULL THEN v_missing := array_append(v_missing, 'gender'); END IF;
    IF v_mp.date_of_birth IS NULL THEN v_missing := array_append(v_missing, 'date of birth'); END IF;
    IF nullif(btrim(coalesce(v_mp.city, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'city'); END IF;
    IF nullif(btrim(coalesce(v_mp.education, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'education'); END IF;
    IF nullif(btrim(coalesce(v_mp.occupation, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'occupation'); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = v_user AND ph.kind = 'profile_photo') THEN
    v_missing := array_append(v_missing, 'profile photo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = v_user AND ph.kind = 'family_photo') THEN
    v_missing := array_append(v_missing, 'family photo');
  END IF;

  v_public := public.is_profile_public(v_user);

  -- 1. Account-level gates first.
  IF NOT v_account THEN
    RETURN jsonb_build_object(
      'status', coalesce(v_mp.status::text, 'draft'), 'is_public', FALSE,
      'reason', 'account_inactive', 'missing', to_jsonb(v_missing),
      'headline', 'Your account is deactivated',
      'detail', 'Your profile is hidden because this account has been deactivated. Contact support to reactivate it.',
      'cta', jsonb_build_object('label', 'Contact support', 'href', '/contact')
    );
  END IF;

  -- 2. Admin-managed statuses.
  IF v_mp.status = 'pending_review' THEN
    RETURN jsonb_build_object(
      'status', 'pending_review', 'is_public', FALSE, 'reason', 'pending_review',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile is under review',
      'detail', 'Our team is checking your details. You will be notified as soon as it is approved.',
      'cta', NULL
    );
  END IF;
  IF v_mp.status = 'suspended' THEN
    RETURN jsonb_build_object(
      'status', 'suspended', 'is_public', FALSE, 'reason', 'suspended',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile has been suspended',
      'detail', 'A moderator suspended this profile. Reach out to support if you believe this is a mistake.',
      'cta', jsonb_build_object('label', 'Contact support', 'href', '/contact')
    );
  END IF;
  -- 2b. Admin hold (Step 7) — data, membership and status are untouched; the
  --     profile is simply not shown until the hold is lifted.
  IF v_mp.admin_hidden_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', v_mp.status::text, 'is_public', FALSE, 'reason', 'admin_hidden',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile is temporarily hidden',
      'detail', 'Our team has placed a temporary hold on your profile, so it is not shown in Browse, Search or matches right now. Your membership and details are unaffected. Contact support for help.',
      'cta', jsonb_build_object('label', 'Contact support', 'href', '/contact')
    );
  END IF;
  IF v_mp.status = 'rejected' THEN
    RETURN jsonb_build_object(
      'status', 'rejected', 'is_public', FALSE, 'reason', 'rejected',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile was not approved',
      'detail', 'Please review your details and photos, correct them and publish again.',
      'cta', jsonb_build_object('label', 'Edit profile', 'href', '/profile/edit')
    );
  END IF;

  -- 3. Completeness.
  IF v_mp.user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'draft', 'is_public', FALSE, 'reason', 'profile_incomplete',
      'missing', to_jsonb(v_missing),
      'headline', 'Create your matrimony profile',
      'detail', 'Tell families about yourself — education, occupation, photos and what you are looking for.',
      'cta', jsonb_build_object('label', 'Create profile', 'href', '/profile/edit')
    );
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RETURN jsonb_build_object(
      'status', v_mp.status::text, 'is_public', FALSE, 'reason', 'profile_incomplete',
      'missing', to_jsonb(v_missing),
      'headline', 'Your profile is incomplete',
      'detail', format('Add the missing %s — your profile stays private until it is complete.',
                       CASE WHEN array_length(v_missing, 1) = 1 THEN 'item below' ELSE 'items below' END),
      'cta', jsonb_build_object('label', 'Complete profile', 'href', '/profile/edit')
    );
  END IF;

  -- 4. Complete but never published.
  IF v_mp.status = 'draft' THEN
    RETURN jsonb_build_object(
      'status', 'draft', 'is_public', FALSE, 'reason', 'not_published',
      'missing', '[]'::jsonb,
      'headline', 'Your profile is ready to publish',
      'detail', 'Press “Publish profile” in the profile wizard. Free profiles stay private until you become a paid member.',
      'cta', jsonb_build_object('label', 'Publish profile', 'href', '/profile/edit')
    );
  END IF;

  -- 5. Membership gates (PRD: free ⇒ hidden; expired ⇒ hidden + renew CTA).
  IF NOT v_paid THEN
    IF v_ever_sub THEN
      RETURN jsonb_build_object(
        'status', coalesce(v_mp.status::text, 'expired'), 'is_public', FALSE,
        'reason', 'membership_expired', 'missing', '[]'::jsonb,
        'expired_at', v_expires,
        'headline', 'Your membership has expired',
        'detail', 'Your profile is hidden and you can no longer express interest. Renew your membership to come back.',
        'cta', jsonb_build_object('label', 'Renew Membership', 'href', '/packages')
      );
    END IF;
    RETURN jsonb_build_object(
      'status', coalesce(v_mp.status::text, 'hidden'), 'is_public', FALSE,
      'reason', 'membership_required', 'missing', '[]'::jsonb,
      'headline', 'Your profile is complete — one step left',
      -- Locked PRD copy — do not reword.
      'detail', 'Become a Paid Member to showcase your profile and express interest.',
      'cta', jsonb_build_object('label', 'View membership packages', 'href', '/packages')
    );
  END IF;

  -- 6. Paid + complete.
  RETURN jsonb_build_object(
    'status', v_mp.status::text, 'is_public', v_public,
    'reason', CASE WHEN v_public THEN 'public' ELSE 'activating' END,
    'missing', '[]'::jsonb,
    'headline', CASE WHEN v_public
      THEN 'Your profile is live'
      ELSE 'Your membership is active' END,
    'detail', CASE WHEN v_public
      THEN 'Families can find you in Browse & Search and express interest.'
      ELSE 'Publish your profile to appear in Browse & Search.' END,
    'cta', CASE WHEN v_public THEN NULL
      ELSE jsonb_build_object('label', 'Publish profile', 'href', '/profile/edit') END
  );
END;
$$;

COMMENT ON FUNCTION public.profile_visibility_reason(uuid) IS
  'Render-ready explanation of why the caller''s profile is or is not publicly visible: { status, is_public, reason, missing[], headline, detail, cta{label,href}, expired_at? }. Reasons: public, activating, not_published, profile_incomplete, membership_required, membership_expired, pending_review, suspended, admin_hidden, rejected, account_inactive, not_signed_in. Authenticated callers can only inspect their OWN row (auth.uid() wins over the argument); the service role may inspect anyone. The membership_required detail is locked PRD copy.';

REVOKE ALL ON FUNCTION public.profile_visibility_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_visibility_reason(uuid) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §5 canonical_activity_events() — admin member-management vocabulary
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
    'admin_manual_membership_activation'
  ]::TEXT[]
$$;

COMMENT ON FUNCTION public.canonical_activity_events() IS
  'Authoritative event vocabulary for activity_events. Centralised so analytics UI + tests share one list. New event names must be added here. (boost_granted is the admin boost event — Step 1 semantics, no second boost system.)';

REVOKE ALL ON FUNCTION public.canonical_activity_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_activity_events() TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §6a admin_assert_actor(p_admin_id) — shared authorization for admin RPCs
--     The RPCs are EXECUTE-able by service_role only (the Next.js server
--     action already verified is_admin() through requireAdminAction()), but
--     the body re-checks anyway:
--       * an authenticated caller (should the grant ever widen) must be an
--         admin AND must be the admin it claims to act as;
--       * p_admin_id must name an existing is_admin profile — a leaked
--         service key alone cannot produce an anonymous audit trail.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assert_actor(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RAISE EXCEPTION 'ADMIN_ONLY: anonymous callers cannot perform admin actions';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY: this action is restricted to administrators';
  END IF;
  IF p_admin_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_admin_id AND p.is_admin) THEN
    RAISE EXCEPTION 'ADMIN_ONLY: acting admin is not recognised';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_ONLY: acting admin does not match the signed-in user';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_assert_actor(uuid) IS
  'Raises ADMIN_ONLY unless p_admin_id is an is_admin profile and any signed-in caller is that same admin. Shared by every Step 7 admin RPC (defence in depth behind the service-role EXECUTE grant).';

REVOKE ALL ON FUNCTION public.admin_assert_actor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assert_actor(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6b admin_profile_missing(p_user_id) — the publish-gate checklist as data
--     (same seven items as enforce_publishable_profile / visibility reason)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_profile_missing(p_user_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp      public.matrimony_profiles%ROWTYPE;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;
  IF v_mp.user_id IS NULL THEN
    RETURN ARRAY['profile'];
  END IF;
  IF v_mp.gender IS NULL THEN v_missing := array_append(v_missing, 'gender'); END IF;
  IF v_mp.date_of_birth IS NULL THEN v_missing := array_append(v_missing, 'date of birth'); END IF;
  IF nullif(btrim(coalesce(v_mp.city, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'city'); END IF;
  IF nullif(btrim(coalesce(v_mp.education, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'education'); END IF;
  IF nullif(btrim(coalesce(v_mp.occupation, '')), '') IS NULL THEN v_missing := array_append(v_missing, 'occupation'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = p_user_id AND ph.kind = 'profile_photo') THEN
    v_missing := array_append(v_missing, 'profile photo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = p_user_id AND ph.kind = 'family_photo') THEN
    v_missing := array_append(v_missing, 'family photo');
  END IF;
  RETURN v_missing;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_profile_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_profile_missing(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6c admin_member_state(p_user_id) — one truthful snapshot
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_member_state(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp   public.matrimony_profiles%ROWTYPE;
  v_ever BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY: this action is restricted to administrators';
  END IF;
  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;
  IF v_mp.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p_user_id) INTO v_ever;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', v_mp.status::text,
    'is_public', public.is_profile_public(p_user_id),
    'admin_hidden', v_mp.admin_hidden_at IS NOT NULL,
    'admin_hidden_at', v_mp.admin_hidden_at,
    'admin_hidden_reason', v_mp.admin_hidden_reason,
    'suspended', v_mp.status = 'suspended',
    'suspended_at', v_mp.suspended_at,
    'suspension_reason', v_mp.suspension_reason,
    'status_before_suspension', v_mp.status_before_suspension::text,
    'live_membership', public.has_live_membership(p_user_id),
    'ever_subscribed', v_ever,
    'verified', v_mp.verified_at IS NOT NULL,
    'featured', EXISTS (SELECT 1 FROM public.featured_profiles f WHERE f.profile_id = p_user_id),
    'boosted', public.has_active_boost(p_user_id),
    'missing', to_jsonb(public.admin_profile_missing(p_user_id)),
    'membership', public.get_membership(p_user_id),
    'visibility', public.profile_visibility_reason(p_user_id)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_member_state(uuid) IS
  'Admin snapshot of one member: status, publicity, admin hold, suspension, membership truth, verification / featured / boost flags, publish-gate gaps, membership + visibility payloads. Service role only (the admin panel); internal reasons included because the caller is an admin.';

REVOKE ALL ON FUNCTION public.admin_member_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_member_state(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6d admin_apply_restored_status(p_user_id, p_prior) — INTERNAL
--     The single place that decides what a profile becomes when an admin
--     lifts a suspension (or reactivates it). It never invents a paid state:
--       live membership          → 'active' (through the publish gate; if the
--                                  gate refuses — e.g. a photo was removed —
--                                  the profile lands on the truthful
--                                  non-public status instead of staying
--                                  suspended)
--       never published (draft / pending_review / rejected before) → same
--       lapsed membership        → 'expired'
--       never paid               → 'hidden' (APPROVED_FREE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_apply_restored_status(
  p_user_id UUID,
  p_prior   public.profile_status
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live   BOOLEAN := public.has_live_membership(p_user_id);
  v_ever   BOOLEAN;
  v_target public.profile_status;
  v_note   TEXT;
  v_final  public.profile_status;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p_user_id) INTO v_ever;

  IF v_live THEN
    BEGIN
      UPDATE public.matrimony_profiles
      SET status = 'active', updated_at = now()
      WHERE user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN
      v_note := SQLERRM;   -- PROFILE_INCOMPLETE: … (the row is unchanged)
    END;
    IF v_note IS NOT NULL THEN
      v_target := CASE WHEN p_prior IN ('draft', 'pending_review', 'rejected') THEN p_prior ELSE 'hidden' END;
      UPDATE public.matrimony_profiles
      SET status = v_target, updated_at = now()
      WHERE user_id = p_user_id;
    END IF;
  ELSE
    v_target := CASE
      WHEN p_prior IN ('draft', 'pending_review', 'rejected') THEN p_prior
      WHEN v_ever THEN 'expired'::public.profile_status
      ELSE 'hidden'::public.profile_status
    END;
    UPDATE public.matrimony_profiles
    SET status = v_target, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  SELECT mp.status INTO v_final FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;
  RETURN jsonb_build_object(
    'status', v_final::text,
    'live_membership', v_live,
    'ever_subscribed', v_ever,
    'publish_note', v_note
  );
END;
$$;

COMMENT ON FUNCTION public.admin_apply_restored_status(uuid, public.profile_status) IS
  'INTERNAL (called by the Step 7 admin RPCs): applies the truthful non-suspended status for a member — active only with a live membership and a complete profile, expired for a lapsed membership, hidden (APPROVED_FREE) for never-paid, or the pre-suspension draft/pending/rejected status. Never creates membership.';

REVOKE ALL ON FUNCTION public.admin_apply_restored_status(uuid, public.profile_status) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_restored_status(uuid, public.profile_status) TO service_role;


-- ----------------------------------------------------------------------------
-- §6e admin_set_profile_suspended(p_user_id, p_suspend, p_admin_id, p_reason)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_profile_suspended(
  p_user_id  UUID,
  p_suspend  BOOLEAN,
  p_admin_id UUID,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp     public.matrimony_profiles%ROWTYPE;
  v_reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
  v_result JSONB;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_SELF_ACTION: you cannot suspend or unsuspend your own account here';
  END IF;

  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id FOR UPDATE;
  IF v_mp.user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no matrimony profile for %', p_user_id;
  END IF;

  IF p_suspend THEN
    IF v_mp.status = 'suspended' THEN
      RETURN jsonb_build_object('status', 'suspended', 'changed', FALSE);
    END IF;

    UPDATE public.matrimony_profiles
    SET status = 'suspended',
        status_before_suspension = v_mp.status,
        suspended_at = now(),
        suspended_by = p_admin_id,
        suspension_reason = v_reason,
        updated_at = now()
    WHERE user_id = p_user_id;

    PERFORM public.push_notification(
      p_user_id, 'admin_message',
      'Your profile has been suspended',
      'A moderator suspended your profile. It is no longer visible to other members and interest is paused. Contact support if you believe this is a mistake.',
      '{}'::jsonb, '/contact'
    );
    PERFORM public.log_activity(
      p_user_id, 'admin_member_suspended',
      jsonb_build_object('from_status', v_mp.status::text, 'to_status', 'suspended')
    );
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (p_admin_id, 'admin_member_suspended', 'profile', p_user_id::text,
            jsonb_strip_nulls(jsonb_build_object('from_status', v_mp.status::text, 'reason', v_reason)));

    RETURN jsonb_build_object('status', 'suspended', 'changed', TRUE, 'from_status', v_mp.status::text);
  END IF;

  -- Unsuspend
  IF v_mp.status <> 'suspended' THEN
    RETURN jsonb_build_object('status', v_mp.status::text, 'changed', FALSE);
  END IF;

  UPDATE public.matrimony_profiles
  SET suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL, status_before_suspension = NULL
  WHERE user_id = p_user_id;

  v_result := public.admin_apply_restored_status(p_user_id, v_mp.status_before_suspension);

  PERFORM public.push_notification(
    p_user_id, 'admin_message',
    'Your profile suspension has been lifted',
    CASE WHEN public.is_profile_public(p_user_id)
      THEN 'Your profile is visible again in Browse & Search.'
      ELSE 'Your profile is no longer suspended. Open My Profile to see what is needed for it to appear in Browse & Search.'
    END,
    '{}'::jsonb, '/profile'
  );
  PERFORM public.log_activity(
    p_user_id, 'admin_member_unsuspended',
    jsonb_build_object('from_status', 'suspended', 'to_status', v_result ->> 'status',
                       'live_membership', (v_result ->> 'live_membership')::boolean)
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_unsuspended', 'profile', p_user_id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'to_status', v_result ->> 'status',
            'restored_from', v_mp.status_before_suspension::text,
            'live_membership', (v_result ->> 'live_membership')::boolean,
            'publish_note', v_result ->> 'publish_note',
            'reason', v_reason)));

  RETURN v_result || jsonb_build_object('changed', TRUE, 'from_status', 'suspended');
END;
$$;

COMMENT ON FUNCTION public.admin_set_profile_suspended(uuid, boolean, uuid, text) IS
  'Admin suspend (status → suspended, remembers the prior status) / state-aware unsuspend (live membership → active via the publish gate, lapsed → expired, never paid → hidden, never published → prior draft/pending/rejected). Refuses self-action. Notifies the member without the internal reason; writes admin_audit_log + activity_events. Service role only.';

REVOKE ALL ON FUNCTION public.admin_set_profile_suspended(uuid, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_suspended(uuid, boolean, uuid, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §6f admin_set_profile_hidden(p_user_id, p_hide, p_admin_id, p_reason)
--     The admin HOLD. Status, membership, subscriptions and payments are
--     untouched; the profile just stops being public until the hold is
--     lifted (unhide here, or Reactivate).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_profile_hidden(
  p_user_id  UUID,
  p_hide     BOOLEAN,
  p_admin_id UUID,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp     public.matrimony_profiles%ROWTYPE;
  v_reason TEXT := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_SELF_ACTION: you cannot hide or unhide your own account here';
  END IF;

  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id FOR UPDATE;
  IF v_mp.user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no matrimony profile for %', p_user_id;
  END IF;

  IF p_hide THEN
    IF v_mp.admin_hidden_at IS NOT NULL THEN
      RETURN jsonb_build_object('status', v_mp.status::text, 'admin_hidden', TRUE, 'changed', FALSE);
    END IF;

    UPDATE public.matrimony_profiles
    SET admin_hidden_at = now(), admin_hidden_by = p_admin_id, admin_hidden_reason = v_reason, updated_at = now()
    WHERE user_id = p_user_id;

    PERFORM public.push_notification(
      p_user_id, 'admin_message',
      'Your profile is temporarily hidden',
      'Our team has placed a temporary hold on your profile, so it is not shown in Browse, Search or matches right now. Your membership and details are unaffected. Contact support for help.',
      '{}'::jsonb, '/contact'
    );
    PERFORM public.log_activity(
      p_user_id, 'admin_member_hidden',
      jsonb_build_object('status', v_mp.status::text)
    );
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (p_admin_id, 'admin_member_hidden', 'profile', p_user_id::text,
            jsonb_strip_nulls(jsonb_build_object('status', v_mp.status::text, 'reason', v_reason)));

    RETURN jsonb_build_object('status', v_mp.status::text, 'admin_hidden', TRUE, 'changed', TRUE);
  END IF;

  -- Unhide
  IF v_mp.admin_hidden_at IS NULL THEN
    RETURN jsonb_build_object('status', v_mp.status::text, 'admin_hidden', FALSE, 'changed', FALSE);
  END IF;

  UPDATE public.matrimony_profiles
  SET admin_hidden_at = NULL, admin_hidden_by = NULL, admin_hidden_reason = NULL, updated_at = now()
  WHERE user_id = p_user_id;

  PERFORM public.push_notification(
    p_user_id, 'admin_message',
    'The hold on your profile has been lifted',
    CASE WHEN public.is_profile_public(p_user_id)
      THEN 'Your profile is visible again in Browse & Search.'
      ELSE 'The temporary hold on your profile has been removed. Open My Profile to see what is needed for it to appear in Browse & Search.'
    END,
    '{}'::jsonb, '/profile'
  );
  PERFORM public.log_activity(
    p_user_id, 'admin_member_reactivated',
    jsonb_build_object('mode', 'unhide', 'status', v_mp.status::text,
                       'is_public', public.is_profile_public(p_user_id))
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_unhidden', 'profile', p_user_id::text,
          jsonb_strip_nulls(jsonb_build_object('status', v_mp.status::text, 'reason', v_reason)));

  RETURN jsonb_build_object('status', v_mp.status::text, 'admin_hidden', FALSE, 'changed', TRUE,
                            'is_public', public.is_profile_public(p_user_id));
END;
$$;

COMMENT ON FUNCTION public.admin_set_profile_hidden(uuid, boolean, uuid, text) IS
  'Admin HOLD on / off (matrimony_profiles.admin_hidden_*). Hiding never touches status, membership or payments; is_profile_public() is FALSE while the hold is set. Refuses self-action. Notifies the member without the internal reason; writes admin_audit_log + activity_events. Service role only.';

REVOKE ALL ON FUNCTION public.admin_set_profile_hidden(uuid, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_hidden(uuid, boolean, uuid, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §6g admin_reactivate_profile(p_user_id, p_admin_id) — state-aware
--       SUSPENDED (any)                 → lift + restore truthful status
--       admin HOLD                      → lift
--       hidden/expired + live membership→ 'active' (repair path; publish gate)
--       expired, no membership          → unchanged (renewal required)
--       draft / incomplete              → unchanged (completion required)
--     Never creates a subscription; never bypasses the publish gate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reactivate_profile(
  p_user_id  UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp       public.matrimony_profiles%ROWTYPE;
  v_changes  TEXT[] := ARRAY[]::TEXT[];
  v_restored JSONB;
  v_note     TEXT;
  v_status   public.profile_status;
  v_live     BOOLEAN;
  v_public   BOOLEAN;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;

  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id FOR UPDATE;
  IF v_mp.user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no matrimony profile for %', p_user_id;
  END IF;

  v_live := public.has_live_membership(p_user_id);

  IF v_mp.admin_hidden_at IS NOT NULL THEN
    UPDATE public.matrimony_profiles
    SET admin_hidden_at = NULL, admin_hidden_by = NULL, admin_hidden_reason = NULL, updated_at = now()
    WHERE user_id = p_user_id;
    v_changes := array_append(v_changes, 'admin_hold_lifted');
  END IF;

  IF v_mp.status = 'suspended' THEN
    UPDATE public.matrimony_profiles
    SET suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL, status_before_suspension = NULL
    WHERE user_id = p_user_id;
    v_restored := public.admin_apply_restored_status(p_user_id, v_mp.status_before_suspension);
    v_note := v_restored ->> 'publish_note';
    v_changes := array_append(v_changes, 'suspension_lifted');
  ELSIF v_live AND v_mp.status IN ('hidden', 'expired') THEN
    -- Approved profile with a live plan that is not public (e.g. the plan was
    -- activated manually while the profile sat on hold): publish through the
    -- gate; an incomplete profile stays where it is with the gate's message.
    BEGIN
      UPDATE public.matrimony_profiles
      SET status = 'active', updated_at = now()
      WHERE user_id = p_user_id;
      v_changes := array_append(v_changes, 'published');
    EXCEPTION WHEN OTHERS THEN
      v_note := SQLERRM;
    END;
  ELSIF v_mp.status = 'expired' AND NOT v_live THEN
    v_note := 'MEMBERSHIP_EXPIRED: the membership has lapsed — the profile stays hidden until it is renewed (use Mark paid for a manual activation).';
  ELSIF v_mp.status = 'draft' THEN
    v_note := 'PROFILE_INCOMPLETE: ' || coalesce(array_to_string(public.admin_profile_missing(p_user_id), ', '), '')
              || CASE WHEN coalesce(array_length(public.admin_profile_missing(p_user_id), 1), 0) = 0
                      THEN 'the profile is complete but was never published — use Approve' ELSE '' END;
  END IF;

  SELECT mp.status INTO v_status FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id;
  v_public := public.is_profile_public(p_user_id);

  IF coalesce(array_length(v_changes, 1), 0) > 0 THEN
    PERFORM public.push_notification(
      p_user_id, 'admin_message',
      'Your profile has been reactivated',
      CASE WHEN v_public
        THEN 'Your profile is visible again in Browse & Search.'
        ELSE 'Your profile has been reactivated. Open My Profile to see what is needed for it to appear in Browse & Search.'
      END,
      '{}'::jsonb, '/profile'
    );
    PERFORM public.log_activity(
      p_user_id, 'admin_member_reactivated',
      jsonb_build_object('mode', 'reactivate', 'changes', to_jsonb(v_changes),
                         'from_status', v_mp.status::text, 'to_status', v_status::text,
                         'live_membership', v_live, 'is_public', v_public)
    );
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (p_admin_id, 'admin_member_reactivated', 'profile', p_user_id::text,
            jsonb_strip_nulls(jsonb_build_object(
              'changes', to_jsonb(v_changes), 'from_status', v_mp.status::text,
              'to_status', v_status::text, 'live_membership', v_live,
              'is_public', v_public, 'publish_note', v_note)));
  END IF;

  RETURN jsonb_build_object(
    'status', v_status::text,
    'from_status', v_mp.status::text,
    'changed', coalesce(array_length(v_changes, 1), 0) > 0,
    'changes', to_jsonb(v_changes),
    'live_membership', v_live,
    'is_public', v_public,
    'note', v_note
  );
END;
$$;

COMMENT ON FUNCTION public.admin_reactivate_profile(uuid, uuid) IS
  'State-aware admin Reactivate: lifts an admin hold and/or a suspension and restores the truthful status (active only with a live membership through the publish gate; expired stays expired without a renewal; drafts stay drafts). Never creates membership or bypasses profile completion. Service role only.';

REVOKE ALL ON FUNCTION public.admin_reactivate_profile(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_profile(uuid, uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6h admin_approve_profile(p_user_id, p_admin_id)
--     Eligible from draft / pending_review / rejected. Requires the full
--     publish checklist (PROFILE_INCOMPLETE otherwise). Free ⇒ 'hidden'
--     (APPROVED_FREE), paid ⇒ 'active' (the trigger re-validates).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_approve_profile(
  p_user_id  UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp      public.matrimony_profiles%ROWTYPE;
  v_missing TEXT[];
  v_live    BOOLEAN;
  v_target  public.profile_status;
  v_public  BOOLEAN;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;

  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id FOR UPDATE;
  IF v_mp.user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no matrimony profile for %', p_user_id;
  END IF;
  IF v_mp.status NOT IN ('draft', 'pending_review', 'rejected') THEN
    RAISE EXCEPTION 'APPROVE_NOT_APPLICABLE: profile is already % — nothing to approve', v_mp.status;
  END IF;

  v_missing := public.admin_profile_missing(p_user_id);
  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'PROFILE_INCOMPLETE: %', array_to_string(v_missing, ', ')
      USING HINT = 'A profile can only be approved once these are provided.';
  END IF;

  v_live := public.has_live_membership(p_user_id);
  v_target := CASE WHEN v_live THEN 'active'::public.profile_status ELSE 'hidden'::public.profile_status END;

  UPDATE public.matrimony_profiles
  SET status = v_target, updated_at = now()
  WHERE user_id = p_user_id;

  v_public := public.is_profile_public(p_user_id);

  PERFORM public.push_notification(
    p_user_id, 'admin_message',
    'Your profile has been approved',
    CASE
      WHEN v_public THEN 'Your profile is now live in Browse & Search.'
      WHEN v_live THEN 'Your profile is approved. Open My Profile to see what is needed for it to appear in Browse & Search.'
      -- Locked PRD copy — do not reword.
      ELSE 'Your profile is approved. Become a Paid Member to showcase your profile and express interest.'
    END,
    '{}'::jsonb,
    CASE WHEN v_live THEN '/profile' ELSE '/packages' END
  );
  PERFORM public.log_activity(
    p_user_id, 'admin_member_approved',
    jsonb_build_object('from_status', v_mp.status::text, 'to_status', v_target::text,
                       'live_membership', v_live, 'is_public', v_public)
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_approved', 'profile', p_user_id::text,
          jsonb_build_object('from_status', v_mp.status::text, 'to_status', v_target::text,
                             'live_membership', v_live, 'is_public', v_public));

  RETURN jsonb_build_object('status', v_target::text, 'from_status', v_mp.status::text,
                            'changed', TRUE, 'live_membership', v_live, 'is_public', v_public);
END;
$$;

COMMENT ON FUNCTION public.admin_approve_profile(uuid, uuid) IS
  'Admin approval within the existing status model: draft / pending_review / rejected → hidden (APPROVED_FREE) or, only with a live membership, active. Requires the publish checklist (PROFILE_INCOMPLETE otherwise). Approval never grants membership. Service role only.';

REVOKE ALL ON FUNCTION public.admin_approve_profile(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_profile(uuid, uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- §6i admin_reject_profile(p_user_id, p_admin_id, p_note)
--     Sends the profile back for changes (existing 'rejected' status). The
--     note is MEMBER-FACING by design ("what to fix"); it is kept out of the
--     activity stream and stored in admin_audit_log.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reject_profile(
  p_user_id  UUID,
  p_admin_id UUID,
  p_note     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp   public.matrimony_profiles%ROWTYPE;
  v_note TEXT := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_SELF_ACTION: you cannot reject your own profile here';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'NOTE_REQUIRED: tell the member what needs to change';
  END IF;

  SELECT mp.* INTO v_mp FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id FOR UPDATE;
  IF v_mp.user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no matrimony profile for %', p_user_id;
  END IF;
  IF v_mp.status IN ('suspended', 'rejected') THEN
    RAISE EXCEPTION 'REJECT_NOT_APPLICABLE: profile is already %', v_mp.status;
  END IF;

  UPDATE public.matrimony_profiles
  SET status = 'rejected', updated_at = now()
  WHERE user_id = p_user_id;

  PERFORM public.push_notification(
    p_user_id, 'admin_message',
    'Your profile needs changes before it can be approved',
    left(v_note, 500) || ' Update your profile and publish it again.',
    '{}'::jsonb, '/profile/edit'
  );
  PERFORM public.log_activity(
    p_user_id, 'admin_member_rejected',
    jsonb_build_object('from_status', v_mp.status::text, 'to_status', 'rejected')
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_rejected', 'profile', p_user_id::text,
          jsonb_build_object('from_status', v_mp.status::text, 'note', v_note));

  RETURN jsonb_build_object('status', 'rejected', 'from_status', v_mp.status::text, 'changed', TRUE);
END;
$$;

COMMENT ON FUNCTION public.admin_reject_profile(uuid, uuid, text) IS
  'Admin "send back for changes": status → rejected with a mandatory member-facing note (delivered as a notification, stored in admin_audit_log, never in activity metadata). Not applicable to suspended / already rejected profiles. Service role only.';

REVOKE ALL ON FUNCTION public.admin_reject_profile(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_profile(uuid, uuid, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §6j admin_update_member_profile(p_user_id, p_admin_id, p_profile, p_prefs)
--     Allow-listed patch. Anything else (status, verified_at, privacy
--     settings, admin/suspension columns, user_id, the derived legacy
--     sub_community text…) is REJECTED, not silently ignored. Existing
--     triggers keep doing their job: enforce_community_hierarchy() validates
--     community_id ↔ sub_community_id and re-syncs the legacy text,
--     normalise_partner_community_prefs() canonicalises preference arrays,
--     log_profile_lifecycle() logs profile_updated.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_member_profile(
  p_user_id  UUID,
  p_admin_id UUID,
  p_profile  JSONB DEFAULT '{}'::jsonb,
  p_prefs    JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_profile_cols CONSTANT TEXT[] := ARRAY[
    'profile_for', 'gender', 'date_of_birth', 'height_cm', 'religion', 'mother_tongue',
    'marital_status', 'education', 'education_details', 'occupation', 'company',
    'business_name', 'annual_income', 'city', 'state', 'country', 'native_place',
    'diet', 'smoking', 'drinking', 'gotra', 'about_me', 'hobbies',
    'father_occupation', 'mother_occupation', 'siblings', 'family_type',
    'family_location', 'family_details', 'community_id', 'sub_community_id'
  ];
  c_account_cols CONSTANT TEXT[] := ARRAY['full_name'];
  c_pref_cols CONSTANT TEXT[] := ARRAY[
    'preferred_gender', 'min_age', 'max_age', 'min_height_cm', 'max_height_cm',
    'preferred_cities', 'preferred_sub_communities', 'preferred_communities',
    'preferred_education', 'preferred_occupation', 'preferred_income',
    'preferred_diet', 'preferred_marital_status', 'preferred_native_place',
    'preferred_family_type', 'note'
  ];
  v_profile   JSONB := coalesce(p_profile, '{}'::jsonb);
  v_prefs     JSONB := coalesce(p_prefs, '{}'::jsonb);
  v_bad       TEXT[];
  v_old       public.matrimony_profiles%ROWTYPE;
  v_new       public.matrimony_profiles%ROWTYPE;
  v_old_pp    public.partner_preferences%ROWTYPE;
  v_new_pp    public.partner_preferences%ROWTYPE;
  v_name      TEXT;
  v_fields    TEXT[] := ARRAY[]::TEXT[];
  v_pref_flds TEXT[] := ARRAY[]::TEXT[];
  k           TEXT;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF jsonb_typeof(v_profile) <> 'object' OR jsonb_typeof(v_prefs) <> 'object' THEN
    RAISE EXCEPTION 'FIELD_NOT_EDITABLE: patches must be JSON objects';
  END IF;

  -- Allow-list: reject anything unexpected instead of silently dropping it.
  SELECT array_agg(key) INTO v_bad
  FROM jsonb_object_keys(v_profile) AS key
  WHERE NOT (key = ANY (c_profile_cols) OR key = ANY (c_account_cols));
  IF coalesce(array_length(v_bad, 1), 0) > 0 THEN
    RAISE EXCEPTION 'FIELD_NOT_EDITABLE: %', array_to_string(v_bad, ', ')
      USING HINT = 'Status, verification, privacy settings and identity fields have their own admin actions.';
  END IF;
  SELECT array_agg(key) INTO v_bad
  FROM jsonb_object_keys(v_prefs) AS key
  WHERE NOT key = ANY (c_pref_cols);
  IF coalesce(array_length(v_bad, 1), 0) > 0 THEN
    RAISE EXCEPTION 'FIELD_NOT_EDITABLE: partner preference %', array_to_string(v_bad, ', ');
  END IF;

  SELECT mp.* INTO v_old FROM public.matrimony_profiles mp WHERE mp.user_id = p_user_id FOR UPDATE;
  IF v_old.user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no matrimony profile for %', p_user_id;
  END IF;

  -- Account display name (public.profiles) — the only account field editable here.
  IF v_profile ? 'full_name' THEN
    v_name := nullif(btrim(coalesce(v_profile ->> 'full_name', '')), '');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'INVALID_VALUE: full_name cannot be empty';
    END IF;
    UPDATE public.profiles SET full_name = v_name, updated_at = now()
    WHERE id = p_user_id AND full_name IS DISTINCT FROM v_name;
    IF FOUND THEN v_fields := array_append(v_fields, 'full_name'); END IF;
    v_profile := v_profile - 'full_name';
  END IF;

  -- Matrimony profile: merge the patch over the current row (typed coercion
  -- of enums / dates / arrays happens here; an invalid enum value raises).
  IF v_profile <> '{}'::jsonb THEN
    v_new := jsonb_populate_record(v_old, v_profile);

    -- Blank text → NULL for the nullable free-text columns (the app never
    -- stores an empty string).
    v_new.education_details := nullif(btrim(coalesce(v_new.education_details, '')), '');
    v_new.company           := nullif(btrim(coalesce(v_new.company, '')), '');
    v_new.business_name     := nullif(btrim(coalesce(v_new.business_name, '')), '');
    v_new.annual_income     := nullif(btrim(coalesce(v_new.annual_income, '')), '');
    v_new.native_place      := nullif(btrim(coalesce(v_new.native_place, '')), '');
    v_new.gotra             := nullif(btrim(coalesce(v_new.gotra, '')), '');
    v_new.about_me          := nullif(btrim(coalesce(v_new.about_me, '')), '');
    v_new.father_occupation := nullif(btrim(coalesce(v_new.father_occupation, '')), '');
    v_new.mother_occupation := nullif(btrim(coalesce(v_new.mother_occupation, '')), '');
    v_new.siblings          := nullif(btrim(coalesce(v_new.siblings, '')), '');
    v_new.family_location   := nullif(btrim(coalesce(v_new.family_location, '')), '');
    v_new.family_details    := nullif(btrim(coalesce(v_new.family_details, '')), '');
    v_new.city              := nullif(btrim(coalesce(v_new.city, '')), '');
    v_new.education         := nullif(btrim(coalesce(v_new.education, '')), '');
    v_new.occupation        := nullif(btrim(coalesce(v_new.occupation, '')), '');
    v_new.state             := coalesce(nullif(btrim(coalesce(v_new.state, '')), ''), v_old.state);
    v_new.country           := coalesce(nullif(btrim(coalesce(v_new.country, '')), ''), v_old.country);
    v_new.mother_tongue     := coalesce(nullif(btrim(coalesce(v_new.mother_tongue, '')), ''), v_old.mother_tongue);
    v_new.religion          := coalesce(nullif(btrim(coalesce(v_new.religion, '')), ''), v_old.religion);
    v_new.hobbies           := coalesce(v_new.hobbies, '{}');

    FOR k IN SELECT jsonb_object_keys(v_profile) LOOP
      v_fields := array_append(v_fields, k);
    END LOOP;

    -- Only the allow-listed columns are written; status / verified_at /
    -- privacy / admin columns come from v_old untouched.
    UPDATE public.matrimony_profiles mp SET
      profile_for       = v_new.profile_for,
      gender            = v_new.gender,
      date_of_birth     = v_new.date_of_birth,
      height_cm         = v_new.height_cm,
      religion          = v_new.religion,
      mother_tongue     = v_new.mother_tongue,
      marital_status    = v_new.marital_status,
      education         = v_new.education,
      education_details = v_new.education_details,
      occupation        = v_new.occupation,
      company           = v_new.company,
      business_name     = v_new.business_name,
      annual_income     = v_new.annual_income,
      city              = v_new.city,
      state             = v_new.state,
      country           = v_new.country,
      native_place      = v_new.native_place,
      diet              = v_new.diet,
      smoking           = v_new.smoking,
      drinking          = v_new.drinking,
      gotra             = v_new.gotra,
      about_me          = v_new.about_me,
      hobbies           = v_new.hobbies,
      father_occupation = v_new.father_occupation,
      mother_occupation = v_new.mother_occupation,
      siblings          = v_new.siblings,
      family_type       = v_new.family_type,
      family_location   = v_new.family_location,
      family_details    = v_new.family_details,
      community_id      = v_new.community_id,
      sub_community_id  = v_new.sub_community_id,
      -- legacy text is re-derived by enforce_community_hierarchy(); clear it
      -- when the hierarchy link is removed so no stale text survives.
      sub_community     = CASE WHEN v_new.sub_community_id IS NULL THEN NULL ELSE mp.sub_community END,
      updated_at        = now()
    WHERE mp.user_id = p_user_id;
  END IF;

  -- Partner preferences (row may not exist for very old accounts).
  IF v_prefs <> '{}'::jsonb THEN
    SELECT pp.* INTO v_old_pp FROM public.partner_preferences pp WHERE pp.profile_id = p_user_id FOR UPDATE;
    IF v_old_pp.profile_id IS NULL THEN
      INSERT INTO public.partner_preferences (profile_id) VALUES (p_user_id)
      ON CONFLICT (profile_id) DO NOTHING;
      SELECT pp.* INTO v_old_pp FROM public.partner_preferences pp WHERE pp.profile_id = p_user_id FOR UPDATE;
    END IF;
    v_new_pp := jsonb_populate_record(v_old_pp, v_prefs);
    v_new_pp.preferred_cities          := coalesce(v_new_pp.preferred_cities, '{}');
    v_new_pp.preferred_sub_communities := coalesce(v_new_pp.preferred_sub_communities, '{}');
    v_new_pp.preferred_communities     := coalesce(v_new_pp.preferred_communities, '{}');
    v_new_pp.preferred_education       := nullif(btrim(coalesce(v_new_pp.preferred_education, '')), '');
    v_new_pp.preferred_occupation      := nullif(btrim(coalesce(v_new_pp.preferred_occupation, '')), '');
    v_new_pp.preferred_income          := nullif(btrim(coalesce(v_new_pp.preferred_income, '')), '');
    v_new_pp.preferred_native_place    := nullif(btrim(coalesce(v_new_pp.preferred_native_place, '')), '');
    v_new_pp.note                      := nullif(btrim(coalesce(v_new_pp.note, '')), '');

    FOR k IN SELECT jsonb_object_keys(v_prefs) LOOP
      v_pref_flds := array_append(v_pref_flds, k);
    END LOOP;

    UPDATE public.partner_preferences pp SET
      preferred_gender          = v_new_pp.preferred_gender,
      min_age                   = v_new_pp.min_age,
      max_age                   = v_new_pp.max_age,
      min_height_cm             = v_new_pp.min_height_cm,
      max_height_cm             = v_new_pp.max_height_cm,
      preferred_cities          = v_new_pp.preferred_cities,
      preferred_sub_communities = v_new_pp.preferred_sub_communities,
      preferred_communities     = v_new_pp.preferred_communities,
      preferred_education       = v_new_pp.preferred_education,
      preferred_occupation      = v_new_pp.preferred_occupation,
      preferred_income          = v_new_pp.preferred_income,
      preferred_diet            = v_new_pp.preferred_diet,
      preferred_marital_status  = v_new_pp.preferred_marital_status,
      preferred_native_place    = v_new_pp.preferred_native_place,
      preferred_family_type     = v_new_pp.preferred_family_type,
      note                      = v_new_pp.note,
      updated_at                = now()
    WHERE pp.profile_id = p_user_id;
  END IF;

  IF coalesce(array_length(v_fields, 1), 0) = 0 AND coalesce(array_length(v_pref_flds, 1), 0) = 0 THEN
    RETURN jsonb_build_object('changed', FALSE, 'fields', '[]'::jsonb, 'preference_fields', '[]'::jsonb);
  END IF;

  -- Field NAMES only — never values — in the activity stream.
  PERFORM public.log_activity(
    p_user_id, 'admin_member_edited',
    jsonb_build_object('fields', to_jsonb(v_fields), 'preference_fields', to_jsonb(v_pref_flds))
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_edited', 'profile', p_user_id::text,
          jsonb_build_object('fields', to_jsonb(v_fields), 'preference_fields', to_jsonb(v_pref_flds)));

  RETURN jsonb_build_object('changed', TRUE, 'fields', to_jsonb(v_fields), 'preference_fields', to_jsonb(v_pref_flds));
END;
$$;

COMMENT ON FUNCTION public.admin_update_member_profile(uuid, uuid, jsonb, jsonb) IS
  'Admin edit with a strict allow-list (profile fields incl. community_id / sub_community_id / company / business_name / lifestyle / family, partner preferences, and the account full_name). Unknown keys — status, verified_at, privacy_settings, admin/suspension columns, contact fields — raise FIELD_NOT_EDITABLE. Existing triggers enforce the community hierarchy and canonicalise preferences. Logs field names only. Service role only.';

REVOKE ALL ON FUNCTION public.admin_update_member_profile(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_member_profile(uuid, uuid, jsonb, jsonb) TO service_role;


-- ----------------------------------------------------------------------------
-- §6k admin_prepare_member_deletion(p_user_id, p_admin_id, p_confirm_email, p_reason)
--     Runs BEFORE the server action removes the auth user (which cascades
--     every row and SET NULLs the audit / activity references):
--       * self-protection: an admin can never delete their own account;
--       * other admins are protected until their is_admin flag is removed
--         in the database (no accidental loss of admin access);
--       * deliberate confirmation: the caller must supply the member's exact
--         email address — a one-click / hidden-field submit cannot pass;
--       * writes the account_deleted activity event (mirrors self-delete) and
--         the admin_audit_log row with a minimal, non-contact record (name,
--         masked email, footprint counts, reason).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_prepare_member_deletion(
  p_user_id       UUID,
  p_admin_id      UUID,
  p_confirm_email TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p         public.profiles%ROWTYPE;
  v_reason    TEXT := nullif(btrim(coalesce(p_reason, '')), '');
  v_masked    TEXT;
  v_footprint JSONB;
BEGIN
  PERFORM public.admin_assert_actor(p_admin_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: member id required';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'ADMIN_SELF_DELETE: you cannot delete your own admin account';
  END IF;

  SELECT p.* INTO v_p FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: no member with id %', p_user_id;
  END IF;
  IF v_p.is_admin THEN
    RAISE EXCEPTION 'ADMIN_TARGET_PROTECTED: this account is an administrator — remove its admin rights in the database before deleting it';
  END IF;
  IF lower(btrim(coalesce(p_confirm_email, ''))) <> lower(v_p.email) THEN
    RAISE EXCEPTION 'DELETE_CONFIRMATION_MISMATCH: type the member''s email address exactly to confirm deletion';
  END IF;

  v_masked := left(v_p.email, 1) || '***' || substring(v_p.email FROM position('@' IN v_p.email));

  SELECT jsonb_build_object(
    'subscriptions',         (SELECT count(*) FROM public.subscriptions s WHERE s.user_id = p_user_id),
    'payments',              (SELECT count(*) FROM public.payments x WHERE x.user_id = p_user_id),
    'interests',             (SELECT count(*) FROM public.interests i WHERE i.sender_id = p_user_id OR i.receiver_id = p_user_id),
    'messages',              (SELECT count(*) FROM public.messages m WHERE m.sender_id = p_user_id),
    'conversations',         (SELECT count(*) FROM public.conversation_members cm WHERE cm.user_id = p_user_id),
    'photos',                (SELECT count(*) FROM public.profile_photos ph WHERE ph.profile_id = p_user_id),
    'moments',               (SELECT count(*) FROM public.moments mo WHERE mo.user_id = p_user_id),
    'notifications',         (SELECT count(*) FROM public.notifications n WHERE n.user_id = p_user_id),
    'verification_requests', (SELECT count(*) FROM public.verification_requests v WHERE v.user_id = p_user_id),
    'boosts',                (SELECT count(*) FROM public.profile_boosts b WHERE b.user_id = p_user_id),
    'boost_entitlements',    (SELECT count(*) FROM public.profile_boost_entitlements e WHERE e.user_id = p_user_id),
    'activity_events',       (SELECT count(*) FROM public.activity_events a WHERE a.user_id = p_user_id),
    'reports_filed',         (SELECT count(*) FROM public.reports r WHERE r.reporter_id = p_user_id),
    'reports_received',      (SELECT count(*) FROM public.reports r WHERE r.reported_id = p_user_id),
    'blocks',                (SELECT count(*) FROM public.blocks bl WHERE bl.blocker_id = p_user_id OR bl.blocked_id = p_user_id),
    'featured',              EXISTS (SELECT 1 FROM public.featured_profiles f WHERE f.profile_id = p_user_id)
  ) INTO v_footprint;

  -- Same event the self-serve flow records (idempotent per user); the row
  -- survives the cascade through ON DELETE SET NULL.
  PERFORM public.log_activity(
    p_user_id, 'account_deleted',
    jsonb_build_object('initiated_by', 'admin'),
    'acctdel:' || p_user_id::text
  );
  PERFORM public.log_activity(
    p_user_id, 'admin_member_deleted',
    jsonb_build_object('footprint', v_footprint),
    'admindel:' || p_user_id::text
  );
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (p_admin_id, 'admin_member_deleted', 'profile', p_user_id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'name', v_p.full_name,
            'email_masked', v_masked,
            'member_since', v_p.created_at,
            'footprint', v_footprint,
            'reason', v_reason)));

  RETURN jsonb_build_object('ok', TRUE, 'email_masked', v_masked, 'footprint', v_footprint);
END;
$$;

COMMENT ON FUNCTION public.admin_prepare_member_deletion(uuid, uuid, text, text) IS
  'Guards + records an admin account deletion BEFORE the auth user is removed: refuses self-deletion, refuses other admins (ADMIN_TARGET_PROTECTED), requires the member''s exact email as typed confirmation (DELETE_CONFIRMATION_MISMATCH), logs account_deleted + admin_member_deleted and an admin_audit_log row with name, masked email, footprint counts and the reason. Service role only.';

REVOKE ALL ON FUNCTION public.admin_prepare_member_deletion(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prepare_member_deletion(uuid, uuid, text, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §6l admin_list_members(...) — server-side search, filters, paging
--     One query; never ships the member table to the browser. Contact data
--     (email / mobile) is included because the caller is the admin panel's
--     service-role client — the function is not executable by members.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_members(
  p_q        TEXT    DEFAULT NULL,
  p_status   TEXT    DEFAULT NULL,   -- profile_status value | 'admin_hidden' | 'public' | NULL
  p_paid     TEXT    DEFAULT NULL,   -- 'paid' | 'free' | 'expired' | NULL
  p_verified TEXT    DEFAULT NULL,   -- 'verified' | 'unverified' | NULL
  p_featured TEXT    DEFAULT NULL,   -- 'featured' | 'not_featured' | NULL
  p_city     TEXT    DEFAULT NULL,
  p_package  TEXT    DEFAULT NULL,   -- package slug of the LIVE plan
  p_limit    INTEGER DEFAULT 50,
  p_offset   INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q      TEXT := nullif(btrim(coalesce(p_q, '')), '');
  v_like   TEXT;
  v_uuid   UUID;
  v_digits TEXT;
  v_limit  INTEGER := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset INTEGER := greatest(coalesce(p_offset, 0), 0);
  v_status public.profile_status;
  v_rows   JSONB;
  v_total  INTEGER;
BEGIN
  IF auth.role() = 'anon' OR (auth.uid() IS NOT NULL AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'ADMIN_ONLY: this action is restricted to administrators';
  END IF;

  IF v_q IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    IF v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uuid := v_q::uuid;
    END IF;
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('admin_hidden', 'public', '') THEN
    BEGIN
      v_status := p_status::public.profile_status;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'INVALID_FILTER: unknown profile status %', p_status;
    END;
  END IF;

  WITH base AS (
    SELECT
      p.id, p.full_name, p.email, p.mobile, p.is_admin, p.is_active, p.mobile_verified, p.created_at, p.last_login_at,
      mp.status, mp.gender, mp.city, mp.verified_at, mp.admin_hidden_at, mp.suspended_at,
      mp.date_of_birth,
      sub.package_slug, sub.expires_at,
      (sub.package_slug IS NOT NULL) AS is_paid,
      EXISTS (SELECT 1 FROM public.subscriptions s2 WHERE s2.user_id = p.id) AS ever_subscribed,
      EXISTS (SELECT 1 FROM public.featured_profiles f WHERE f.profile_id = p.id) AS featured,
      EXISTS (SELECT 1 FROM public.profile_boosts b WHERE b.user_id = p.id AND b.status = 'active' AND b.expires_at > now()) AS boosted,
      EXISTS (SELECT 1 FROM public.profile_photos ph WHERE ph.profile_id = p.id AND ph.kind = 'profile_photo') AS has_photo
    FROM public.profiles p
    LEFT JOIN public.matrimony_profiles mp ON mp.user_id = p.id
    LEFT JOIN LATERAL (
      SELECT s.package_slug, s.expires_at
      FROM public.subscriptions s
      WHERE s.user_id = p.id AND s.status = 'active' AND s.expires_at > now()
      ORDER BY s.expires_at DESC
      LIMIT 1
    ) sub ON TRUE
    WHERE
      (v_q IS NULL
        OR p.id = v_uuid
        OR p.full_name ILIKE v_like ESCAPE '\'
        OR p.email ILIKE v_like ESCAPE '\'
        OR (v_digits <> '' AND p.mobile IS NOT NULL AND replace(p.mobile, ' ', '') LIKE '%' || v_digits || '%'))
      AND (v_status IS NULL OR mp.status = v_status)
      AND (p_status IS DISTINCT FROM 'admin_hidden' OR mp.admin_hidden_at IS NOT NULL)
      AND (p_status IS DISTINCT FROM 'public' OR public.is_profile_public(p.id))
      AND (nullif(p_paid, '') IS NULL
        OR (p_paid = 'paid' AND sub.package_slug IS NOT NULL)
        OR (p_paid = 'free' AND sub.package_slug IS NULL AND NOT EXISTS (SELECT 1 FROM public.subscriptions s3 WHERE s3.user_id = p.id))
        OR (p_paid = 'expired' AND sub.package_slug IS NULL AND EXISTS (SELECT 1 FROM public.subscriptions s3 WHERE s3.user_id = p.id)))
      AND (nullif(p_verified, '') IS NULL
        OR (p_verified = 'verified' AND mp.verified_at IS NOT NULL)
        OR (p_verified = 'unverified' AND mp.verified_at IS NULL))
      AND (nullif(p_featured, '') IS NULL
        OR (p_featured = 'featured' AND EXISTS (SELECT 1 FROM public.featured_profiles f2 WHERE f2.profile_id = p.id))
        OR (p_featured = 'not_featured' AND NOT EXISTS (SELECT 1 FROM public.featured_profiles f2 WHERE f2.profile_id = p.id)))
      AND (nullif(btrim(coalesce(p_city, '')), '') IS NULL OR lower(btrim(coalesce(mp.city, ''))) = lower(btrim(p_city)))
      AND (nullif(p_package, '') IS NULL OR sub.package_slug = p_package)
  ),
  counted AS (SELECT count(*)::int AS n FROM base),
  page AS (
    SELECT * FROM base
    ORDER BY created_at DESC, id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    (SELECT n FROM counted),
    coalesce((SELECT jsonb_agg((to_jsonb(page) - 'date_of_birth') || jsonb_build_object(
        'age', CASE WHEN page.date_of_birth IS NULL THEN NULL
                    ELSE floor(date_part('year', age(page.date_of_birth)))::int END
      ) ORDER BY page.created_at DESC, page.id) FROM page), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_members(text, text, text, text, text, text, text, integer, integer) IS
  'Admin members list: one server-side query with search (name / email / mobile / UUID), profile-status, paid/free/expired, verified, featured, city and live-package filters, plus paging ({ total, limit, offset, rows[] }). Service role only — it returns contact columns for the admin panel.';

REVOKE ALL ON FUNCTION public.admin_list_members(text, text, text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_members(text, text, text, text, text, text, text, integer, integer) TO service_role;
