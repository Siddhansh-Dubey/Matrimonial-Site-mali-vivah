# Step 13 — evidence, migration ledger and reproducibility

Companion to [the acceptance report](step13-phase1-audit.md). Audited baseline: `73fa235ed2be065159511ea157b31060ab4c2851`. M37 is the limited correction added by this audit, not a claim that it existed in PR #33.

## 1. Chronological migration ledger

All paths below are under `supabase/migrations/`. This order was executed, not inferred from table names. The final database catalog (policies/grants/functions/indexes) was inspected after application. Historical replacements are not simultaneously active overloads unless signatures differ.

| ID | Exact filename | Actual role / final-state review |
|---|---|---|
| M01 | `20260910000000_auth_profiles.sql` | Profiles/login history, signup/sync/login triggers, own-profile grants/RLS. Whole-row INSERT/UPDATE and future-added protected fields need enforcement; M34/M37 address specific bypasses. |
| M02 | `20260911000000_matrimony_profiles.sql` | Profile/photos/preferences/interests/shortlists/views schema, owner/public RLS, first search RPC, **public** profile-photos bucket. Later RPCs replace search. Member DELETE/reinsert and broad interest UPDATE survive until M37. |
| M03 | `20260911120000_repair_missing_profiles.sql` | Existing account repair/backfill, replacement handle_new_user, ensure_my_profile. Historical recovery path, not a duplicate public product. Keeps phone uniqueness from breaking signup. |
| M04 | `20260911130000_photo_storage_policies.sql` | Adds folder-scoped upload/update/delete; reasserts **unrestricted bucket read**. Skipped by stock PGlite harness without storage schema. Critical media privacy review item S04. |
| M05 | `20260912000000_packages_mutual.sql` | Packages/subscriptions, paid detail/contact/mutual functions, old Silver/Gold/Platinum seeds. Later M09 retires seeds; later M11/M34/M35 supersede visibility/contact. |
| M06 | `20260912130000_public_profile_browse.sql` | Anonymous-safe browse/profile payloads, caller-dependent masking. Later RPC definitions replace it. |
| M07 | `20260915000000_enum_extensions.sql` | Membership/payment/notification/safety/engagement enums. Separate migration before use avoids enum-in-same-transaction hazards. New-match/Moment enum values alone do not implement delivery. |
| M08 | `20260915010000_profile_model_family_photo.sql` | Community/sub-community tables/data, family/lifestyle/preferences/photo-kind additions, publish photo requirements. Community integrity strengthened by M27. |
| M09 | `20260915020000_packages_pricing.sql` | Canonical Smart 999/90, Premium 2499/180, VIP 4999/365, benefits and tier RPCs, old package retirement. Replay resets editable canonical package values; not an operations “repair” to run after admin customization. |
| M10 | `20260915030000_notifications.sql` | Notifications table, least-privilege owner read-state, service push RPC, interest and view triggers. No new_matches/new_moment producer; no re-pending notification. |
| M11 | `20260915100000_visibility.sql` | Central live membership/public/publish gate, visibility explanation, global/self sweeps. Live timestamps remain authority. Self-sweep later coexists with newer global sweep and can suppress its notifications. |
| M12 | `20260915110000_payments.sql` | Payments/activity/subscription link, original activation/refund/stale-cancel RPCs. Service authority retained and hardened by M36. No provider integration test just from this SQL. |
| M13 | `20260915120000_safety_interests.sql` | Blocks/reports/deletion requests, express-interest RPC, no member interest INSERT, receiver/sender UPDATE RLS, blocked read/view protection. Raw reports INSERT remains open; interest columns only narrowed in M37. |
| M14 | `20260915130000_engagement_admin.sql` | RBAC/audit, matching config/engine, boosts, featured, verification/private docs, Moments, success stories; advanced search/detail. Many later replacements. Moments default expiry is not an immutable policy. |
| M15 | `20260915140000_activity_login_register.sql` | Real registration/login activity triggers and record_login replacement. Client-callable record_login can record calls, not independently prove provider login. |
| M16 | `20260917000000_notification_enum_message_received.sql` | Chat event enum split before use. Not a separate notification subsystem. |
| M17 | `20260917010000_chat.sql` | Conversations/members/messages, RPC-only writes, paid/mutual/block gates, unread/read state, notification trigger, conditional Realtime publication. Active extra scope; managed publication not tested. |
| M18 | `20260918000000_success_stories_submissions.sql` | Paid/consented pending submission RPC and submission metadata/RLS. App now uses a duplicated service server-action insert. submitted_by SET NULL retains published story text after account deletion. |
| M19 | `20260919000000_mobile_otp_verification.sql` | OTP request audit/cooldown, completion function. API provider check was bypassable through authenticated completion grant; replaced in M37. |
| M20 | `20260919010000_boost_purchases.sql` | Boost config, payment kind, original purchase/refund functions. Later entitlement ledger and M36 are final authority. |
| M21 | `20260919020000_site_content_whatsapp.sql` | Editable content/config RPCs, service writes, guarded WhatsApp format, seeded placeholder support number. Configurability is not a tested actual community invite. |
| M22 | `20260919030000_moment_reports_activity.sql` | Report target extension, report_moment, moment-posted trigger. **Replay hazard:** `UPDATE reports SET target_type='profile' WHERE target_type IS DISTINCT FROM 'profile'` would relabel real Moment reports on rerun. Do not rerun historical file as idempotent maintenance. |
| M23 | `20260919040000_activity_completeness.sql` | More activity hooks and payload/contact details; later definitions supersede portions. This is logging, not missing notification delivery. |
| M24 | `20260919050000_whatsapp_optin_gate.sql` | Adds profile opt-in to gated WhatsApp payload; latest M35 preserves it. Community CTA is a different concept. |
| M25 | `20260919060000_boost_entitlements.sql` | Configured duration helper, entitlement identity/backfill, quota/purchase/admin grant/refund/sweep fixes. BOOST explicitly exercises historical backfill; M30/M36 replace selected functions. |
| M26 | `20260919070000_profile_views_access.sql` | Aggregate vs named-view entitlements, views RLS/stats/free benefits. Preserved by current code. |
| M27 | `20260919080000_community_hierarchy_integrity.sql` | DB hierarchy normalization/validation, public/search linkage. No UI hardcoded community source needed. |
| M28 | `20260919090000_profile_business_name.sql` | Separate business_name and payload support (not company rename). BUS tests schema/edits/payload; latest profile RPC preserves field. |
| M29 | `20260919100000_search_lifestyle_filters.sql` | Search adds smoking/drinking; removes legacy smaller signatures to avoid overload ambiguity. Latest M32 preserves advanced gates. |
| M30 | `20260919110000_activity_tracking_analytics.sql` | Canonical events/dedupe/scrubbing, lifecycle triggers, global expiry events, admin analytics; latest M36 replaces payment/activity functions. Legacy log_account_deletion remains callable. |
| M31 | `20260919120000_admin_member_management.sql` | Holds/suspension bookkeeping, public gate, guarded actor/member-action RPCs, filters/restore/deletion. Later M35 removes broad profile read; M37 prevents owners undoing bookkeeping. |
| M32 | `20260920000000_featured_boost_ordering.sql` | Final featured curation order and search boost/recency order; no implicit boost→featured. No package-priority recommendation behavior. |
| M33 | `20260920120000_daily5_candidate_limit.sql` | Final D5 limits candidate rows before aggregate, caller cannot raise configured count; threshold/ranking intact. No scheduled match delivery. |
| M34 | `20260920130000_verification_trust_safety.sql` | Verification UPDATE guards, pending request INSERT restriction, blocked reads, report/block/admin trust RPCs. Missing INSERT/alternate-write boundaries exposed by this audit. |
| M35 | `20260920140000_privacy_account_lifecycle.sql` | Anonymize/detach before delete, retained FKs, owner-only profile reads, privacy/contact/PDF-support payloads, Moment author filtering. Storage byte access not changed; photo metadata listing lacks membership check. |
| M36 | `20260920150000_payment_membership_lifecycle_audit.sql` | Webhook ledger, snapshot/status/link validation, locked idempotent activation/refund, inactive-account protection, service-only log_activity. Baseline latest reapply succeeds in both modes. |
| M37 | `20260920160000_audit_authorization_boundaries.sql` | **This PR only:** interest UPDATE(status), service-only bound OTP completion, invoker guards for direct member state/INSERT, no member profile DELETE/replacement. 32 additional checks, final latest reapply succeeds. |

### Catalog / policy / index / type conclusions

- **No duplicate migration filenames or identical full SQL files** were found. Many CREATE OR REPLACE bodies intentionally supersede older behavior; do not delete historical migrations to deduplicate their text.
- Fresh chronological application passed in multi-statement and explicit per-file transactions. M07/M16 enum split is significant. Optional Storage and Realtime blocks were not tested by that execution.
- A final `pg_proc` identity-argument query showed **no duplicate function names / live overloads** in this migrated database. In particular search_matches has the extended 16-argument signature and log_activity the current four-argument signature; obsolete overloads were dropped. M37 removes the old zero-argument OTP function, not merely adding a second callable overload.
- Final `pg_policies` inspection confirmed broad owner profile writes and raw report/Moment INSERT surfaces, rather than assuming earlier restrictive policies replaced everything. PostgreSQL permissive policies are OR-combined: a new safe RPC does not revoke an old table policy.
- **No exact duplicate indexes** (same table/key/order/predicate/uniqueness after ignoring index name) were found. Some prefix overlap exists (e.g. notifications_user_unread_idx vs notifications_user_recent_idx), but serves different unread/recent queries. Index removal needs real EXPLAIN/workload/write-cost evidence, not name similarity. No indexes removed.
- Catalog-vs-TypeScript inspection found **no missing/extra public table Row fields or nullability mismatches**, no missing public table type, and no typed function name absent from the migrated database. These are useful checks, not proof all JSON response shapes, enum semantics, argument optionality or deployed schema match. The file is handwritten; there is no checked-in generate-types/CI drift gate. M37's OTP Args type was updated to match its new signature.
- TypeScript `Insert`/`Update` types are not an authorization policy. They historically permit protected fields and cannot substitute for grants/triggers. M37 enforces boundaries in SQL regardless of client type assertions.
- New corrective migrations are still needed for protected storage/media references/lifetimes, report INSERT authority, expiry-event unification, internal moderation-note privacy and age policy. Apply forward fixes, not edits/reruns of history.
- **Historical idempotency caveats:** M22 destroys Moment target classification if replayed after real Moment reports; M09 resets admin-customized prices/copy; reapplying earlier function definitions after hardening can reopen vulnerabilities. The README “safe to re-run” language must not be read as “run arbitrary old migrations against current production.”
- Harness has a minimal role/auth shim, not Supabase's managed default table/sequence grants. Many application server paths use direct service table queries; most DB tests instead call SECURITY DEFINER or seed as superuser. Verify actual service grants/PostgREST policies on staging, not just the shim.

## 2. Targeted baseline reproductions and post-fix expectations

All probes used fresh PGlite databases migrated from repository SQL, with synthetic `@example.test` members. No live account/data was queried. `asUser` sets JWT claim and SET ROLE authenticated; `asService` sets service_role. Use these helpers from `mv-db-tests/lib/harness.mjs`. Baseline cases below were run **before M37**; do not run historical vulnerable migrations backwards on a live database to reproduce them.

| Probe | Actual baseline outcome | Final expectation/evidence |
|---|---|---|
| Authenticated complete_mobile_otp_verification() with mobile but no request/provider | `{ "ok": true }`; mobile_verified became true | No-arg function absent; new function permission denied to member/anon; AUTHZ |
| Paid complete suspended/held member directly sets status active and admin_hidden_at null | Update succeeds, is_profile_public=true | PROTECTED_PROFILE_STATE; AUTHZ |
| Inactive member directly sets profiles.is_active=true | Update succeeds | PROTECTED_ACCOUNT_STATE; AUTHZ |
| Receiver B changes sender A to C and marks accepted | UPDATE succeeds; get_profile_contact(C) returns C's synthetic mobile despite no C consent | Column UPDATE permission denied; no C contact; legitimate A acceptance still works; AUTHZ |
| Member deletes own matrimony row, reinserts verified_at=now() | INSERT succeeds despite UPDATE verification guard | DELETE revoked; even missing-row INSERT with verified_at rejected; AUTHZ |
| New missing-profile INSERT grants is_admin/mobile_verified | Old UPDATE-only protection has no INSERT authority | M37 rejects both; genuine missing-row repair succeeds; AUTHZ |
| Blocked receiver accepts a pre-block interest | Zero rows updated due blocked SELECT policy | Still zero after M37; AUTHZ |

**Key consent-forgery sequence used in the isolated baseline:** create three complete paid profiles A/B/C; A expresses interest in B; as B, UPDATE that row's sender_id to C and status to accepted; as B, call get_profile_contact(C). Original UPDATE RLS constrained only the unchanged receiver and new status, so the mutual-contact RPC trusted fabricated evidence. This is why changing UI buttons would not fix it.

**M37 trust design:**

- Interest participant IDs/message/timestamps cannot be changed via authenticated UPDATE; only status is granted. Trusted express_interest definer RPC still updates the fields needed for its legitimate resend/mutual path.
- OTP completion accepts `(p_user_id UUID, p_mobile TEXT)` only for service_role, locks an active profile, matches its current mobile, requires a same-number outstanding request in the previous 10 minutes, then records verification/notification/activity. The service must only call it after provider verification; it is not an independent SMS validator.
- `guard_direct_member_state` is deliberately **SECURITY INVOKER**: direct PostgREST writes run as authenticated; trusted definer lifecycle functions run as their owner. Making this trigger SECURITY DEFINER would erase the identity distinction. Existing UPDATE verification/admin guards remain; new INSERT protection fills their gap.
- Revoking member DELETE on matrimony_profiles blocks a delete/recreate moderation reset; account deletion still executes through the trusted existing RPC and Auth cascade.
- Regression suite tests both denial paths and normal acceptance, notifications, repair, editing and self-deletion. Existing 12 suites continue unchanged.

## 3. Open finding reproductions (after M37)

These were independent diagnostic probes, not labelled passing acceptance tests:

| Probe | Observed output | Finding |
|---|---|---|
| As own reporter INSERT reports(status='resolved', valid other reported_id) | `{ "status": "resolved" }` | S06 raw INSERT bypass remains |
| Expire B's subscription without sweep; is_profile_public(B) | `false` | Main expiry gate works |
| As A SELECT count(*) profile_photos for B above | `1` (profile photo, not family metadata) | S07 unswept expired-photo metadata gap |
| Expire subscription → sweep_my_membership as owner → sweep_expired_memberships as service → count expiry notification | `0` | N02 self-sweep consumes the global event transition |
| As owner SELECT admin_hidden_reason after admin/service sets it | `Internal moderation note` | S08 comments/UI do not make notes admin-only |
| As owner INSERT moment with a foreign storage_path and expiry now()+100 years | `over_24h: true` | S14 default does not constrain INSERT |
| Change complete active profile DOB to current_date-1 | status `active`; is_profile_public `true` | S10 no adult-age threshold |
| FormData append is_active=false then is_active=true, then get('is_active') | `false`, while getAll returns `['false','true']` | P01 admin package and success-story hidden+checkbox parsing |

Storage S04 is based on actual bucket/policy/application URL inspection, **not a claimed live HTTP download**. The default public URL is synthesized in `src/lib/profile/photos.ts`, profile/family/Moment files all use that bucket, and no later migration privatizes it. Strong DB row privacy cannot protect an object served by a public bucket path.

## 4. Test results retained in compact form

Requested commands were run against the baseline, then again after the critical changes:

```text
Baseline:
  npm run typecheck: exit 0
  npm run lint: exit 0 — No ESLint warnings or errors
  npm run build: exit 0 — Next.js 14.2.5
  36/36 migrations applied (multi mode)
  36/36 migrations applied (tx mode)
  newest migration re-applied twice successfully
  12 suites: 1060 passed, 0 failed

Final:
  npm run typecheck: exit 0
  npm run lint: exit 0 — No ESLint warnings or errors
  npm run build: exit 0 — Next.js 14.2.5
  37/37 migrations applied (multi mode)
  37/37 migrations applied (tx mode)
  newest migration re-applied twice successfully
  activity: 63 passed, 0 failed
  admin-members: 236 passed, 0 failed
  audit-authorization: 32 passed, 0 failed
  boosts: 156 passed, 0 failed
  business-name: 62 passed, 0 failed
  community: 56 passed, 0 failed
  daily5: 73 passed, 0 failed
  featured-boost-exposure: 101 passed, 0 failed
  payment-membership-lifecycle: 93 passed, 0 failed
  privacy-lifecycle: 80 passed, 0 failed
  profile-views: 54 passed, 0 failed
  search-lifestyle: 39 passed, 0 failed
  verification-trust-safety: 47 passed, 0 failed
  All database checks passed. Total: 1092.
```

Two AUTHZ checks read OTP route source to confirm wiring; all remaining new checks execute SQL behavior/privilege assertions. Neither those source checks nor typecheck execute GoTrue.

Re-run:

```sh
npm ci
npm run typecheck
npm run lint
npm run build
cd mv-db-tests
npm ci
npm test
# focused critical-boundary regressions:
npm test -- audit-authorization
```

Root npm does not define a general `test` script. The database harness is the complete existing behavior suite, not an undiscovered frontend test runner.

## 5. Dependency audit supplement

`npm audit --omit=dev --json` was additionally executed. The registry response reports six affected production-dependency entries:

| Package | Reported severity |
|---|---|
| next (installed 14.2.5) | critical |
| postcss (transitive production dependency) | high |
| @supabase/auth-js | low |
| @supabase/ssr | low |
| @supabase/supabase-js | low |
| cookie | low |

Examples returned for Next include **GHSA-f82v-jwr5-mffw** (middleware authorization bypass) and Server Components/Server Actions denial-of-service advisories. Applicability depends on runtime/configuration; no exploit attempt against deployed infrastructure was made. The app's server actions/RPCs separately check admin authorization, so do not assert the advisory alone grants admin. Dependency remediation requires a tested supported-version upgrade, not a claim that `npm run build` cleared security warnings. Lockfiles were not changed.

## 6. Source/reference scan methodology

- Enumerated every tracked `src/app` page/API and component/library, every migration, test file and both README documents.
- Traced real callers for the feature matrices; collected final function definitions by migration order, then inspected the actual migrated catalog to avoid confusing historical text with final authority.
- Searched source/SQL/tests/docs for legacy prices/packages, shortlist/connection request, TODO/FIXME/debug logging, demo/placeholder statistics, hardcoded counts/durations/communities, excluded product scopes and env/secret usage. Did not print or store credentials.
- Compared component module import paths to all other source files; `ComingSoon` had none. Confirmed `maskedText`, `maskDots`, unused env Razorpay helper by symbol reference search. Preserved intentional redirect routes and differently purposed components.
- Checked app route tree and build output for linked missing legal pages; did not equate a working compile with HTTP/device acceptance.
- Compared parsed `Database.public.Tables.*.Row` fields/nullability against information_schema; compared typed function names against pg_proc; checked live function-name duplication and exact normalized index definitions. JSON payload contracts and hosted drift remain separate test needs.

No blanket “all code is secure” or “every requirement is complete” conclusion is supported by this audit.
