-- ============================================================================
-- Mali Vivah · Platinum Launch Offer — enum vocabulary (1 of 2)
--
-- WHY THIS IS ITS OWN FILE
--   PostgreSQL forbids *using* an enum value in the same transaction that
--   created it (`unsafe use of new value of enum type`), and both the SQL
--   Editor and the test harness apply one file as one transaction. The value
--   added here ('platinum') is consumed by the NEXT migration
--   (20260920190000_platinum_launch_offer.sql), which seeds the promotional
--   Platinum packages. Same convention as 20260915000000_enum_extensions.sql
--   and 20260917000000_notification_enum_message_received.sql.
--   Do not merge this file into another one.
--
-- WHAT IT ADDS
--   membership_tier += 'platinum'
--       A PROMOTIONAL tier for the temporary launch offer only. It is NOT a
--       purchasable plan: the authoritative paid price list stays
--         SMART   ₹  999 /  90 days
--         PREMIUM ₹2,499 / 180 days
--         VIP     ₹4,999 / 365 days
--       and no Platinum package is ever offered for sale (the promotional
--       package rows created by the next migration are is_active = FALSE and
--       price_inr = 0, so neither checkout nor manual activation can use
--       them — activate_membership() rejects inactive packages).
--       The legacy retired 'platinum-12-month' row keeps its tier = 'vip'
--       mapping from migration 9 and is untouched.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: the ADD VALUE is guarded by an existence check.
-- DEPENDS ON 20260915000000_enum_extensions.sql (creates membership_tier).
-- ============================================================================


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'membership_tier' AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = 'platinum'
  ) THEN
    ALTER TYPE public.membership_tier ADD VALUE 'platinum';
  END IF;
END
$$;
