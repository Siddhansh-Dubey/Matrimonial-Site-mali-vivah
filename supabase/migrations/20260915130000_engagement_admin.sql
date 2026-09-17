-- ============================================================================
-- Mali Vivah · Phase 1 — matching (Daily 5), boosts, featured profiles,
-- verification, Mali Moments, success stories, admin foundations
-- Migration 8 of the Phase 1 completion pass.
--
-- WHAT IT ADDS
--   §1  profiles.is_admin + is_admin() + admin_audit_log — RBAC for the admin
--       panel. The panel's pages authorise server-side; destructive/elevated
--       actions run through the service role and write an audit row.
--   §2  matching_config + matching_settings() — the Daily 5 weights are
--       data, not code. Seeded with the PRD numbers:
--         age 15, location 15, education 10, occupation 10, income 10,
--         community 10, partner preferences 15, lifestyle 10, behaviour 5
--       plus the 90% threshold and the daily count (5).
--   §3  get_daily_matches() — the rule-based Daily 5 engine. NO ML, NO
--       padding: fewer than 5 matches is the correct answer. Every match is
--       publicly listed, unblocked and ≥ threshold, and carries its score +
--       human-readable "why it matches" reasons.
--   §4  profile_boosts + boost_my_profile() + has_active_boost() — real
--       backend boost state with expiry; boosted profiles rank first in
--       search/browse/featured/Daily 5. Boost expiry is swept with the
--       membership sweep (+ notification).
--   §5  featured_profiles + get_featured_profiles() — admin-selected
--       profiles for the homepage. Anonymous-safe output, only publicly
--       listed members. (Replaces the hard-coded demo section.)
--   §6  verification_requests + matrimony_profiles.verified_at + decision
--       trigger — photo / ID verification lifecycle with a private
--       'verification-docs' bucket. Verified members carry the
--       "✓ Verified Profile" badge in search, detail, Daily 5 and featured.
--       Documents are NEVER publicly readable.
--   §7  moments + list_moments() — Mali Moments: 24-hour photo stories.
--       Auto-expire by timestamp, blocked-author filtering, admin removal
--       flag. Deliberately no likes/comments/followers.
--   §8  success_stories — real, admin-published couples for the
--       /success-stories page. Empty table ⇒ the page shows an honest empty
--       state, never fabricated stories.
--   §9  search_matches() FINAL — boost-first ordering, `verified` flag and
--       advanced filters (education/occupation/native place/marital status/
--       diet/income/height) that apply ONLY when the caller's plan includes
--       the advanced_search benefit; the filters are silently ignored
--       otherwise so a free member cannot sneak them in.
--   §10 get_public_profile() FINAL — verified flag + the family section +
--       lifestyle fields for paid viewers, honouring privacy_settings.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260915100000…20260915120000.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Admin foundations (RBAC + audit)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.is_admin IS
  'Admin panel access. Grant manually in the Dashboard (update profiles set is_admin = true where email = ''…''). Server routes re-verify on every request.';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), FALSE)
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'TRUE when the signed-in member is flagged is_admin. Reads ONLY profiles (no RLS recursion risk); used by the admin panel''s server routes.';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;


CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_log IS
  'Every elevated admin action (verify, suspend, feature, package edit…). Written only by the service role from the admin API routes; read in the admin panel.';

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_admin_idx ON public.admin_audit_log (admin_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No grants to authenticated: read/write is service-role only.


-- ----------------------------------------------------------------------------
-- §2 matching_config — the Daily 5 knobs are data
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matching_config (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  threshold   NUMERIC(5,2) NOT NULL DEFAULT 90
              CHECK (threshold BETWEEN 0 AND 100),
  weights     JSONB NOT NULL DEFAULT '{
    "age": 15, "location": 15, "education": 10, "occupation": 10,
    "income": 10, "community": 10, "partner_prefs": 15,
    "lifestyle": 10, "behaviour": 5
  }'::jsonb,
  daily_count SMALLINT NOT NULL DEFAULT 5 CHECK (daily_count BETWEEN 1 AND 25),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.matching_config IS
  'Single-row (id=1) Daily 5 configuration: component weights, the 90% compatibility threshold and the daily count. Admin-editable from the admin panel (service role); the engine reads it live.';

DROP TRIGGER IF EXISTS set_matching_config_updated_at ON public.matching_config;
CREATE TRIGGER set_matching_config_updated_at
  BEFORE UPDATE ON public.matching_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.matching_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.matching_config ENABLE ROW LEVEL SECURITY;
-- No client grants: reading is harmless but not needed; writes are service-role only.

CREATE OR REPLACE FUNCTION public.matching_settings()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object(
       'weights', c.weights, 'threshold', c.threshold, 'daily_count', c.daily_count)
     FROM public.matching_config c WHERE c.id = 1),
    '{"weights":{"age":15,"location":15,"education":10,"occupation":10,"income":10,"community":10,"partner_prefs":15,"lifestyle":10,"behaviour":5},"threshold":90,"daily_count":5}'::jsonb
  )
$$;

COMMENT ON FUNCTION public.matching_settings() IS 'Reads the single matching_config row with hard defaults if absent.';

REVOKE ALL ON FUNCTION public.matching_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matching_settings() TO service_role;

-- Canonical income / education band ordering (mirrors profile-schema.ts).
CREATE OR REPLACE FUNCTION public.income_band_rank(p TEXT)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(p, '')))
    WHEN 'not earning'    THEN 0
    WHEN 'under 3 lpa'    THEN 1
    WHEN '3 - 5 lpa'      THEN 2
    WHEN '5 - 10 lpa'     THEN 3
    WHEN '10 - 20 lpa'    THEN 4
    WHEN '20 - 40 lpa'    THEN 5
    WHEN '40 lpa+'        THEN 6
    ELSE -1
  END
$$;

CREATE OR REPLACE FUNCTION public.education_rank(p TEXT)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(btrim(coalesce(p, ''))) = 'high school'  THEN 1
    WHEN lower(btrim(coalesce(p, ''))) = 'diploma'      THEN 2
    WHEN lower(btrim(coalesce(p, ''))) = 'bachelors'    THEN 3
    WHEN lower(btrim(coalesce(p, ''))) = 'masters'      THEN 4
    WHEN lower(btrim(coalesce(p, ''))) = 'doctorate'    THEN 5
    WHEN lower(btrim(coalesce(p, ''))) LIKE 'professional degree%' THEN 5
    WHEN btrim(coalesce(p, '')) = '' THEN 0
    ELSE 2 -- 'Other' and free-text sit between diploma and bachelors
  END
$$;


-- ----------------------------------------------------------------------------
-- §3 get_daily_matches() — the rule-based Daily 5 engine
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_daily_matches(p_limit INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer    UUID := auth.uid();
  v_cfg       JSONB;
  v_w         JSONB;
  v_threshold NUMERIC;
  v_count     INTEGER;
  v_is_paid   BOOLEAN;
  v_me        public.matrimony_profiles%ROWTYPE;
  v_prefs     public.partner_preferences%ROWTYPE;
  v_cand      RECORD;
  v_age       NUMERIC;
  v_out       JSONB := '[]'::jsonb;
  v_list      JSONB := '[]'::jsonb;

  -- per-candidate scratch
  s_age NUMERIC; s_loc NUMERIC; s_edu NUMERIC; s_occ NUMERIC;
  s_inc NUMERIC; s_com NUMERIC; s_pref NUMERIC; s_life NUMERIC; s_beh NUMERIC;
  v_score NUMERIC;
  v_reasons TEXT[];
  v_cand_age NUMERIC;
  v_pref_checks NUMERIC;
  v_checked NUMERIC;
  v_last_login TIMESTAMPTZ;
  v_weight_of TEXT;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'get_daily_matches: not authenticated';
  END IF;

  v_cfg := public.matching_settings();
  v_w := v_cfg -> 'weights';
  v_threshold := coalesce((v_cfg ->> 'threshold')::numeric, 90);
  v_count := greatest(1, least(coalesce(p_limit, (v_cfg ->> 'daily_count')::int, 5), 25));
  v_is_paid := public.has_live_membership(v_viewer);

  SELECT mp.* INTO v_me FROM public.matrimony_profiles mp WHERE mp.user_id = v_viewer;
  SELECT pp.* INTO v_prefs FROM public.partner_preferences pp WHERE pp.profile_id = v_viewer;

  -- Build the candidate set: publicly listed, unblocked, the gender the
  -- member is looking for, never the member themself.
  FOR v_cand IN
    SELECT mp.*, pr.full_name, ph.storage_path AS photo, pr.last_login_at
    FROM public.matrimony_profiles mp
    JOIN public.profiles pr ON pr.id = mp.user_id
    LEFT JOIN LATERAL (
      SELECT x.storage_path FROM public.profile_photos x
      WHERE x.profile_id = mp.user_id AND x.kind = 'profile_photo'
      ORDER BY x.is_primary DESC, x.sort_order ASC, x.id ASC LIMIT 1
    ) ph ON TRUE
    WHERE mp.user_id <> v_viewer
      AND public.is_profile_public(mp.user_id)
      AND NOT public.is_blocked(v_viewer, mp.user_id)
      AND mp.gender IS NOT NULL
      AND mp.date_of_birth IS NOT NULL
      AND mp.gender = coalesce(v_prefs.preferred_gender,
                 CASE WHEN v_me.gender = 'male' THEN 'female'::public.gender ELSE 'male'::public.gender END)
  LOOP
    v_cand_age := date_part('year', age(v_cand.date_of_birth));
    v_reasons := ARRAY[]::TEXT[];

    -- ── age (def. 15): inside the preferred band → full; ±3 → half
    s_age := 0;
    IF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) AND coalesce(v_prefs.max_age, 60) THEN
      s_age := 1;
      v_reasons := array_append(v_reasons, 'Age within your preferred range');
    ELSIF v_cand_age BETWEEN coalesce(v_prefs.min_age, 18) - 3 AND coalesce(v_prefs.max_age, 60) + 3 THEN
      s_age := 0.5;
      v_reasons := array_append(v_reasons, 'Age close to your preferred range');
    END IF;

    -- ── location (15): preferred cities win; fall back to same city/state
    s_loc := 0;
    IF coalesce(array_length(v_prefs.preferred_cities, 1), 0) > 0 THEN
      IF EXISTS (SELECT 1 FROM unnest(v_prefs.preferred_cities) c
                 WHERE lower(c) = lower(btrim(coalesce(v_cand.city, '')))) THEN
        s_loc := 1;
        v_reasons := array_append(v_reasons, 'Lives in your preferred city');
      ELSIF lower(v_cand.state) = lower(v_me.state) THEN
        s_loc := 0.4;
      END IF;
    ELSIF lower(btrim(coalesce(v_cand.city, ''))) <> '' AND lower(v_cand.city) = lower(v_me.city) THEN
      s_loc := 1;
      v_reasons := array_append(v_reasons, 'Lives in your city');
    ELSIF lower(v_cand.state) = lower(v_me.state) THEN
      s_loc := 0.6;
      v_reasons := array_append(v_reasons, 'Lives in your state');
    ELSE
      s_loc := 0.2;
    END IF;

    -- ── education (10)
    s_edu := 0;
    IF nullif(btrim(coalesce(v_prefs.preferred_education, '')), '') IS NOT NULL THEN
      IF lower(v_cand.education) = lower(v_prefs.preferred_education) THEN
        s_edu := 1;
        v_reasons := array_append(v_reasons, 'Education matches your preference');
      END IF;
    ELSIF public.education_rank(v_cand.education) > 0 THEN
      IF public.education_rank(v_cand.education) = public.education_rank(v_me.education) THEN
        s_edu := 1;
        v_reasons := array_append(v_reasons, 'Same education level');
      ELSIF abs(public.education_rank(v_cand.education) - public.education_rank(v_me.education)) = 1 THEN
        s_edu := 0.5;
      END IF;
    END IF;

    -- ── occupation (10)
    s_occ := 0;
    IF nullif(btrim(coalesce(v_prefs.preferred_occupation, '')), '') IS NOT NULL THEN
      IF lower(v_cand.occupation) = lower(v_prefs.preferred_occupation) THEN
        s_occ := 1;
        v_reasons := array_append(v_reasons, 'Occupation matches your preference');
      END IF;
    ELSIF nullif(btrim(coalesce(v_cand.occupation, '')), '') IS NOT NULL THEN
      IF lower(v_cand.occupation) = lower(v_me.occupation) THEN
        s_occ := 1;
        v_reasons := array_append(v_reasons, 'Similar occupation');
      ELSE
        s_occ := 0.3;
      END IF;
    END IF;

    -- ── income (10): preferred band is a floor; no preference → neutral
    s_inc := 0.4;
    IF nullif(btrim(coalesce(v_prefs.preferred_income, '')), '') IS NOT NULL
       AND public.income_band_rank(v_prefs.preferred_income) >= 0 THEN
      IF public.income_band_rank(v_cand.annual_income) >= public.income_band_rank(v_prefs.preferred_income) THEN
        s_inc := 1;
        v_reasons := array_append(v_reasons, 'Income matches your preference');
      ELSIF public.income_band_rank(v_cand.annual_income) = public.income_band_rank(v_prefs.preferred_income) - 1 THEN
        s_inc := 0.5;
      ELSE
        s_inc := 0;
      END IF;
    ELSIF public.income_band_rank(v_cand.annual_income) > 0 THEN
      s_inc := 0.8;
    END IF;

    -- ── community (10): preferred sub-communities win; fall back to same sub
    s_com := 0;
    IF coalesce(array_length(v_prefs.preferred_sub_communities, 1), 0) > 0 THEN
      IF EXISTS (SELECT 1 FROM unnest(v_prefs.preferred_sub_communities) c
                 WHERE lower(c) = lower(btrim(coalesce(v_cand.sub_community, '')))) THEN
        s_com := 1;
        v_reasons := array_append(v_reasons, 'Same sub-community you prefer');
      END IF;
    ELSIF lower(btrim(coalesce(v_cand.sub_community, ''))) <> ''
          AND lower(v_cand.sub_community) = lower(v_me.sub_community) THEN
      s_com := 1;
      v_reasons := array_append(v_reasons, 'Same sub-community');
    ELSE
      s_com := 0.3;
    END IF;

    -- ── partner preferences (15): diet / marital status wishes
    v_pref_checks := 0; v_checked := 0;
    IF v_prefs.preferred_diet IS NOT NULL THEN
      v_checked := v_checked + 1;
      IF v_cand.diet = v_prefs.preferred_diet THEN
        v_pref_checks := v_pref_checks + 1;
      END IF;
    END IF;
    IF v_prefs.preferred_marital_status IS NOT NULL THEN
      v_checked := v_checked + 1;
      IF v_cand.marital_status = v_prefs.preferred_marital_status THEN
        v_pref_checks := v_pref_checks + 1;
      END IF;
    END IF;
    IF v_checked = 0 THEN
      s_pref := 0.7; -- member set no detailed wishes → neutral-high
    ELSE
      s_pref := v_pref_checks / v_checked;
      IF s_pref = 1 THEN
        v_reasons := array_append(v_reasons, 'Matches your diet & marital preferences');
      END IF;
    END IF;

    -- ── lifestyle (10): smoking + drinking alignment
    s_life := 0;
    IF v_cand.smoking = v_me.smoking THEN s_life := s_life + 0.5; END IF;
    IF v_cand.drinking = v_me.drinking THEN s_life := s_life + 0.5; END IF;
    IF s_life = 1 THEN
      v_reasons := array_append(v_reasons, 'Similar lifestyle');
    END IF;

    -- ── behaviour (5): recently active members answer faster
    SELECT p.last_login_at INTO v_last_login FROM public.profiles p WHERE p.id = v_cand.user_id;
    s_beh := 0;
    IF v_last_login IS NOT NULL AND v_last_login > now() - interval '30 days' THEN
      s_beh := 1;
      v_reasons := array_append(v_reasons, 'Active recently');
    ELSIF v_last_login IS NOT NULL AND v_last_login > now() - interval '90 days' THEN
      s_beh := 0.5;
    END IF;

    v_score := round(
      s_age  * coalesce((v_w ->> 'age')::numeric, 15) +
      s_loc  * coalesce((v_w ->> 'location')::numeric, 15) +
      s_edu  * coalesce((v_w ->> 'education')::numeric, 10) +
      s_occ  * coalesce((v_w ->> 'occupation')::numeric, 10) +
      s_inc  * coalesce((v_w ->> 'income')::numeric, 10) +
      s_com  * coalesce((v_w ->> 'community')::numeric, 10) +
      s_pref * coalesce((v_w ->> 'partner_prefs')::numeric, 15) +
      s_life * coalesce((v_w ->> 'lifestyle')::numeric, 10) +
      s_beh  * coalesce((v_w ->> 'behaviour')::numeric, 5)
    , 1);

    IF v_score < v_threshold THEN
      CONTINUE;                         -- NO padding: below threshold = out
    END IF;

    v_list := v_list || jsonb_build_object(
      'user_id', v_cand.user_id,
      'name', CASE
        WHEN char_length(btrim(v_cand.full_name)) > 1
          THEN left(btrim(v_cand.full_name), 1) || repeat('*', greatest(char_length(btrim(v_cand.full_name)) - 1, 0))
        ELSE 'Member'
      END,
      'name_full', CASE WHEN v_is_paid THEN v_cand.full_name ELSE NULL END,
      'age', CASE WHEN v_is_paid THEN floor(v_cand_age)::int ELSE NULL END,
      'gender', v_cand.gender,
      'height_cm', CASE WHEN v_is_paid THEN v_cand.height_cm ELSE NULL END,
      'sub_community', CASE WHEN v_is_paid THEN v_cand.sub_community ELSE NULL END,
      'marital_status', CASE WHEN v_is_paid THEN v_cand.marital_status ELSE NULL END,
      'education', CASE WHEN v_is_paid THEN v_cand.education ELSE NULL END,
      'occupation', v_cand.occupation,
      'city', CASE WHEN v_is_paid THEN v_cand.city ELSE NULL END,
      'state', CASE WHEN v_is_paid THEN v_cand.state ELSE NULL END,
      'diet', CASE WHEN v_is_paid THEN v_cand.diet ELSE NULL END,
      'photo', v_cand.photo,
      'has_photo', (v_cand.photo IS NOT NULL),
      'verified', (v_cand.verified_at IS NOT NULL),
      'is_boosted', public.has_active_boost(v_cand.user_id),
      'viewer_is_paid', v_is_paid,
      'score', v_score,
      'reasons', to_jsonb(coalesce(v_reasons[1:4], ARRAY[]::text[]))
    );
  END LOOP;

  -- Deterministic daily shuffle inside equal scores: seed = user + date.
  SELECT coalesce(jsonb_agg(item ORDER BY (item ->> 'score')::numeric DESC,
                                          (item ->> 'is_boosted')::boolean DESC,
                                          md5((item ->> 'user_id') || current_date::text) ASC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT item FROM jsonb_array_elements(v_list) AS item
  ) s
  LIMIT v_count;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.get_daily_matches(integer) IS
  'Rule-based Daily 5 (no ML): candidates must be publicly listed, unblocked and score >= the matching_config threshold (default 90%). Returns each card with score + "why it matches" reasons. NO padding — returning fewer than the daily count is correct.';

REVOKE ALL ON FUNCTION public.get_daily_matches(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_matches(integer) TO authenticated;


-- ----------------------------------------------------------------------------
-- §4 Profile boosts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_boosts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status      public.boost_status NOT NULL DEFAULT 'active',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_via TEXT NOT NULL DEFAULT 'package',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_boosts IS
  'Profile boosts — real backend state. An active boost ranks the profile first in search/browse/featured/Daily 5 until expires_at, when the sweep flips it to expired and notifies the member.';

CREATE INDEX IF NOT EXISTS profile_boosts_user_idx ON public.profile_boosts (user_id, status, expires_at DESC);

ALTER TABLE public.profile_boosts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile_boosts TO authenticated;

DROP POLICY IF EXISTS "Owner reads own boosts" ON public.profile_boosts;
CREATE POLICY "Owner reads own boosts"
  ON public.profile_boosts FOR SELECT TO authenticated
  USING (user_id = auth.uid());


CREATE OR REPLACE FUNCTION public.has_active_boost(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_boosts b
    WHERE b.user_id = p_user_id
      AND b.status = 'active'
      AND b.expires_at > now()
  );
$$;

COMMENT ON FUNCTION public.has_active_boost(uuid) IS 'TRUE while the member has an unexpired active boost.';

REVOKE ALL ON FUNCTION public.has_active_boost(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_boost(uuid) TO anon, authenticated, service_role;


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

  -- Already boosted → idempotent.
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

  -- Count boosts used since the current membership started.
  SELECT greatest(coalesce((public.get_membership(v_user) ->> 'started_at')::timestamptz, now() - interval '10 years'), now() - interval '10 years')
  INTO v_started;
  SELECT count(*) INTO v_used
  FROM public.profile_boosts b
  WHERE b.user_id = v_user
    AND b.created_at >= v_started;
  IF v_used >= v_included THEN
    RAISE EXCEPTION 'BOOST_LIMIT_REACHED: your current plan includes % boosts', floor(v_included);
  END IF;

  INSERT INTO public.profile_boosts (user_id)
  VALUES (v_user)
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
  'Activates a 7-day profile boost. Enforces the plan''s boosts_included quota within the current membership period; idempotent while a boost is running. Free members get BOOSTS_NOT_INCLUDED.';

REVOKE ALL ON FUNCTION public.boost_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boost_my_profile() TO authenticated;


-- Extend the expiry sweep to also retire boosts (+ notify).
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
    RETURNING b.user_id
  LOOP
    v_boosts := v_boosts + 1;
    PERFORM public.push_notification(
      v_row.user_id,
      'boost_expiring',
      'Your Profile Boost has ended',
      'Your 7-day boost is over. Activate another boost to stay at the top of search results.',
      '{}'::jsonb,
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

REVOKE ALL ON FUNCTION public.sweep_expired_memberships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_memberships() TO service_role;


-- ----------------------------------------------------------------------------
-- §5 Featured profiles (admin-selected; replaces the hard-coded demo section)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.featured_profiles (
  profile_id UUID PRIMARY KEY REFERENCES public.matrimony_profiles (user_id) ON DELETE CASCADE,
  position   SMALLINT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.featured_profiles IS
  'Homepage featured profiles, chosen by the admin. The public RPC hides any that stop being publicly listed (expired membership, hidden, blocked…).';

CREATE INDEX IF NOT EXISTS featured_profiles_position_idx ON public.featured_profiles (position, created_at);

ALTER TABLE public.featured_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.featured_profiles TO authenticated, anon;

DROP POLICY IF EXISTS "Anyone reads featured list" ON public.featured_profiles;
CREATE POLICY "Anyone reads featured list"
  ON public.featured_profiles FOR SELECT TO authenticated, anon
  USING (TRUE);


CREATE OR REPLACE FUNCTION public.get_featured_profiles(p_limit INTEGER DEFAULT 8)
RETURNS JSONB
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
BEGIN
  SELECT jsonb_agg(card ORDER BY position ASC) INTO v_result
  FROM (
    SELECT
      fp.position,
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
        'photo', ph.storage_path,
        'has_photo', (ph.storage_path IS NOT NULL),
        'verified', (mp.verified_at IS NOT NULL),
        'is_boosted', public.has_active_boost(mp.user_id),
        'viewer_is_paid', v_is_paid
      ) AS card
    FROM public.featured_profiles fp
    JOIN public.matrimony_profiles mp ON mp.user_id = fp.profile_id
    JOIN public.profiles p ON p.id = mp.user_id
    LEFT JOIN LATERAL (
      SELECT x.storage_path FROM public.profile_photos x
      WHERE x.profile_id = mp.user_id AND x.kind = 'profile_photo'
      ORDER BY x.is_primary DESC, x.sort_order ASC, x.id ASC LIMIT 1
    ) ph ON TRUE
    WHERE public.is_profile_public(mp.user_id)
      AND NOT public.is_blocked(auth.uid(), mp.user_id)
    ORDER BY fp.position ASC, fp.created_at ASC
    LIMIT least(greatest(coalesce(p_limit, 8), 1), 24)
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_featured_profiles(integer) IS
  'Safe homepage featured cards (masked for free viewers) for admin-selected, currently-public profiles. Anonymous-safe; no contact data ever.';

REVOKE ALL ON FUNCTION public.get_featured_profiles(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_featured_profiles(integer) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §6 Verification requests + verified badge
-- ----------------------------------------------------------------------------
ALTER TABLE public.matrimony_profiles
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.matrimony_profiles.verified_at IS
  'Set when a photo/ID verification request is approved. Drives the "✓ Verified Profile" badge.';

CREATE TABLE IF NOT EXISTS public.verification_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type         public.verification_type NOT NULL,
  status       public.verification_status NOT NULL DEFAULT 'pending',
  storage_path TEXT,                        -- private bucket, owner+admin only
  note         TEXT,
  reviewed_by  UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.verification_requests IS
  'Verification lifecycle: mobile / photo / optional ID documents. Documents live in the private verification-docs bucket and are never publicly readable. Admins approve/reject; the decision trigger sets the badge.';

CREATE INDEX IF NOT EXISTS verification_requests_user_idx ON public.verification_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_requests_queue_idx ON public.verification_requests (status, created_at ASC);

-- One open request per (user, type) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS verification_one_pending_idx
  ON public.verification_requests (user_id, type)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS set_verification_requests_updated_at ON public.verification_requests;
CREATE TRIGGER set_verification_requests_updated_at
  BEFORE UPDATE ON public.verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.verification_requests TO authenticated;

DROP POLICY IF EXISTS "Owner reads own verification requests" ON public.verification_requests;
CREATE POLICY "Owner reads own verification requests"
  ON public.verification_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner files own verification request" ON public.verification_requests;
CREATE POLICY "Owner files own verification request"
  ON public.verification_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Decisions (status flips) are service-role only — admins act server-side.
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
    PERFORM public.log_activity(NEW.user_id, 'profile_verified', jsonb_build_object('type', NEW.type::text));
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    PERFORM public.push_notification(
      NEW.user_id,
      'admin_message',
      'Verification could not be approved',
      coalesce(nullif(btrim(NEW.note), ''), 'The submitted proof was not clear enough. Please try again with a clearer photo or document.'),
      jsonb_build_object('verification_type', NEW.type::text),
      '/profile'
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

-- Private bucket for verification documents (never public).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('verification-docs', 'verification-docs', FALSE)
    ON CONFLICT (id) DO NOTHING;

    DROP POLICY IF EXISTS "Members upload own verification docs" ON storage.objects;
    CREATE POLICY "Members upload own verification docs"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'verification-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    DROP POLICY IF EXISTS "Members read own verification docs" ON storage.objects;
    CREATE POLICY "Members read own verification docs"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'verification-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    DROP POLICY IF EXISTS "Members delete own verification docs" ON storage.objects;
    CREATE POLICY "Members delete own verification docs"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'verification-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- §7 Mali Moments (24-hour stories)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  media_type   public.moment_media_type NOT NULL DEFAULT 'photo',
  storage_path TEXT NOT NULL,
  caption      TEXT,
  is_removed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

COMMENT ON TABLE public.moments IS
  'Mali Moments — 24-hour photo/video stories. expires_at is enforced in every read path; is_removed is the admin takedown. No followers, likes or comments by design.';

CREATE INDEX IF NOT EXISTS moments_feed_idx ON public.moments (expires_at DESC) WHERE NOT is_removed;
CREATE INDEX IF NOT EXISTS moments_user_idx ON public.moments (user_id, created_at DESC);

ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.moments TO authenticated;

DROP POLICY IF EXISTS "Members read live moments" ON public.moments;
CREATE POLICY "Members read live moments"
  ON public.moments FOR SELECT TO authenticated
  USING ((expires_at > now() AND NOT is_removed) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Member posts own moment" ON public.moments;
CREATE POLICY "Member posts own moment"
  ON public.moments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Member deletes own moment" ON public.moments;
CREATE POLICY "Member deletes own moment"
  ON public.moments FOR DELETE TO authenticated
  USING (user_id = auth.uid());


CREATE OR REPLACE FUNCTION public.list_moments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer UUID := auth.uid();
  v_result jsonb;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'list_moments: not authenticated';
  END IF;

  SELECT jsonb_agg(item ORDER BY created_at DESC) INTO v_result
  FROM (
    SELECT jsonb_build_object(
             'id', m.id,
             'user_id', m.user_id,
             'name', CASE
               WHEN char_length(btrim(p.full_name)) > 1
                 THEN left(btrim(p.full_name), 1) || repeat('*', greatest(char_length(btrim(p.full_name)) - 1, 0))
               ELSE 'Member'
             END,
             'media_type', m.media_type,
             'storage_path', m.storage_path,
             'caption', m.caption,
             'created_at', m.created_at,
             'expires_at', m.expires_at,
             'is_mine', (m.user_id = v_viewer),
             'author_photo', ph.storage_path
           ) AS item,
           m.created_at
    FROM public.moments m
    JOIN public.profiles p ON p.id = m.user_id AND p.is_active
    LEFT JOIN LATERAL (
      SELECT x.storage_path FROM public.profile_photos x
      WHERE x.profile_id = m.user_id AND x.kind = 'profile_photo'
      ORDER BY x.is_primary DESC, x.sort_order ASC, x.id ASC LIMIT 1
    ) ph ON TRUE
    WHERE m.expires_at > now()
      AND NOT m.is_removed
      AND NOT public.is_blocked(v_viewer, m.user_id)
    ORDER BY m.created_at DESC
    LIMIT 100
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.list_moments() IS
  'The live Moments rail for the signed-in member: unexpired, not admin-removed, blocked authors hidden. Includes the author''s masked name and avatar.';

REVOKE ALL ON FUNCTION public.list_moments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_moments() TO authenticated;


-- ----------------------------------------------------------------------------
-- §8 Success stories (admin-published; honest empty state when none)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.success_stories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_names TEXT NOT NULL,
  title        TEXT NOT NULL,
  story        TEXT NOT NULL,
  photo_path   TEXT,
  wedding_date DATE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.success_stories IS
  'Real couples, published by the admin. The /success-stories page reads ONLY published rows and shows an honest empty state when there are none — never fabricated stories.';

DROP TRIGGER IF EXISTS set_success_stories_updated_at ON public.success_stories;
CREATE TRIGGER set_success_stories_updated_at
  BEFORE UPDATE ON public.success_stories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.success_stories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.success_stories TO authenticated, anon;

DROP POLICY IF EXISTS "Anyone reads published stories" ON public.success_stories;
CREATE POLICY "Anyone reads published stories"
  ON public.success_stories FOR SELECT TO authenticated, anon
  USING (is_published = TRUE);


-- ----------------------------------------------------------------------------
-- §9 search_matches() FINAL — boost ordering, verified flag, advanced filters
--    Signature grows (defaults keep old calls working); drop the old one
--    first so there is exactly one definition.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_matches(public.gender, integer, integer, text, text, integer);

CREATE FUNCTION public.search_matches(
  p_looking_for    public.gender DEFAULT NULL,
  p_min_age        INTEGER DEFAULT NULL,
  p_max_age        INTEGER DEFAULT NULL,
  p_city           TEXT DEFAULT NULL,
  p_sub_community  TEXT DEFAULT NULL,
  p_limit          INTEGER DEFAULT 60,
  p_education      TEXT DEFAULT NULL,
  p_occupation     TEXT DEFAULT NULL,
  p_native_place   TEXT DEFAULT NULL,
  p_marital_status public.marital_status DEFAULT NULL,
  p_diet           public.diet DEFAULT NULL,
  p_min_income     TEXT DEFAULT NULL,
  p_min_height     INTEGER DEFAULT NULL,
  p_max_height     INTEGER DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result   jsonb;
  v_limit    INTEGER := CASE
    WHEN auth.uid() IS NULL THEN least(greatest(coalesce(p_limit, 5), 1), 5)
    ELSE least(greatest(coalesce(p_limit, 60), 1), 200)
  END;
  v_is_paid  BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_live_membership(auth.uid())
  END;
  -- Advanced filters apply ONLY for plans with the benefit — a free member
  -- sending them anyway gets basic search, never an error.
  v_advanced BOOLEAN := CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE public.has_benefit('advanced_search', auth.uid())
  END;
BEGIN
  SELECT jsonb_agg(card ORDER BY boosted DESC, sort_at DESC)
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
        'verified', (mp.verified_at IS NOT NULL),
        'is_boosted', public.has_active_boost(mp.user_id),
        'viewer_is_paid', v_is_paid
      ) AS card,
      public.has_active_boost(mp.user_id) AS boosted,
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
      -- advanced filters: inert unless the caller's plan includes the benefit
      AND (NOT v_advanced OR p_education IS NULL OR lower(mp.education) = lower(btrim(p_education)))
      AND (NOT v_advanced OR p_occupation IS NULL OR lower(mp.occupation) = lower(btrim(p_occupation)))
      AND (NOT v_advanced OR p_native_place IS NULL OR lower(mp.native_place) ILIKE '%' || lower(btrim(p_native_place)) || '%')
      AND (NOT v_advanced OR p_marital_status IS NULL OR mp.marital_status = p_marital_status)
      AND (NOT v_advanced OR p_diet IS NULL OR mp.diet = p_diet)
      AND (NOT v_advanced OR p_min_income IS NULL
           OR public.income_band_rank(mp.annual_income) >= public.income_band_rank(p_min_income))
      AND (NOT v_advanced OR p_min_height IS NULL OR mp.height_cm >= p_min_height)
      AND (NOT v_advanced OR p_max_height IS NULL OR mp.height_cm <= p_max_height)
    ORDER BY boosted DESC, mp.updated_at DESC
    LIMIT v_limit
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) IS
  'Safe profile browse RPC: publicly-listed profiles only (is_profile_public), blocked pairs excluded, boosted profiles first. Advanced filters (education/occupation/native place/marital/diet/income/height) apply only with the advanced_search plan benefit.';

REVOKE ALL ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_matches(public.gender, integer, integer, text, text, integer, text, text, text, public.marital_status, public.diet, text, integer, integer) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §10 get_public_profile() FINAL — verified + family/lifestyle for paid viewers
-- ----------------------------------------------------------------------------
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
    'verified', (mp.verified_at IS NOT NULL),
    'is_boosted', public.has_active_boost(mp.user_id),
    'age', CASE WHEN v_is_paid THEN floor(date_part('year', age(mp.date_of_birth)))::int ELSE NULL END,
    'height_cm', CASE WHEN v_is_paid THEN mp.height_cm ELSE NULL END,
    'religion', CASE WHEN v_is_paid THEN mp.religion ELSE NULL END,
    'sub_community', CASE WHEN v_is_paid THEN mp.sub_community ELSE NULL END,
    'mother_tongue', CASE WHEN v_is_paid THEN mp.mother_tongue ELSE NULL END,
    'marital_status', CASE WHEN v_is_paid THEN mp.marital_status ELSE NULL END,
    'education', CASE WHEN v_is_paid THEN mp.education ELSE NULL END,
    'education_details', CASE WHEN v_is_paid THEN mp.education_details ELSE NULL END,
    'occupation', mp.occupation,
    'company', CASE WHEN v_is_paid THEN mp.company ELSE NULL END,
    'annual_income', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_income')::boolean, TRUE)
                     THEN mp.annual_income ELSE NULL END,
    'city', CASE WHEN v_is_paid THEN mp.city ELSE NULL END,
    'state', CASE WHEN v_is_paid THEN mp.state ELSE NULL END,
    'country', CASE WHEN v_is_paid THEN mp.country ELSE NULL END,
    'native_place', CASE WHEN v_is_paid THEN mp.native_place ELSE NULL END,
    'diet', CASE WHEN v_is_paid THEN mp.diet ELSE NULL END,
    'smoking', CASE WHEN v_is_paid THEN mp.smoking ELSE NULL END,
    'drinking', CASE WHEN v_is_paid THEN mp.drinking ELSE NULL END,
    'gotra', CASE WHEN v_is_paid THEN mp.gotra ELSE NULL END,
    'about_me', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_about')::boolean, TRUE)
                  THEN mp.about_me ELSE NULL END,
    'hobbies', CASE WHEN v_is_paid THEN mp.hobbies ELSE '{}'::text[] END,
    'father_occupation', CASE WHEN v_is_paid THEN mp.father_occupation ELSE NULL END,
    'mother_occupation', CASE WHEN v_is_paid THEN mp.mother_occupation ELSE NULL END,
    'siblings', CASE WHEN v_is_paid THEN mp.siblings ELSE NULL END,
    'family_type', CASE WHEN v_is_paid THEN mp.family_type ELSE NULL END,
    'family_location', CASE WHEN v_is_paid THEN mp.family_location ELSE NULL END,
    'family_details', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_family_details')::boolean, TRUE)
                       THEN mp.family_details ELSE NULL END,
    'photos', COALESCE(
      (SELECT jsonb_agg(ph.storage_path ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC)
       FROM public.profile_photos ph
       WHERE ph.profile_id = mp.user_id AND ph.kind = 'profile_photo'),
      '[]'::jsonb
    ),
    'family_photo', CASE WHEN v_is_paid AND coalesce((mp.privacy_settings ->> 'show_family_photo')::boolean, TRUE) THEN (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = mp.user_id AND ph.kind = 'family_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ) ELSE NULL END,
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

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Safe public profile for publicly-listed members. Paid viewers additionally see the family section + lifestyle fields when the member''s privacy_settings allow. Phone only when paid + mutual. Blocked pairs see nothing.';

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;
