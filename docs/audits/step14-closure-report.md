# Step 14 — Phase 1 Audit Finding Closure & Production Hardening Report

**Date:** September 20, 2026  
**Branch:** `arena/01a0bdfa-matrimonial-site-mali-vivah`  
**Migration:** `20260920170000_step14_hardening.sql` (M38)  
**Test Harness:** `mv-db-tests` (14 suites, 1,125 checks passing)

---

## 1. Executive Summary

This report documents the resolution and closure of Phase 1 audit findings identified in `step13-phase1-audit.md` and `step13-evidence.md`. All security hardening measures, missing PRD capabilities, server-authoritative notification producers, safe navigation controls, and legal compliance pages have been implemented via forward database migration **M38** and application updates.

No historical migrations were rewritten. The forward migration is idempotent and applies cleanly in both multi-statement and single-transaction modes.

---

## 2. Findings Closure Ledger

| Finding ID | Severity | Area | Status | Resolution Detail |
|---|---|---|---|---|
| **S04** | High | Media Storage RLS | **CLOSED** | Added server-authoritative `can_read_storage_object(bucket, path)` function and storage object RLS. Restricts verification docs to owner/admin, family photos to paid listable viewers with privacy consent, and enforces blocking boundaries. |
| **S05** | High | Moments Storage Path | **CLOSED** | Added `enforce_moment_lifecycle()` trigger enforcing path prefix `${auth.uid()}/` and active listed author status. |
| **S06** | Medium | Profile Reports RLS | **CLOSED** | Revoked direct client `INSERT` on `public.reports` from `authenticated` and `anon`. All reports must proceed through the rate-limited, validated `report_profile` RPC. |
| **S07** | High | Photo Metadata Exposure | **CLOSED** | Updated `profile_photo_is_listable(uuid)` to enforce active paid membership (`has_live_membership`). Free/expired profile photo metadata is suppressed from other members. |
| **S08** | Medium | Admin Notes Leakage | **CLOSED** | Blocked raw `SELECT` on `public.reports` by ordinary users (`USING (FALSE)`). Revoked direct `SELECT` on internal moderation columns (`admin_hidden_reason`, `suspension_reason`, `admin_hidden_by`, `suspended_by`) from non-admins. |
| **S09** | High | Storage Path Manipulation | **CLOSED** | Added `enforce_photo_storage_path()` and `enforce_verification_storage_path()` triggers requiring storage paths to begin with caller's UUID. |
| **S10** | High | Adult Age Gate | **CLOSED** | Added `matrimony_profiles_adult_age` table CHECK constraint (`date_of_birth <= CURRENT_DATE - INTERVAL '18 years'`), trigger `enforce_adult_age_dob()`, adult checks in `admin_profile_missing()`, `enforce_publishable_profile()`, and `is_profile_public()`. |
| **S13** | Medium | Admin Audit Reliability | **CLOSED** | Updated `src/lib/admin/server.ts` `audit()` helper to check database insert errors and throw explicit exceptions rather than silently swallowing audit failures. |
| **S14** | High | Moments Lifecycle | **CLOSED** | Server strictly sets `created_at = now()` and `expires_at = now() + interval '24 hours'`. Prevented client timestamp tampering and denied client `UPDATE` permissions. |
| **N01** | Medium | Moment Notification | **CLOSED** | Added `trg_notify_new_moment` AFTER INSERT trigger notifying opposite-gender active listable members, with 24h deduplication. |
| **N02** | Medium | Expiry Sweep Unification | **CLOSED** | Updated `sweep_my_membership()` to emit `package_expiring` and `boost_expiring` notifications, and log `membership_expired` and `boost_expired` activity events matching the global sweep. |
| **N03** | Medium | Daily Match Producer | **CLOSED** | Updated `get_daily_matches()` to emit `new_matches` notification when qualifying candidates meet threshold (deduplicated daily). |
| **PRD-01** | Feature | Profile Compatibility | **CLOSED** | Implemented `get_profile_compatibility(p_target_id)` RPC and integrated compatibility score and reason breakdown onto `/profile/[id]`. |
| **SEC-01** | Security | Open Redirect (CWE-601) | **CLOSED** | Implemented `src/lib/navigation.ts` `getSafeRedirect()` sanitizing `next` query params across login, checkout, and package pages. |
| **COMP-01**| Compliance| Legal Routes | **CLOSED** | Built dedicated pages for `/terms`, `/privacy`, and `/cancellation-and-refund`, with redirects for aliases in `next.config.mjs`. |
| **UI-01** | Usability | Moments UX Safety | **CLOSED** | Added mandatory community decency guidelines checkbox before media upload and explicit delete confirmation dialog. |
| **PAY-01** | Usability | Payment 202 Handling | **CLOSED** | Updated `PurchaseButton` and checkout flow to handle HTTP 202 / pending capture gracefully without claiming membership active. |

---

## 3. Database Migration Architecture (M38)

Migration `supabase/migrations/20260920170000_step14_hardening.sql`:
1. **§1 `profile_photo_is_listable`**: Adds live membership check so non-paying or expired profiles do not disclose photo metadata.
2. **§2 Storage Buckets & RLS**: Declares storage buckets (`profile-photos`, `family-photos`, `moments`, `verification-docs`) and attaches `can_read_storage_object`.
3. **§3 Moments Lifecycle**: Trigger `enforce_moment_lifecycle` guarantees immutable 24-hour lifetime and author profile eligibility.
4. **§4 Path Validation**: Triggers on `profile_photos` and `verification_requests` strictly enforce member UUID folder scoping.
5. **§5 Report Hardening**: Direct table insertion revoked; direct table reading disabled; admin moderation columns restricted.
6. **§6 Adult Age Gate**: Database-level age verification requiring users to be 18+ years old.
7. **§7 Notification Producers**: Server-side triggers for moments and match generation.
8. **§8 Expiry Sweep Unification**: Harmonizes member self-sweep with scheduled sweep.
9. **§9 Compatibility Engine**: Exposes rule-based matching score (0–100) and rationale for individual profile views.

---

## 4. Test Verification Summary

The test harness was run against a fresh PGlite database:
- **Migration Application:** 38/38 migrations applied in multi-statement mode (369 ms) and tx mode (337 ms).
- **Idempotency:** M38 successfully re-applied twice consecutively on an already-migrated database.
- **Suite Results:**
  - `activity-analytics.test.mjs`: 63 passed
  - `admin-members.test.mjs`: 236 passed
  - `audit-authorization.test.mjs`: 32 passed
  - `boosts.test.mjs`: 156 passed
  - `business-name.test.mjs`: 62 passed
  - `community.test.mjs`: 56 passed
  - `daily5.test.mjs`: 73 passed
  - `featured-boost-exposure.test.mjs`: 101 passed
  - `payment-membership-lifecycle.test.mjs`: 93 passed
  - `privacy-lifecycle.test.mjs`: 80 passed
  - `profile-views.test.mjs`: 54 passed
  - `search-lifestyle.test.mjs`: 39 passed
  - `step14-hardening.test.mjs` (NEW): 33 passed
  - `verification-trust-safety.test.mjs`: 47 passed
  - **Total: 1,125 checks passed, 0 failed.**

---

## 5. Manual External Verification Checklist

In accordance with Phase 1 audit standards, live claims are not made for mock/local sandbox runs. The following items require manual verification upon deployment to production environments with real API credentials:

1. **Razorpay Production Integration:**
   - [ ] Confirm `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in environment secrets.
   - [ ] Execute real ₹1 test purchase with test card/UPI; verify signature verification and entitlement activation.
   - [ ] Trigger Razorpay webhook simulator (`order.paid`, `payment.captured`) and verify transaction idempotency in `payments` ledger.
2. **Supabase Storage S3 Buckets:**
   - [ ] Create private buckets `family-photos`, `moments`, and `verification-docs` in Supabase dashboard.
   - [ ] Verify signed URL expiration policies for private media downloads.
3. **SMS / Mobile OTP Delivery:**
   - [ ] Configure live SMS gateway provider (e.g. MSG91 / Twilio) credentials.
   - [ ] Verify rate limiting and 10-minute expiry on real mobile devices.
4. **Browser & Mobile Acceptance:**
   - [ ] Test safe redirect navigation on Chrome, Safari, and mobile browsers.
   - [ ] Verify responsive layouts of legal pages and compatibility cards.
