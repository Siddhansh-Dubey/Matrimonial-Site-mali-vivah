-- ============================================================================
-- Mali Vivah · Phase 1 — enum vocabulary
-- Migration 1 of the Phase 1 completion pass.
--
-- WHY THIS IS ITS OWN FILE
--   PostgreSQL allows `ALTER TYPE … ADD VALUE` inside a transaction block
--   (PG12+), but the NEW value cannot be *used* in that same transaction —
--   doing so raises `unsafe use of new value of enum type`. The Supabase SQL
--   Editor and `supabase db push` both wrap a file in one transaction, so every
--   enum value added here is only *consumed* by the later migration files.
--   Do not merge this file into another one.
--
-- WHAT IT ADDS
--   profile_status  += 'suspended', 'expired'
--       The PRD lifecycle mapped onto the enum that already exists:
--         draft          → DRAFT          (registration incomplete)
--         pending_review → PENDING        (awaiting verification/approval)
--         hidden         → APPROVED_FREE  (approved but free, so not public)
--         active         → ACTIVE_PAID    (paid, complete, publicly listed)
--         suspended      → SUSPENDED      (disabled by an admin)
--         expired        → EXPIRED        (membership lapsed, profile hidden)
--         rejected       → (kept for admin rejections)
--       No parallel status system is introduced — the existing column is
--       extended so there is exactly one source of truth.
--
--   photo_kind              — profile photo vs. the now-mandatory family photo
--   family_type             — joint / nuclear
--   lifestyle_choice        — never / occasionally / regularly (smoking, drinking)
--   notification_type       — every event the navbar bell reports
--   payment_status          — Razorpay order → capture → refund lifecycle
--   report_reason / _status — Report Profile
--   moment_media_type       — Mali Moments (24-hour stories)
--   verification_type / _status — mobile / photo / ID verification
--   membership_tier         — free / smart / premium / vip
--   boost_status            — Profile Boost lifecycle
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: every ADD VALUE is guarded by an existence check.
-- DEPENDS ON 20260911000000_matrimony_profiles.sql (creates profile_status).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Extend public.profile_status
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'profile_status' AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = 'suspended'
  ) THEN
    ALTER TYPE public.profile_status ADD VALUE 'suspended';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'profile_status' AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = 'expired'
  ) THEN
    ALTER TYPE public.profile_status ADD VALUE 'expired';
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- 2. New enum types (guarded, so this file stays idempotent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'photo_kind' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.photo_kind AS ENUM ('profile_photo', 'family_photo');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'family_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.family_type AS ENUM ('joint', 'nuclear');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifestyle_choice' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.lifestyle_choice AS ENUM ('never', 'occasionally', 'regularly');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.notification_type AS ENUM (
      'interest_received',
      'interest_accepted',
      'interest_declined',
      'profile_viewed',
      'new_matches',
      'new_moment',
      'package_expiring',
      'boost_expiring',
      'profile_verified',
      'payment_received',
      'admin_message'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.payment_status AS ENUM (
      'created', 'authorized', 'captured', 'failed', 'refunded', 'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_reason' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.report_reason AS ENUM (
      'fake_profile', 'incorrect_information', 'inappropriate_content',
      'harassment', 'spam', 'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.report_status AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'moment_media_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.moment_media_type AS ENUM ('photo', 'video');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.verification_type AS ENUM ('mobile', 'photo', 'id_document');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'rejected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_tier' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.membership_tier AS ENUM ('free', 'smart', 'premium', 'vip');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'boost_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.boost_status AS ENUM ('active', 'expired', 'cancelled');
  END IF;
END
$$;
