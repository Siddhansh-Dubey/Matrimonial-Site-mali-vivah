-- ============================================================================
-- Mali Vivah · Phase 1 — safety: Report / Block, server-side interests,
-- account deletion, profile-view gating
-- Migration 7 of the Phase 1 completion pass.
--
-- WHAT THIS FIXES / ADDS
--   §1 blocks + reports tables (PRD Report/Block). Enforced in the read path
--      (search/detail) and the write path (interests), not just in the UI.
--   §2 is_blocked(a,b) helper (SECURITY DEFINER; never touches the caller's
--      RLS view of blocks).
--   §3 express_interest() — Express Interest moves server-side:
--        * paid members only (benefit express_interest) — free members get a
--          PAID_MEMBERSHIP_REQUIRED error carrying the locked PRD copy
--        * target must be publicly listed (is_profile_public)
--        * blocked pairs (either direction) are refused
--        * monthly interest limits from the package benefits are enforced
--          (Smart 25 / Premium 60 / VIP unlimited)
--        * mutual convergence (both rows → accepted) happens atomically here
--      The old client-direct INSERT policy is dropped — interest creation now
--      flows only through this RPC.
--   §4 Interest UPDATE policies rebuilt: a receiver may accept/decline, a
--      sender may withdraw. BEFORE, any party could update ANY field — the
--      sender could flip their own row to 'accepted' and fabricate a "mutual
--      match" to unlock the phone number. That hole is closed.
--   §5 search_matches() / get_public_profile() now exclude blocked pairs.
--   §6 profile_views gate: views accumulate only on publicly-listed
--      (ACTIVE_PAID) profiles, never on drafts/hidden/free rows, and never
--      for self-views. Anonymous viewers do not write rows.
--   §7 account_deletion_requests + request_account_deletion(): the member's
--      profile is hidden immediately; an admin completes the deletion.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260915100000/20260915110000.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 blocks + reports
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocks (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  blocker_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocks_unique_pair UNIQUE (blocker_id, blocked_id)
);

COMMENT ON TABLE public.blocks IS
  'Member-to-member blocks. Invisible to the blocked member (only the blocker can read rows), but enforced everywhere server-side: search, profile pages, interests.';

CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON public.blocks (blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;

DROP POLICY IF EXISTS "Blocker manages own blocks" ON public.blocks;
CREATE POLICY "Blocker manages own blocks"
  ON public.blocks FOR ALL TO authenticated
  USING (blocker_id = auth.uid())
  WITH CHECK (blocker_id = auth.uid());


CREATE TABLE IF NOT EXISTS public.reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reason      public.report_reason NOT NULL DEFAULT 'other',
  details     TEXT,
  status      public.report_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reports_no_self CHECK (reporter_id <> reported_id)
);

COMMENT ON TABLE public.reports IS
  'Member reports against profiles. The reporter sees their own submissions; review happens in the admin panel via the service role. The reported member is never told who reported them.';

CREATE INDEX IF NOT EXISTS reports_reported_idx ON public.reports (reported_id, status);
CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status, created_at DESC);

DROP TRIGGER IF EXISTS set_reports_updated_at ON public.reports;
CREATE TRIGGER set_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.reports TO authenticated;

DROP POLICY IF EXISTS "Reporter reads own reports" ON public.reports;
CREATE POLICY "Reporter reads own reports"
  ON public.reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Member files a report" ON public.reports;
CREATE POLICY "Member files a report"
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());


-- ----------------------------------------------------------------------------
-- §2 is_blocked(a, b) — TRUE when a block exists in EITHER direction
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_blocked(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = p_a AND b.blocked_id = p_b)
         OR (b.blocker_id = p_b AND b.blocked_id = p_a)
    )
  END;
$$;

COMMENT ON FUNCTION public.is_blocked(uuid, uuid) IS
  'TRUE when either member has blocked the other. SECURITY DEFINER so the browse RPCs can check pairs involving the caller even though the caller may not read the blocks table row (they only see rows they created).';

REVOKE ALL ON FUNCTION public.is_blocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §3 express_interest() — the ONLY way an interest is created
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.express_interest(
  p_target_id UUID,
  p_message   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender  UUID := auth.uid();
  v_limit   NUMERIC;
  v_sent    INTEGER;
  v_reverse RECORD;
  v_existing RECORD;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'express_interest: not authenticated';
  END IF;
  IF p_target_id IS NULL OR p_target_id = v_sender THEN
    RAISE EXCEPTION 'express_interest: invalid target';
  END IF;

  -- Paid members only. Locked PRD copy — the app surfaces it verbatim.
  IF NOT public.has_benefit('express_interest', v_sender) THEN
    RAISE EXCEPTION 'PAID_MEMBERSHIP_REQUIRED: Become a Paid Member to showcase your profile and express interest.';
  END IF;

  -- Target must actually be discoverable.
  IF NOT public.is_profile_public(p_target_id) THEN
    RAISE EXCEPTION 'TARGET_UNAVAILABLE';
  END IF;

  -- Blocks cut interactions in both directions.
  IF public.is_blocked(v_sender, p_target_id) THEN
    RAISE EXCEPTION 'TARGET_UNAVAILABLE';
  END IF;

  -- Monthly limit from the package benefits (NULL = unlimited, e.g. VIP).
  v_limit := (public.get_membership(v_sender) -> 'benefits' ->> 'interest_limit_per_month')::numeric;
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_sent
    FROM public.interests i
    WHERE i.sender_id = v_sender
      AND i.created_at > now() - interval '30 days';
    IF v_sent >= v_limit THEN
      RAISE EXCEPTION 'INTEREST_LIMIT_REACHED: your current plan allows % interests per month', floor(v_limit);
    END IF;
  END IF;

  -- Existing row in our direction? Refresh it instead of duplicating.
  SELECT i.id, i.status INTO v_existing
  FROM public.interests i
  WHERE i.sender_id = v_sender AND i.receiver_id = p_target_id;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status IN ('pending', 'accepted') THEN
      RETURN jsonb_build_object('status', CASE v_existing.status WHEN 'accepted' THEN 'mutual' ELSE 'sent' END);
    END IF;
    -- declined / withdrawn → re-express as a fresh pending interest
    UPDATE public.interests
    SET status = 'pending',
        message = nullif(btrim(coalesce(p_message, '')), ''),
        created_at = now(),
        updated_at = now()
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.interests (sender_id, receiver_id, status, message)
    VALUES (v_sender, p_target_id, 'pending', nullif(btrim(coalesce(p_message, '')), ''));
  END IF;

  -- Mutual convergence: if they already expressed interest in us, both rows
  -- become accepted — this is the explicit match that unlocks contact.
  SELECT i.id, i.status INTO v_reverse
  FROM public.interests i
  WHERE i.sender_id = p_target_id AND i.receiver_id = v_sender;

  IF v_reverse.id IS NOT NULL AND v_reverse.status IN ('pending', 'accepted') THEN
    UPDATE public.interests
    SET status = 'accepted', updated_at = now()
    WHERE (sender_id = v_sender AND receiver_id = p_target_id)
       OR (sender_id = p_target_id AND receiver_id = v_sender);
    PERFORM public.log_activity(v_sender, 'interest_mutual', jsonb_build_object('with', p_target_id));
    RETURN jsonb_build_object('status', 'mutual');
  END IF;

  PERFORM public.log_activity(v_sender, 'interest_sent', jsonb_build_object('to', p_target_id));
  RETURN jsonb_build_object('status', 'sent');
END;
$$;

COMMENT ON FUNCTION public.express_interest(uuid, text) IS
  'The only interest-creation path. Enforces: paid membership (locked PRD copy on refusal), target publicly listed, no blocks either way, monthly plan limit. Converges mutual interest atomically.';

REVOKE ALL ON FUNCTION public.express_interest(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.express_interest(uuid, text) TO authenticated;


-- The browser no longer creates interest rows directly.
DROP POLICY IF EXISTS "Sender creates interest" ON public.interests;
REVOKE INSERT ON public.interests FROM authenticated;


-- ----------------------------------------------------------------------------
-- §4 Interest UPDATE policies — who may do what, precisely
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Parties update interest" ON public.interests;

-- Receiver responds: pending → accepted / declined.
DROP POLICY IF EXISTS "Receiver responds to interest" ON public.interests;
CREATE POLICY "Receiver responds to interest"
  ON public.interests FOR UPDATE TO authenticated
  USING (receiver_id = auth.uid())
  WITH CHECK (receiver_id = auth.uid() AND status IN ('accepted', 'declined'));

-- Sender withdraws their own interest.
DROP POLICY IF EXISTS "Sender withdraws interest" ON public.interests;
CREATE POLICY "Sender withdraws interest"
  ON public.interests FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() AND status = 'withdrawn');


-- ----------------------------------------------------------------------------
-- §5 Block filtering in the read path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_matches(
  p_looking_for   public.gender DEFAULT NULL,
  p_min_age       INTEGER DEFAULT NULL,
  p_max_age       INTEGER DEFAULT NULL,
  p_city          TEXT DEFAULT NULL,
  p_sub_community TEXT DEFAULT NULL,
  p_limit         INTEGER DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_limit INTEGER := CASE
    WHEN auth.uid() IS NULL THEN least(greatest(coalesce(p_limit, 5), 1), 5)
    ELSE least(greatest(coalesce(p_limit, 60), 1), 200)
  END;
  v_is_paid BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
BEGIN
  SELECT jsonb_agg(card ORDER BY sort_at DESC)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'user_id', mp.user_id,
        'name', CASE
          WHEN char_length(btrim(p.full_name)) > 1
            THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
          ELSE 'Member'
        END,
        'name_full', CASE WHEN v_is_paid THEN p.full_name ELSE NULL END,
        'age', CASE WHEN v_is_paid THEN floor(date_part('year', age(mp.date_of_birth)))::int ELSE NULL END,
        'gender', mp.gender,
        'height_cm', CASE WHEN v_is_paid THEN mp.height_cm ELSE NULL END,
        'sub_community', CASE WHEN v_is_paid THEN mp.sub_community ELSE NULL END,
        'marital_status', CASE WHEN v_is_paid THEN mp.marital_status ELSE NULL END,
        'education', CASE WHEN v_is_paid THEN mp.education ELSE NULL END,
        'occupation', mp.occupation,
        'city', CASE WHEN v_is_paid THEN mp.city ELSE NULL END,
        'state', CASE WHEN v_is_paid THEN mp.state ELSE NULL END,
        'diet', CASE WHEN v_is_paid THEN mp.diet ELSE NULL END,
        'photo', pp.storage_path,
        'has_photo', (pp.storage_path IS NOT NULL),
        'viewer_is_paid', v_is_paid
      ) AS card,
      mp.updated_at AS sort_at
    FROM public.matrimony_profiles mp
    JOIN public.profiles p ON p.id = mp.user_id
    LEFT JOIN LATERAL (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id
        AND ph.kind = 'profile_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ) pp ON TRUE
    WHERE public.is_profile_public(mp.user_id)
      AND NOT public.is_blocked(auth.uid(), mp.user_id)
      AND mp.gender = coalesce(p_looking_for, mp.gender)
      AND (p_min_age IS NULL OR date_part('year', age(mp.date_of_birth)) >= p_min_age)
      AND (p_max_age IS NULL OR date_part('year', age(mp.date_of_birth)) <= p_max_age)
      AND (p_city IS NULL OR lower(mp.city) = lower(btrim(p_city)))
      AND (p_sub_community IS NULL OR lower(mp.sub_community) = lower(btrim(p_sub_community)))
    ORDER BY mp.updated_at DESC
    LIMIT v_limit
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_is_paid BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
  v_mutual BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.mutual_interest_exists(auth.uid(), p_user_id)
  END;
BEGIN
  SELECT jsonb_build_object(
    'id', mp.user_id,
    'name', CASE
      WHEN char_length(btrim(p.full_name)) > 1
        THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
      ELSE 'Member'
    END,
    'name_full', CASE WHEN v_is_paid THEN p.full_name ELSE NULL END,
    'gender', mp.gender,
    'age', CASE WHEN v_is_paid THEN floor(date_part('year', age(mp.date_of_birth)))::int ELSE NULL END,
    'height_cm', CASE WHEN v_is_paid THEN mp.height_cm ELSE NULL END,
    'religion', CASE WHEN v_is_paid THEN mp.religion ELSE NULL END,
    'sub_community', CASE WHEN v_is_paid THEN mp.sub_community ELSE NULL END,
    'mother_tongue', CASE WHEN v_is_paid THEN mp.mother_tongue ELSE NULL END,
    'marital_status', CASE WHEN v_is_paid THEN mp.marital_status ELSE NULL END,
    'education', CASE WHEN v_is_paid THEN mp.education ELSE NULL END,
    'education_details', CASE WHEN v_is_paid THEN mp.education_details ELSE NULL END,
    'occupation', mp.occupation,
    'annual_income', CASE WHEN v_is_paid THEN mp.annual_income ELSE NULL END,
    'city', CASE WHEN v_is_paid THEN mp.city ELSE NULL END,
    'state', CASE WHEN v_is_paid THEN mp.state ELSE NULL END,
    'country', CASE WHEN v_is_paid THEN mp.country ELSE NULL END,
    'diet', CASE WHEN v_is_paid THEN mp.diet ELSE NULL END,
    'gotra', CASE WHEN v_is_paid THEN mp.gotra ELSE NULL END,
    'about_me', CASE WHEN v_is_paid THEN mp.about_me ELSE NULL END,
    'hobbies', CASE WHEN v_is_paid THEN mp.hobbies ELSE '{}'::text[] END,
    'photos', COALESCE(
      (SELECT jsonb_agg(ph.storage_path ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC)
       FROM public.profile_photos ph
       WHERE ph.profile_id = mp.user_id AND ph.kind = 'profile_photo'),
      '[]'::jsonb
    ),
    'family_photo', (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id AND ph.kind = 'family_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ),
    'viewer_is_paid', v_is_paid,
    'mutual_interest', v_mutual,
    'contact_phone', CASE WHEN (v_is_paid AND v_mutual) THEN p.mobile ELSE NULL END
  )
  INTO v_result
  FROM public.matrimony_profiles mp
  JOIN public.profiles p ON p.id = mp.user_id
  WHERE mp.user_id = p_user_id
    AND public.is_profile_public(p_user_id)
    AND NOT public.is_blocked(auth.uid(), p_user_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §6 profile_views gate — only publicly-listed profiles accumulate views
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_view()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip self-views and views of non-public profiles (draft/hidden/free.
  -- Only ACTIVE_PAID profiles accumulate views, per PRD.)
  IF NEW.viewer_id = NEW.viewed_id
     OR NOT public.is_profile_public(NEW.viewed_id)
     OR public.is_blocked(NEW.viewer_id, NEW.viewed_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_profile_view() IS
  'BEFORE INSERT trigger on profile_views: silently skips self-views, views of non-public profiles and blocked pairs — returning NULL aborts the insert without an error.';

DROP TRIGGER IF EXISTS profile_views_guard ON public.profile_views;
CREATE TRIGGER profile_views_guard
  BEFORE INSERT ON public.profile_views
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_view();


-- ----------------------------------------------------------------------------
-- §7 Account deletion requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.account_deletion_requests IS
  'Member-initiated account deletion. Requesting hides the matrimony profile immediately; an admin completes processing (anonymisation + auth removal) from the admin panel.';

-- At most one pending request per member.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_one_pending_idx
  ON public.account_deletion_requests (user_id)
  WHERE status = 'pending';

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.account_deletion_requests TO authenticated;

DROP POLICY IF EXISTS "Owner reads own deletion requests" ON public.account_deletion_requests;
CREATE POLICY "Owner reads own deletion requests"
  ON public.account_deletion_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'request_account_deletion: not authenticated';
  END IF;

  INSERT INTO public.account_deletion_requests (user_id, reason)
  VALUES (v_user, nullif(btrim(coalesce(p_reason, '')), ''))
  ON CONFLICT DO NOTHING;

  -- Hide the profile immediately while the request is pending.
  UPDATE public.matrimony_profiles
  SET status = 'hidden', updated_at = now()
  WHERE user_id = v_user AND status = 'active';

  PERFORM public.log_activity(v_user, 'account_deletion_requested', '{}'::jsonb);

  RETURN jsonb_build_object('status', 'pending');
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion(text) IS
  'Files a deletion request for the signed-in member (idempotent while pending) and hides their profile immediately. An admin completes processing via the service role.';

REVOKE ALL ON FUNCTION public.request_account_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated;
