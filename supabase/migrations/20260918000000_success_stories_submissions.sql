-- ============================================================================
-- 20260918000000_success_stories_submissions.sql
--
-- Extends public.success_stories to support member-submitted success stories /
-- reviews from active paid members, pending admin moderation.
--
-- Features:
--   1. New columns on public.success_stories (submitted_by, rating, milestone,
--      valued_features, future_members_note, consent_to_publish, submitted_at).
--   2. Strict constraints on rating (1-5), milestone, and consent.
--   3. Row Level Security allowing public to read ONLY published stories, while
--      members can read their own pending/published submissions.
--   4. SECURITY DEFINER RPC public.submit_success_story() ensuring:
--      - Caller is authenticated (auth.uid()).
--      - Caller has an active paid subscription (has_active_subscription).
--      - Caller explicitly granted consent to publish.
--      - Anti-duplicate spam check (one pending submission at a time).
--      - Submitted row is strictly unapproved (is_published = FALSE).
--      - Submitter cannot impersonate another UUID (submitted_by = auth.uid()).
--   5. Retains full backwards compatibility with existing admin-created stories.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1 Schema extensions on public.success_stories
-- ----------------------------------------------------------------------------
ALTER TABLE public.success_stories
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  ADD COLUMN IF NOT EXISTS milestone TEXT CHECK (milestone IS NULL OR milestone IN ('found_match', 'engaged', 'married')),
  ADD COLUMN IF NOT EXISTS valued_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS future_members_note TEXT,
  ADD COLUMN IF NOT EXISTS consent_to_publish BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- Fast lookup of member submissions
CREATE INDEX IF NOT EXISTS idx_success_stories_submitted_by
  ON public.success_stories(submitted_by);

-- Efficient ordering of public & admin views
CREATE INDEX IF NOT EXISTS idx_success_stories_published_sort
  ON public.success_stories(is_published, sort_order, created_at DESC);

-- ----------------------------------------------------------------------------
-- §2 RLS Policies on public.success_stories
-- ----------------------------------------------------------------------------
ALTER TABLE public.success_stories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.success_stories TO authenticated, anon;

-- Public read: ONLY approved and published stories
DROP POLICY IF EXISTS "Anyone reads published stories" ON public.success_stories;
CREATE POLICY "Anyone reads published stories"
  ON public.success_stories FOR SELECT TO authenticated, anon
  USING (is_published = TRUE);

-- Members read: can read their own submission (both pending review and published)
DROP POLICY IF EXISTS "Members read own submissions" ON public.success_stories;
CREATE POLICY "Members read own submissions"
  ON public.success_stories FOR SELECT TO authenticated
  USING (submitted_by = auth.uid());

-- Direct inserts/updates by standard users remain blocked by RLS.
-- Submissions must go through the SECURITY DEFINER RPC or privileged admin action.

-- ----------------------------------------------------------------------------
-- §3 RPC public.submit_success_story()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_success_story(
  p_couple_names TEXT,
  p_title TEXT,
  p_story TEXT,
  p_rating SMALLINT,
  p_milestone TEXT DEFAULT NULL,
  p_wedding_date DATE DEFAULT NULL,
  p_photo_path TEXT DEFAULT NULL,
  p_valued_features JSONB DEFAULT '[]'::jsonb,
  p_future_members_note TEXT DEFAULT NULL,
  p_consent BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_story_id UUID;
  v_clean_names TEXT;
  v_clean_title TEXT;
  v_clean_story TEXT;
  v_clean_note TEXT;
  v_has_active BOOLEAN;
BEGIN
  -- 1. Must be authenticated
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit a success story';
  END IF;

  -- 2. Must hold an active paid subscription
  v_has_active := public.has_active_subscription(v_user_id);
  IF NOT v_has_active THEN
    RAISE EXCEPTION 'An active paid membership is required to submit a success story';
  END IF;

  -- 3. Consent is mandatory
  IF p_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'Explicit consent to publish is required';
  END IF;

  -- 4. Clean & validate inputs
  v_clean_names := trim(coalesce(p_couple_names, ''));
  v_clean_title := trim(coalesce(p_title, ''));
  v_clean_story := trim(coalesce(p_story, ''));
  v_clean_note  := NULLIF(trim(coalesce(p_future_members_note, '')), '');

  IF length(v_clean_names) < 2 OR length(v_clean_names) > 100 THEN
    RAISE EXCEPTION 'Couple display names must be between 2 and 100 characters';
  END IF;

  IF length(v_clean_title) < 3 OR length(v_clean_title) > 120 THEN
    RAISE EXCEPTION 'Story title must be between 3 and 120 characters';
  END IF;

  IF length(v_clean_story) < 100 OR length(v_clean_story) > 2500 THEN
    RAISE EXCEPTION 'Story must be between 100 and 2,500 characters';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5 stars';
  END IF;

  IF p_milestone IS NOT NULL AND p_milestone NOT IN ('found_match', 'engaged', 'married') THEN
    RAISE EXCEPTION 'Invalid relationship milestone';
  END IF;

  IF v_clean_note IS NOT NULL AND length(v_clean_note) > 800 THEN
    RAISE EXCEPTION 'Note to future members cannot exceed 800 characters';
  END IF;

  -- 5. Anti-spam: prevent multiple pending or duplicate published stories
  IF EXISTS (
    SELECT 1 FROM public.success_stories
    WHERE submitted_by = v_user_id AND is_published = FALSE
  ) THEN
    RAISE EXCEPTION 'You already have a success story pending review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.success_stories
    WHERE submitted_by = v_user_id AND is_published = TRUE
  ) THEN
    RAISE EXCEPTION 'You already have a published success story';
  END IF;

  -- 6. Insert story as PENDING review (is_published = FALSE)
  INSERT INTO public.success_stories (
    couple_names,
    title,
    story,
    rating,
    milestone,
    wedding_date,
    photo_path,
    valued_features,
    future_members_note,
    consent_to_publish,
    submitted_by,
    submitted_at,
    is_published,
    sort_order
  ) VALUES (
    v_clean_names,
    v_clean_title,
    v_clean_story,
    p_rating,
    p_milestone,
    p_wedding_date,
    p_photo_path,
    coalesce(p_valued_features, '[]'::jsonb),
    v_clean_note,
    TRUE,
    v_user_id,
    now(),
    FALSE,
    100
  )
  RETURNING id INTO v_story_id;

  RETURN v_story_id;
END;
$$;

COMMENT ON FUNCTION public.submit_success_story(TEXT, TEXT, TEXT, SMALLINT, TEXT, DATE, TEXT, JSONB, TEXT, BOOLEAN) IS
  'Securely records a success story submission from an active paid member. Enforces auth, subscription, consent, validation, and pending moderation state.';

REVOKE ALL ON FUNCTION public.submit_success_story(TEXT, TEXT, TEXT, SMALLINT, TEXT, DATE, TEXT, JSONB, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_success_story(TEXT, TEXT, TEXT, SMALLINT, TEXT, DATE, TEXT, JSONB, TEXT, BOOLEAN) TO authenticated;
