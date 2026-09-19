-- ============================================================================
-- Mali Vivah — Phase 2 foundation: site config, mobile OTP, moment reports
-- ============================================================================
--   §1 site_config — operator-editable public settings (support contacts,
--      boost pricing). Readable ONLY through get_public_site_config(), which
--      allow-lists the safe keys; the table itself grants nothing to
--      anon/authenticated (service-role/admin only).
--   §2 mobile_otps — one-time passcodes for mobile verification. Stores only
--      the SHA-256 hash (never the code), 10-minute expiry, max 5 attempts.
--      Service-role only — the Next.js API routes own every read/write.
--   §3 moment_reports — member reports against Mali Moments. The reporter can
--      insert + read their own rows; moderators act through the service role.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run. DEPENDS ON 20260915120000 (report_reason) and
-- 20260915130000 (profiles, moments, push_notification, log_activity).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 site_config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.site_config IS
  'Operator-editable public settings. Members never read this table directly — get_public_site_config() exposes an allow-listed subset. Admins edit via the service-role admin action (audited).';

ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

-- No grants to anon/authenticated on purpose: reads go through the RPC
-- below (public keys) or the service role (server components / admin).
REVOKE ALL ON TABLE public.site_config FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_site_config_updated_at ON public.site_config;
CREATE TRIGGER set_site_config_updated_at
  BEFORE UPDATE ON public.site_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed defaults (INSERT … ON CONFLICT DO NOTHING so re-runs and prior admin
-- edits are never clobbered).
INSERT INTO public.site_config (key, value) VALUES
  ('support_email',         '"hello@mali-vivah.com"'),
  ('support_phone_display', '"90000 00000"'),
  ('support_whatsapp',      '"919000000000"'),
  ('support_hours',         '"Monday – Saturday, 10:00 – 19:00 IST"'),
  ('boost_price_inr',       '199'),
  ('boost_duration_days',   '7')
ON CONFLICT (key) DO NOTHING;

-- Public, allow-listed read path. New keys must be added here explicitly —
-- nothing leaks by accident.
CREATE OR REPLACE FUNCTION public.get_public_site_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    jsonb_object_agg(c.key, c.value),
    '{}'::jsonb
  )
  FROM public.site_config c
  WHERE c.key IN (
    'support_email',
    'support_phone_display',
    'support_whatsapp',
    'support_hours',
    'boost_price_inr',
    'boost_duration_days'
  )
$$;

COMMENT ON FUNCTION public.get_public_site_config() IS
  'Allow-listed public site settings (support contacts, boost pricing). Safe for anon/authenticated; anything not in the list stays server-side.';

REVOKE ALL ON FUNCTION public.get_public_site_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_site_config() TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §2 mobile_otps
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mobile_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  mobile      TEXT NOT NULL,
  code_hash   TEXT NOT NULL,          -- SHA-256 hex of the 6-digit code; the code itself is never stored
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,            -- set once a code verifies (or is superseded)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mobile_otps IS
  'Mobile verification one-time passcodes. Hash-only storage, 10-minute expiry, max 5 attempts per code. Service-role only — the /api/verification/otp/* routes own every read/write.';

CREATE INDEX IF NOT EXISTS mobile_otps_user_idx
  ON public.mobile_otps (user_id, created_at DESC);

ALTER TABLE public.mobile_otps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mobile_otps FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- §3 moment_reports
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moment_reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  moment_id   UUID NOT NULL REFERENCES public.moments (id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reason      public.report_reason NOT NULL,
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT moment_reports_unique_pair UNIQUE (moment_id, reporter_id)
);

COMMENT ON TABLE public.moment_reports IS
  'Member reports against Mali Moments (one per member per moment). Reporters read/insert their own rows; moderators act through the service role.';

CREATE INDEX IF NOT EXISTS moment_reports_moment_idx
  ON public.moment_reports (moment_id, created_at DESC);

ALTER TABLE public.moment_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.moment_reports TO authenticated;

DROP POLICY IF EXISTS "Reporter reads own moment reports" ON public.moment_reports;
CREATE POLICY "Reporter reads own moment reports"
  ON public.moment_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Reporter files own moment report" ON public.moment_reports;
CREATE POLICY "Reporter files own moment report"
  ON public.moment_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
