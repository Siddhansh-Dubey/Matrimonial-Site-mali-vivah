-- ============================================================================
-- Mali Vivah DB test harness · Supabase platform shim
--
-- The migrations in supabase/migrations/ target a hosted Supabase project,
-- which pre-provisions a few things plain PostgreSQL does not have. This file
-- recreates the MINIMUM of that surface inside PGlite so the real migration
-- files can run unmodified:
--
--   * roles           anon / authenticated / service_role (GRANT targets)
--   * auth.users      the columns our triggers/backfills read
--   * auth.uid()      resolves the "signed-in user" from the same GUC the
--                     PostgREST layer sets (request.jwt.claim.sub), so tests
--                     can impersonate a member with set_config().
--
-- Storage (`storage` schema) and Realtime (`supabase_realtime` publication)
-- are intentionally ABSENT: every migration guards those blocks with
-- `IF EXISTS (… pg_namespace 'storage' …)` / `pg_publication`, so they skip
-- exactly as they would on a project without those features.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT,
  phone              TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_confirmed_at TIMESTAMPTZ,
  phone_confirmed_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same contract as Supabase's auth.uid(): NULL when no JWT claims are set.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
