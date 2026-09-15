-- ============================================================================
-- Mali Vivah · Phase 1 — real, database-backed notifications
-- Migration 4 of the Phase 1 completion pass.
--
-- WHY THIS COMES BEFORE THE VISIBILITY MIGRATION
--   The membership-expiry sweep has to tell a member their plan lapsed, so the
--   notification plumbing must exist first.
--
-- WHAT IT CREATES
--   §1 public.notifications — one row per event, per recipient.
--   §2 Indexes tuned for the navbar bell: unread count + newest-first list.
--   §3 RLS + COLUMN-LEVEL GRANTS. This is the important part:
--        • members may SELECT only their own rows
--        • members may UPDATE only their own rows AND only (is_read, read_at)
--          — the column grant, not the policy, is what stops a member from
--          editing the title/message/type of their own notifications
--        • there is deliberately NO INSERT/DELETE policy, so the browser cannot
--          fabricate a notification. Creation happens only inside the
--          SECURITY DEFINER functions below or via the service role.
--   §4 push_notification() — the single write path. It refuses to store any
--      metadata key that could carry contact details, so a phone number or
--      email can never leak through a notification payload.
--   §5 Read-state RPCs used by the bell: unread_notification_count(),
--      mark_notification_read(), mark_all_notifications_read().
--   §6 Triggers that generate the real events: interest received / accepted /
--      declined, and profile viewed (throttled to one per viewer per week).
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run.
-- DEPENDS ON 20260915000000_enum_extensions.sql (notification_type).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type       public.notification_type NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'In-app notification feed behind the navbar bell. Written only by SECURITY DEFINER functions or the service role — the browser can never INSERT here.';
COMMENT ON COLUMN public.notifications.metadata IS
  'Reference ids for deep-linking (interest_id, viewer_id, package_slug…). Deliberately never holds a phone number or email address.';
COMMENT ON COLUMN public.notifications.link IS 'Optional in-app route, e.g. /interests or /profile/<uuid>.';

-- §2 Indexes
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_type_idx
  ON public.notifications (type, created_at DESC);


-- ----------------------------------------------------------------------------
-- §3 RLS + least-privilege grants
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Note: no INSERT / DELETE grant at all. Members can only read and flip the
-- read flag on their own rows.
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "Members read own notifications" ON public.notifications;
CREATE POLICY "Members read own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members update own notifications" ON public.notifications;
CREATE POLICY "Members update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- §4 push_notification() — the only write path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_notification(
  p_user_id  UUID,
  p_type     public.notification_type,
  p_title    TEXT,
  p_message  TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_link     TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       BIGINT;
  v_meta     JSONB := coalesce(p_metadata, '{}'::jsonb);
  v_scrubbed JSONB;
  k          TEXT;
BEGIN
  IF p_user_id IS NULL OR nullif(btrim(p_title), '') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Never let a notification carry contact details. Strip anything that looks
  -- like a phone / email / address key, whatever the caller passed.
  v_scrubbed := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(v_meta)
  LOOP
    IF lower(k) ~ '(phone|mobile|email|contact|address|password|token)' THEN
      CONTINUE;
    END IF;
    v_scrubbed := v_scrubbed || jsonb_build_object(k, v_meta -> k);
  END LOOP;

  INSERT INTO public.notifications (user_id, type, title, message, metadata, link)
  VALUES (p_user_id, p_type, btrim(p_title), coalesce(p_message, ''), v_scrubbed, p_link)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.push_notification(uuid, public.notification_type, text, text, jsonb, text) IS
  'Creates one notification. SECURITY DEFINER so triggers and server jobs can write; EXECUTE is revoked from anon/authenticated so the browser cannot fabricate notifications. Strips phone/email/contact/address keys from metadata.';

REVOKE ALL ON FUNCTION public.push_notification(uuid, public.notification_type, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_notification(uuid, public.notification_type, text, text, jsonb, text) TO service_role;


-- ----------------------------------------------------------------------------
-- §5 Read-state RPCs (the navbar bell)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unread_notification_count()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.notifications n
  WHERE n.user_id = auth.uid()
    AND n.is_read = FALSE
$$;

COMMENT ON FUNCTION public.unread_notification_count() IS 'Exact unread count for the calling member — drives the bell badge.';

REVOKE ALL ON FUNCTION public.unread_notification_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unread_notification_count() TO authenticated;


CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE, read_at = now()
  WHERE id = p_id
    AND user_id = auth.uid()
    AND is_read = FALSE;
END;
$$;

COMMENT ON FUNCTION public.mark_notification_read(bigint) IS 'Marks one of the caller''s own notifications read. Silently ignores rows belonging to anyone else.';

REVOKE ALL ON FUNCTION public.mark_notification_read(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(bigint) TO authenticated;


CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE, read_at = now()
  WHERE user_id = auth.uid()
    AND is_read = FALSE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.mark_all_notifications_read() IS 'Marks every unread notification of the caller read and returns how many were updated.';

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;


-- ----------------------------------------------------------------------------
-- §6 Triggers — the real events
-- ----------------------------------------------------------------------------

/** interest received / accepted / declined. */
CREATE OR REPLACE FUNCTION public.notify_interest_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name TEXT;
BEGIN
  SELECT p.full_name INTO v_sender_name
  FROM public.profiles p
  WHERE p.id = NEW.sender_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    PERFORM public.push_notification(
      NEW.receiver_id,
      'interest_received',
      'Someone expressed interest in you',
      coalesce(v_sender_name, 'A member') || ' expressed interest in your profile.',
      jsonb_build_object('interest_id', NEW.id, 'sender_id', NEW.sender_id),
      '/interests'
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN
      PERFORM public.push_notification(
        NEW.sender_id,
        'interest_accepted',
        'Your interest was accepted',
        'Good news — your interest was accepted. Contact details and the biodata download are now available.',
        jsonb_build_object('interest_id', NEW.id, 'receiver_id', NEW.receiver_id),
        '/interests'
      );
    ELSIF NEW.status = 'declined' THEN
      PERFORM public.push_notification(
        NEW.sender_id,
        'interest_declined',
        'An interest was declined',
        'The family you contacted has politely declined. No contact details were shared.',
        jsonb_build_object('interest_id', NEW.id, 'receiver_id', NEW.receiver_id),
        '/interests'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_interest_event() IS 'AFTER INSERT/UPDATE trigger on interests: notifies the receiver of a new interest and the sender when it is accepted or declined.';

DROP TRIGGER IF EXISTS interests_notify ON public.interests;
CREATE TRIGGER interests_notify
  AFTER INSERT OR UPDATE OF status ON public.interests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_interest_event();


/**
 * Profile viewed — throttled to one notification per (viewer, viewed) pair per
 * week so the feed is not drowned when the same family reopens a profile.
 */
CREATE OR REPLACE FUNCTION public.notify_profile_view()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.viewed_id
      AND n.type = 'profile_viewed'
      AND n.metadata ->> 'viewer_id' = NEW.viewer_id::text
      AND n.created_at > now() - interval '7 days'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_viewer_name
  FROM public.profiles p
  WHERE p.id = NEW.viewer_id;

  PERFORM public.push_notification(
    NEW.viewed_id,
    'profile_viewed',
    'Someone viewed your profile',
    coalesce(v_viewer_name, 'A member') || ' viewed your profile.',
    jsonb_build_object('viewer_id', NEW.viewer_id, 'profile_view_id', NEW.id),
    '/profile'
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_profile_view() IS 'AFTER INSERT trigger on profile_views: one "someone viewed you" notification per viewer per week.';

DROP TRIGGER IF EXISTS profile_views_notify ON public.profile_views;
CREATE TRIGGER profile_views_notify
  AFTER INSERT ON public.profile_views
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_profile_view();
