-- ============================================================================
-- Mali Vivah · Phase 1 — admin-managed site content + WhatsApp configuration
--
-- WHAT IT DOES
--   §1 site_content — a focused, database-backed set of editable website copy
--      blocks (homepage CTA, About, Contact/support, community CTA). Not a
--      CMS: a small fixed key set that the app reads via get_site_content()
--      and renders with the existing design. Admin-only writes (service role
--      from /admin/content), public read of active rows only.
--   §2 whatsapp_config — the single source of truth for the operational
--      WhatsApp values (community link, support link, support number),
--      replacing the hard-coded constants in src/lib/contact.ts. Seeded with
--      the current production placeholders so behaviour is unchanged until an
--      admin edits them. get_whatsapp_config() is public (read-only); the app
--      falls back to its static constants when this table is empty/inactive.
--
-- SECURITY
--   * Both tables: RLS enabled, NO client grants. Reads go through two
--     security-definer RPCs (anon + authenticated); writes are service-role
--     only, from the admin actions, and every admin write is audit-logged in
--     the Next.js layer (admin_audit_log).
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (idempotent; admin edits are preserved by the upsert
-- semantics below — seeds only run when the row does not exist).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 site_content
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_content (
  key         TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  updated_by  UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT site_content_title_len  CHECK (char_length(btrim(title)) <= 200),
  CONSTRAINT site_content_body_len   CHECK (char_length(btrim(body)) <= 5000),
  CONSTRAINT site_content_key_format CHECK (key ~ '^[a-z0-9_]{3,64}$')
);

COMMENT ON TABLE public.site_content IS
  'Editable website copy for Phase 1 pages (homepage CTA, About, Contact/support, WhatsApp community CTA). Admin-managed; public read of active rows only via get_site_content().';

DROP TRIGGER IF EXISTS set_site_content_updated_at ON public.site_content;
CREATE TRIGGER set_site_content_updated_at
  BEFORE UPDATE ON public.site_content
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed the fixed key set (only when the row does not exist yet — admin
-- edits are never clobbered on re-run).
INSERT INTO public.site_content (key, title, body, sort_order) VALUES
  (
    'home_register_cta',
    'Start your journey',
    'Create your free profile, add your family photo and tell us who you are looking for. Upgrade to a paid package whenever you are ready to be found.'
  ),
  (
    'about_intro',
    'About Mali Vivah',
    'Mali Vivah began with a simple observation: families in the Mali community deserve a matrimonial space that behaves like our own community does — private by default, respectful of boundaries, and honest about what it can and cannot do.'
  ),
  (
    'about_cta',
    'Same community. Brighter tomorrows.',
    'Registration is free. Build your profile, add your family photo, and upgrade when you are ready to be found.'
  ),
  (
    'contact_intro',
    'We are here to help',
    'Questions about your profile, payments or safety? Our team usually replies within a few hours. For urgent matters, reach us on WhatsApp.'
  ),
  (
    'whatsapp_community',
    'Join the Mali Vivah WhatsApp Community',
    'Guidance, announcements and community events — all in one place. No spam, ever.'
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
-- No client grants (writes are service-role only).

CREATE OR REPLACE FUNCTION public.get_site_content(p_key TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('title', c.title, 'body', c.body)
  FROM public.site_content c
  WHERE c.key = p_key
    AND c.is_active = TRUE
$$;

COMMENT ON FUNCTION public.get_site_content(text) IS
  'Public read of one editable copy block (active rows only). Returns NULL when the key is missing or inactive so the app can render its built-in fallback copy.';

REVOKE ALL ON FUNCTION public.get_site_content(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_content(text) TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- §2 whatsapp_config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_config (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  community_link TEXT,
  support_link   TEXT,
  support_number TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by     UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_config_link_format CHECK (
    community_link IS NULL OR community_link ~ '^https://(chat\.whatsapp\.com|wa\.me)/'
  ),
  CONSTRAINT whatsapp_config_number_format CHECK (
    support_number IS NULL OR support_number ~ '^[0-9]{10,15}$'
  )
);

COMMENT ON TABLE public.whatsapp_config IS
  'Single-row (id=1) operational WhatsApp configuration: community link, support link and support number. Seeded with the current placeholder values; admin-editable from /admin/whatsapp (service role, audit-logged). Public read via get_whatsapp_config().';

DROP TRIGGER IF EXISTS set_whatsapp_config_updated_at ON public.whatsapp_config;
CREATE TRIGGER set_whatsapp_config_updated_at
  BEFORE UPDATE ON public.whatsapp_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed with the current hard-coded values (src/lib/contact.ts) so the site
-- behaves identically until an admin changes them.
INSERT INTO public.whatsapp_config (id, community_link, support_link, support_number)
VALUES
  (1,
   NULL,
   'https://wa.me/919000000000',
   '919000000000')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;
-- No client grants (writes are service-role only).

CREATE OR REPLACE FUNCTION public.get_whatsapp_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'community_link', w.community_link,
           'support_link',   w.support_link,
           'support_number', w.support_number
         )
  FROM public.whatsapp_config w
  WHERE w.id = 1
    AND w.is_active = TRUE
$$;

COMMENT ON FUNCTION public.get_whatsapp_config() IS
  'Public read of the active WhatsApp configuration. Returns NULL when inactive/empty so the app falls back to its static constants.';

REVOKE ALL ON FUNCTION public.get_whatsapp_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_config() TO anon, authenticated, service_role;
