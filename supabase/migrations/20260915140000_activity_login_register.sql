-- ============================================================================
-- 20260915140000_activity_login_register.sql
--
-- One activity stream — one table (activity_events from migration 12):
--   §1 Registration: AFTER INSERT trigger on profiles logs 'registered'.
--      (profiles are inserted by the sign-up trigger; catching them here
--      means the app never has to remember to log it.)
--   §2 record_login() upgraded: still records login_history + counters, and
--      now also logs 'logged_in' into the same activity stream.
-- ============================================================================

-- §1 Registration event
CREATE OR REPLACE FUNCTION public.log_registration_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activity_events (user_id, event, metadata)
  VALUES (
    NEW.id,
    'registered',
    jsonb_build_object('for_whom', NEW.for_whom, 'via', 'signup')
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_registration_activity() IS
  'AFTER INSERT trigger on profiles: logs the registration into activity_events so the single event stream includes sign-ups.';

DROP TRIGGER IF EXISTS profiles_log_registration ON public.profiles;
CREATE TRIGGER profiles_log_registration
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_registration_activity();


-- §2 record_login() → also logs 'logged_in'
CREATE OR REPLACE FUNCTION public.record_login()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'record_login: not authenticated';
  END IF;

  INSERT INTO public.login_history (user_id) VALUES (v_uid);

  UPDATE public.profiles
  SET last_login_at = now(),
      login_count   = login_count + 1,
      updated_at    = now()
  WHERE id = v_uid;

  INSERT INTO public.activity_events (user_id, event, metadata)
  VALUES (v_uid, 'logged_in', '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.record_login() IS
  'Called after a successful sign-in: writes login_history, bumps profile login counters and logs the login into activity_events (one event table for everything).';

REVOKE ALL ON FUNCTION public.record_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;
