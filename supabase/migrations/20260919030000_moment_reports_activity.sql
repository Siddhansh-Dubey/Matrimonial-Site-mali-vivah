-- ============================================================================
-- Mali Vivah · Phase 1 — Mali Moments: reporting + activity events
--
-- WHAT IT DOES
--   §1 reports.target_type / reports.target_id — extends the existing report
--      table so a report can point at a MOMENT (target_type='moment',
--      target_id=<moments.id>) as well as a profile (the default, unchanged).
--      Existing rows backfill to 'profile'. The reported member (the moment
--      author) still cannot see WHO reported — the reporter is visible only
--      to the reporter (existing RLS) and to admins (service role).
--   §2 report_moment() — the ONLY member path to report a moment:
--        * server-authoritative (security definer, auth.uid() is the reporter),
--        * self-reports rejected,
--        * one open/reviewing report per (reporter, moment),
--        * notifies the moment owner that a review was opened (no identity),
--        * activity event 'moment_reported' (reporter-scoped; scrubbed meta).
--   §3 moments AFTER INSERT trigger — logs 'moment_posted' for every new
--      moment (the single analytics stream; PRD "Story uploaded").
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Extend reports
-- ----------------------------------------------------------------------------
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'profile',
  ADD COLUMN IF NOT EXISTS target_id   UUID;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('profile', 'moment'));

COMMENT ON COLUMN public.reports.target_type IS
  '''profile'' (default, historical) or ''moment'' — what the report is actually about. reported_id always names the MEMBER (the profile or moment author).';
COMMENT ON COLUMN public.reports.target_id IS
  'For target_type=''moment'': the moments.id being reported. NULL for profile reports.';

CREATE INDEX IF NOT EXISTS reports_target_idx ON public.reports (target_type, target_id) WHERE target_id IS NOT NULL;

-- Backfill (no-op for fresh tables).
UPDATE public.reports SET target_type = 'profile' WHERE target_type IS DISTINCT FROM 'profile';


-- ----------------------------------------------------------------------------
-- §2 report_moment()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_moment(
  p_moment_id UUID,
  p_reason    public.report_reason DEFAULT 'inappropriate_content',
  p_details   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reporter UUID := auth.uid();
  v_moment   RECORD;
  v_existing BIGINT;
  v_new      BIGINT;
BEGIN
  IF v_reporter IS NULL THEN
    RAISE EXCEPTION 'report_moment: not authenticated';
  END IF;
  IF p_moment_id IS NULL THEN
    RAISE EXCEPTION 'report_moment: moment id required';
  END IF;

  SELECT m.id, m.user_id INTO v_moment
  FROM public.moments m
  WHERE m.id = p_moment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOMENT_NOT_FOUND';
  END IF;
  IF v_moment.user_id = v_reporter THEN
    RAISE EXCEPTION 'CANNOT_REPORT_OWN_MOMENT';
  END IF;

  -- One open/reviewing report per (reporter, moment) — no spam duplicates.
  SELECT r.id INTO v_existing
  FROM public.reports r
  WHERE r.reporter_id = v_reporter
    AND r.target_type = 'moment'
    AND r.target_id = p_moment_id
    AND r.status IN ('open', 'reviewing');
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_reported');
  END IF;

  INSERT INTO public.reports
    (reporter_id, reported_id, reason, details, status, target_type, target_id)
  VALUES
    (v_reporter, v_moment.user_id, p_reason,
     nullif(btrim(coalesce(p_details, '')), ''),
     'open', 'moment', p_moment_id)
  RETURNING id INTO v_new;

  -- Tell the author their moment is under review — WITHOUT revealing who
  -- reported it.
  PERFORM public.push_notification(
    v_moment.user_id,
    'admin_message',
    'A moment is under review',
    'One of your Mali Moments has been reported and our team is reviewing it. No action is needed unless we contact you.',
    jsonb_build_object('moment_id', p_moment_id),
    '/profile'
  );

  PERFORM public.log_activity(
    v_reporter,
    'moment_reported',
    jsonb_build_object('moment_id', p_moment_id, 'reason', p_reason::text, 'report_id', v_new)
  );

  RETURN jsonb_build_object('status', 'filed', 'report_id', v_new);
END;
$$;

COMMENT ON FUNCTION public.report_moment(uuid, public.report_reason, text) IS
  'Files a moderation report against a moment. Server-authoritative: reporter is auth.uid(), self-reports rejected, deduped per (reporter, moment). Reporter identity stays hidden from the reported member.';

REVOKE ALL ON FUNCTION public.report_moment(uuid, public.report_reason, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_moment(uuid, public.report_reason, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- §3 Moment posting activity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_moment_posted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.log_activity(
    NEW.user_id,
    'moment_posted',
    jsonb_build_object('moment_id', NEW.id, 'media_type', NEW.media_type::text)
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_moment_posted() IS
  'AFTER INSERT trigger on moments: appends the moment_posted analytics event.';

DROP TRIGGER IF EXISTS moments_log_posted ON public.moments;
CREATE TRIGGER moments_log_posted
  AFTER INSERT ON public.moments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_moment_posted();
