-- ============================================================================
-- Mali Vivah · FIX for the photo-upload error in the profile wizard:
--
--   [photo] new row violates row-level security policy
--
-- WHY YOU SEE THAT ERROR
--   The photos step of the wizard (src/components/profile/
--   profile-wizard.tsx → onUpload) uploads each picture with the BROWSER
--   (anon-key) client:
--
--     supabase.storage.from('profile-photos').upload(`${userId}/…`, file)
--
--   Uploading = INSERTing a row into storage.objects, and storage.objects is
--   protected by its OWN row-level-security policies — completely separate
--   from the policies on public.profile_photos. Migration
--   20260911000000_matrimony_profiles.sql created the bucket and only a
--   SELECT ("Public read profile photos") policy, so Storage had no rule
--   allowing an INSERT and rejected every upload with the Postgres error
--   "new row violates row-level security policy".
--   (The wizard's profile_photos INSERT policy is fine — reaching the photos
--   step already guarantees your matrimony_profiles row exists.)
--
-- WHAT THIS MIGRATION DOES (every statement is idempotent — safe to re-run):
--   §1  Re-asserts the 'profile-photos' bucket (same guarded insert as
--       migration 2, so this file also works on a fresh project).
--   §2  Adds the missing Storage write policies. They are scoped with
--       storage.foldername(name)[1] = auth.uid() so a member can only write
--       inside their OWN top-level folder — exactly the "<user id>/…" path
--       convention the app already uses:
--         INSERT → allows the upload itself (this is the fix)
--         UPDATE → allows overwriting an object (e.g. future upsert: true)
--         DELETE → allows removing an object (the wizard's "✕ remove photo")
--       Reading stays public via "Public read profile photos" (re-asserted
--       below), so gallery/public URLs keep working unchanged.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste this file → Run.
-- You should see "Success. No rows returned". No app restart needed —
-- just try uploading a photo again.
--
-- DEPENDS ON 20260911000000_matrimony_profiles.sql (run that first if your
-- project does not have the matrimony tables yet).
-- ============================================================================


DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN

    -- §1 Bucket (idempotent — no-op when migration 2 already created it).
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('profile-photos', 'profile-photos', TRUE)
    ON CONFLICT (id) DO NOTHING;

    -- §2a Public read (re-asserted so this file alone yields a complete,
    --     working Storage setup).
    DROP POLICY IF EXISTS "Public read profile photos" ON storage.objects;
    CREATE POLICY "Public read profile photos"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'profile-photos');

    -- §2b THE FIX — members may upload, but only into their own folder:
    --     "<auth uid>/<timestamp>-<file name>", as the wizard builds it.
    DROP POLICY IF EXISTS "Members upload photos to own folder" ON storage.objects;
    CREATE POLICY "Members upload photos to own folder"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    -- §2c Overwrites (UPDATE), same folder scoping.
    DROP POLICY IF EXISTS "Members overwrite own photos" ON storage.objects;
    CREATE POLICY "Members overwrite own photos"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    -- §2d Removals (DELETE) — used by the wizard when a photo is removed,
    --     which silently failed before this migration.
    DROP POLICY IF EXISTS "Members delete own photos" ON storage.objects;
    CREATE POLICY "Members delete own photos"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

  ELSE
    RAISE WARNING
      'storage schema not found — skipped bucket/policies. Is Supabase Storage enabled on this project?';
  END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- Verify (optional — paste in the SQL Editor after running the file):
--
--   select policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like '%photo%'
--   order by policyname;
--
-- Expected: 4 rows — Public read (SELECT), Members upload (INSERT),
-- Members overwrite (UPDATE), Members delete (DELETE).
-- ----------------------------------------------------------------------------
