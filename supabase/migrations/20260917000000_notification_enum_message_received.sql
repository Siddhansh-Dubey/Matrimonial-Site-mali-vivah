-- ============================================================================
-- Mali Vivah · In-app messaging — notification vocabulary
-- Migration 16 of the pass. MUST be applied before 20260917010000_chat.sql.
--
-- WHY THIS IS ITS OWN FILE
--   Same reason as 20260915000000_enum_extensions.sql: PostgreSQL allows
--   `ALTER TYPE … ADD VALUE` inside a transaction block (PG12+), but the NEW
--   value cannot be *used* in that same transaction — doing so raises
--   `unsafe use of new value of enum type`. The Supabase SQL Editor and
--   `supabase db push` both run a file as one transaction, and the chat
--   migration inserts notifications of this type. So the value is added here
--   and consumed by the next file. Do not merge this file into another one.
--
-- WHAT IT ADDS
--   notification_type += 'message_received'
--     One new event for the existing navbar bell: a chat message arrived.
--     No new notification table, no parallel feed — the existing
--     `notifications` table, its column-level grants and its read-state RPCs
--     are reused exactly as they are.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: the ADD VALUE is guarded by an existence check.
-- DEPENDS ON 20260915000000_enum_extensions.sql (creates notification_type).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type' AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = 'message_received'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'message_received';
  END IF;
END
$$;
