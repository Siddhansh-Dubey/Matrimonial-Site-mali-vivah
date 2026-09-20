# Step 13 — Phase 1 PRD completion and codebase audit

**Audit date:** 2026-09-20 (UTC)  
**Baseline:** `73fa235ed2be065159511ea157b31060ab4c2851`, merge of PR #33, “Step 12: Razorpay and membership lifecycle production audit”.  
**Working branch:** `arena/01a0bde3-matrimonial-site-mali-vivah` (the session-fixed branch; not `arena/step13-phase1-audit`).  
**Disposition:** **Phase 1 acceptance is NOT established. Do not treat this as production sign-off.**

## Audit boundaries and evidence standard

The specification used is the Phase 1 requirement list and exact journeys supplied with the Step 13 request, together with `README.md` and `supabase/README.md`. There is **no standalone original PRD text/PDF in this checkout**: `Mali vivah related references/` contains six image references. Unavailable original-PRD details have not been invented. Where current documentation conflicts with running SQL, SQL and executable evidence establish implementation, not product intent.

This audit inspected routes, their callers, server actions, final RPC definitions, table grants, RLS, triggers, migration supersession, schema/type shape, state transitions and existing test bodies. Fresh databases were migrated in filename order. Additional **member-role direct-write probes** were run, not just UI checks. The appendices identify all migrations and record reproductions.

Definitions used throughout:

- **IMPLEMENTED:** there is an actual executable path, including UI/backend wiring. This alone does not mean secure or tested.
- **TESTED:** the named local checks actually ran. SQL behavior tests, source-text assertions, compilation and browser tests are different evidence.
- **LIVE VERIFIED:** exercised against deployed Supabase/Auth/Storage or Razorpay. **None was performed in this audit.** No credentials were integrated.
- **NOT IMPLEMENTED:** no operative path was found; a table, enum, icon or comment is not implementation.
- **VERIFIED** in the matrices means the stated local requirement is supported by inspected wiring and applicable executable local checks, **not live verification**.
- **PARTIALLY VERIFIED** means an implementation exists but has a demonstrated defect, missing segment, or materially incomplete coverage.
- **NEEDS LIVE/EXTERNAL TEST** means the essential remaining acceptance evidence depends on a provider/deployment/device, not merely compilation.
- **MISSING** and **OUT OF SCOPE / PRD CONDITIONAL** have their literal meanings.

### Limited changes made after establishing the baseline

The audit-first exception for critical defects was used **only** for confirmed authorization failures:

1. Prevent interest recipients rewriting participant IDs to fabricate consent and reveal another member's phone.
2. Remove the member-callable OTP completion RPC; use a service-only, member/number-bound completion after real provider verification.
3. Prevent direct owner writes clearing admin holds/suspensions or reactivating retired accounts.
4. Prevent replacement/INSERT paths forging verified/admin state; preserve legitimate missing-row repair and normal biodata edits.

Changes are in migration **M37**, `src/app/api/mobile-otp/verify/route.ts`, the corresponding RPC type, and `mv-db-tests/tests/audit-authorization.test.mjs`. Historical migrations were not rewritten. **Other findings below remain open.** In particular the media-storage exposure is not solved by these database fixes: it needs coordinated storage/data/application migration and hosted Storage acceptance testing, not an untested bucket toggle that breaks all photos.

No new product functionality, Platinum/free offer/demo, prices, credentials, dependency upgrade, or dead-code deletion was introduced. The historical retired `platinum-12-month` row is not the requested future Platinum product.

## Executive findings

- Most core journeys have real UI + SQL implementations. The repository is **not a set of placeholder tables**, but passing tests missed real bypasses.
- The baseline had critical contact-consent forgery, OTP-completion bypass and mutable moderation state. Narrow fixes now have local regression coverage; deployment is still required.
- **Open release blockers:** public family/Moment storage URLs, client-controlled Moment lifetime, incomplete deletion cleanup, unsafe package return URLs, and known-vulnerable locked dependencies. See F.
- **Missing paths:** new-match and new-Moment notification producers; compatibility on the individual profile page; four linked legal/information pages. No scheduled expiry runner is shipped.
- Packages seed the correct **₹999/90 days, ₹2,499/180 days, ₹4,999/365 days**. Some advertised benefits do not drive behavior.
- The suite does not run real authentication, provider HTTP, browser flows, production object storage, cron, or Realtime. Its verification-storage test reconstructs a policy rather than applying the production storage setup.

## A. PRD completion matrix

Paths below are relative to the repository root. **M01–M37** resolve to exact migration files in [the migration/evidence appendix](step13-evidence.md). Test abbreviations refer to `mv-db-tests/tests/<name>.test.mjs`: **AUTHZ** = `audit-authorization`; **PAY** = `payment-membership-lifecycle`; **PRIV** = `privacy-lifecycle`; **TRUST** = `verification-trust-safety`; **ADMIN** = `admin-members`; **D5** = `daily5`; **FEAT** = `featured-boost-exposure`; **VIEWS** = `profile-views`; **ACT** = `activity-analytics`; **BOOST** = `boosts`; **SEARCH** = `search-lifestyle`; **COMM** = `community`; **BUS** = `business-name`. “UI read” means inspected code, not browser execution.

| PRD Requirement | Relevant implementation | Backend | Frontend | Security | Tests | Status |
|---|---|---|---|---|---|---|
| Homepage | `src/app/page.tsx`, `src/components/home/*` | Featured/content/story RPCs and published-story reads | All seven sections wired; Featured disappears when empty | Contact-free card payloads; open media issue S04 | FEAT; UI read; no browser test | PARTIALLY VERIFIED |
| Registration | `components/auth/register-form.tsx`, `lib/auth/register-schema.ts`; M01/M03 | Supabase signUp → `handle_new_user`, draft/profile/preferences creation | Name/email/mobile/password/for-whom/terms; email confirmation flow | Own-row RLS; M37 INSERT protection; provider policy remains external | ACT/COMM exercise auth-table trigger, not GoTrue signup | NEEDS LIVE/EXTERNAL TEST |
| Login | `components/auth/login-form.tsx`, `app/login/actions.ts`, `/verify`, middleware | Email password; mobile resolved server-side then password auth; `record_login` | One identifier; safe login return path | `getUser` on protected paths; generic mobile error; provider rate limits external | ACT tests record_login; no real session/cookie test | NEEDS LIVE/EXTERNAL TEST |
| Profile / biodata | `/profile`, `/profile/edit`, `profile-wizard.tsx`, `/api/biodata/[userId]` | `matrimony_profiles`, `partner_preferences`, publish trigger; gated PDF | Real multi-step persisted form, family/lifestyle/business fields, PDF | Owner RLS; DB hierarchy validation; no adult-age gate (S10); PDF uses privacy flags | BUS/COMM/PRIV/ADMIN; PDF rendering not executed | PARTIALLY VERIFIED |
| Profile photo | Wizard `onUpload`, `lib/profile/photos.ts`; M02/M04 | Folder-scoped writes, `profile_photos` | Upload, primary choice, removal | **Public bucket** and expiry metadata gap S04/S07 | DB metadata fixtures only; no hosted object test | PARTIALLY VERIFIED |
| Family photo | Wizard family branch; M08/M35 | `kind='family_photo'`, required for publication | Upload/replace; paid profile display | Payload toggle works; file remains public (S04) | PRIV/TRUST test row/payload, not bytes | PARTIALLY VERIFIED |
| Partner preferences | Wizard preferences; M02/M08/M27; D5 RPC | Private owner preferences used in scoring | Persisted age/height/community/location/lifestyle preferences | Hierarchy trigger; no cross-owner writes | COMM/D5/BUS | VERIFIED |
| Free/paid visibility | `is_profile_public`, `enforce_publishable_profile`, `profile_visibility_reason`; M11/M31 | Free completion → hidden; live subscription + complete profile for listing | Visibility banner and upgrade CTA | M37 closes owner moderation bypass; media still public | PAY/PRIV/ADMIN/FEAT | PARTIALLY VERIFIED |
| Basic search | `/search`, `/brides`, `/grooms`, `lib/profile/browse.ts`; M32 `search_matches` | Server filters + bounded result list | Shared BrowseGrid and actual form parameters | Anonymous cap; masked free payload; block/public gates | SEARCH/FEAT/TRUST | VERIFIED |
| Filters | `components/search/lifestyle-filters.tsx`; M27/M29/M32 | Basic filters; advanced filters require benefit | Paid search controls, community DB choices | Advanced arguments are inert for ineligible callers | SEARCH/COMM | VERIFIED |
| Compatibility engine | M33 `get_daily_matches`, `matching_config`; `/matches` | Rule-based component weights, threshold, reasons | Score/reasons on Daily cards, **not `/profile/[id]`** | Public/unblocked candidates; no ML | D5 tests threshold/ranking/count, not all component mathematics | PARTIALLY VERIFIED |
| Daily 5 matches | `/matches`; M33 | Configured count (default 5), threshold, deterministic daily tie-break | Up to configured count, honest empty state | Cannot raise RPC limit above config; no padding | D5 73 checks; FEAT | VERIFIED |
| Interest system | `profile-actions.tsx`, `express_interest`; M13/M35 | Paid benefit, rolling 30-day quota, public target, block gate | Real Express Interest / upgrade restriction | M37 locks participant/timestamp writes; see N01 resend notification gap | ACT/TRUST/PAY/AUTHZ | PARTIALLY VERIFIED |
| Accept/decline | `/interests`, `interest-actions.tsx`, interest policies/triggers | Receiver accepted/declined; sender withdrawal | Actual DB update, refresh | Participant forgery fixed M37; blocked SELECT prevents response | ACT/AUTHZ; no browser failure UI test | VERIFIED |
| Contact reveal | `get_profile_contact`, `get_public_profile`, PDF; M35 | Paid + mutual/accepted + public target + no block | Phone / WhatsApp opt-in / biodata controls | Critical baseline forged-consent path fixed M37; no ungated email field | PRIV/TRUST/AUTHZ | VERIFIED |
| Profile views | `guard_profile_view`, `my_profile_view_stats`; `/profile/views` | View recording; count vs named-viewer entitlement | Stats and entitled viewer list | Owner stats; block filtering; real notification throttle | VIEWS 54; ACT | VERIFIED |
| Notifications | `notification-bell.tsx`; M10 and business triggers | Persistent own-user rows and exact unread RPC | Poll every 60 seconds; latest 15; mark read/all | No member INSERT; own reads and read-state writes | Partial ACT/TRUST/PAY coverage; dedicated feed tests absent | PARTIALLY VERIFIED |
| Packages | `/packages`, `fallbackPackages`; M09 | Correct DB-authoritative prices/days + benefits JSON | Live DB shop; negative-ID display fallback cannot buy | No client price authority; benefit/return-URL defects P01/S11 | PAY/BOOST/SEARCH/VIEWS | PARTIALLY VERIFIED |
| Razorpay checkout | `/api/payments/order`, `purchase-button.tsx`, `boost-card.tsx` | Server DB price snapshot, provider order, retry key | Standard Checkout script | Server-only secrets; S11 return URL; P02 pending-response UI | PAY is SQL only; API/browser not executed | NEEDS LIVE/EXTERNAL TEST |
| Automatic payment verification | `/api/payments/verify`, `/webhook`, `lib/payments/razorpay.ts` | HMAC, raw-body webhook, provider payment GET, amount/currency/order/owner checks | Handler posts provider result | Service-only activation; webhook event ledger; P03 delivery/retry gap | PAY tests DB identity/state; no HMAC/route execution suite | NEEDS LIVE/EXTERNAL TEST |
| Automatic membership activation | M36 `activate_membership` + verify/webhook callers | Transaction/advisory locks, one subscription per payment, publish gate | Shop refresh/visibility banner | Clients cannot insert subscription or call activation | PAY/ADMIN SQL success/retry/refund; provider not run | NEEDS LIVE/EXTERNAL TEST |
| Automatic expiry | `has_live_membership`, sweeps; M11/M30 | Read-time benefits/listing expire without cron | Retains biodata and offers renewal | SQL gate works; no shipped scheduler; lazy sweep loses expiry event N02 | PAY/ACT/PRIV time-shift tests | PARTIALLY VERIFIED |
| Admin panel / RBAC | `/admin/*`, `lib/admin/server.ts`, `app/admin/actions.ts` | `getUser` + `is_admin`; service-only mutations/RPC actor checks | Real modules, not button-only access control | M37 fixes alternate member state writes; notes leak S08 | ADMIN/TRUST/ACT; UI read | PARTIALLY VERIFIED |
| Mobile OTP | `/api/mobile-otp/{request,verify}`, VerificationCard; M19/M34/M37 | 60s / 5-per-hour request guard; actual Supabase OTP; new service-only completion | SMS request/code form | Baseline bypass fixed; exact phone binding, 10-minute request window | AUTHZ local denial/binding; **no SMS/provider test** | NEEDS LIVE/EXTERNAL TEST |
| Photo verification | VerificationCard, `/admin/verification`; M14/M34 | Pending selfie request → admin decision → badge/activity | Upload/queue/approve/reject | Private verification bucket, signed admin URLs; submission path not bound S09 | TRUST; storage test is synthetic | PARTIALLY VERIFIED |
| Optional ID verification | Same path, `type='id_document'` | Implemented optional request, not mandatory enrollment | Optional document upload + admin queue | Same limitations as photo; no automatic ID vendor | TRUST partial | PARTIALLY VERIFIED |
| Verified badge / admin status | M30/M34, profile/card `verified` fields | Approval or audited admin verify sets `verified_at` | Badge on real member cards | M37 closes INSERT replacement bypass; payment does not verify identity | TRUST/ADMIN/AUTHZ | VERIFIED |
| Reports | `report_profile`, `report_moment`, `/admin/reports` | RPC validation/dedupe/moderation | Member report dialogs and admin decisions | Direct report INSERT bypasses RPC restrictions (S06) | TRUST/ACT test intended RPC path | PARTIALLY VERIFIED |
| Block | `block_member`, `unblock_member`, `/profile/settings` | Symmetric gates on discovery/interests/contact/chat | Real report/block/unblock flows | Blocked API rows/contact denied; public media remains reachable | TRUST/AUTHZ/PRIV | PARTIALLY VERIFIED |
| Profile boost | `boost-card.tsx`, `/admin/boosts`, M25/M30/M36 | Package quota, standalone purchase, duration config, entitlement ledger/refund | Redeem or checkout, admin grant, indicator | Service purchase activation; quota and identity guarded | BOOST 156; FEAT 101; external purchase pending | PARTIALLY VERIFIED |
| Featured profiles | `get_featured_profiles`, homepage, `/admin/featured`; M32 | Explicit curation, position ordering, public/unblocked gate | Real profile cards, no fake fill | No boost→automatic-feature; package eligibility flag unused P01 | FEAT/ADMIN/TRUST | PARTIALLY VERIFIED |
| Mali Moments | MomentsRail on `/profile`, `moments`, `list_moments`, `/admin/moments` | Photo/video rows, default 24h, report/takedown/activity | Post/view/delete/report | Lifetime/path client-controlled; files public; no new-Moment notification | ACT/PRIV subset only | PARTIALLY VERIFIED |
| WhatsApp Community link | `whatsapp-register-sections.tsx`, `site-config.ts`, `/admin/whatsapp`; M21 | Admin-configured link and contact; validated domains | Community CTA or support fallback | No WhatsApp API automation; default number is placeholder | Source review; no configured link/provider test | NEEDS LIVE/EXTERNAL TEST |
| Basic analytics | `admin_analytics`, `activity_events`, `/admin/analytics`; M30/M36 | Actual DB counts, growth/revenue/activity ranges | Real KPIs, chart bars, filters | Admin gate and scrubbed metadata; recording losses N02; callable legacy log RPCs | ACT 63, PAY; not browser-tested | PARTIALLY VERIFIED |
| Mobile-first experience | Tailwind responsive home/forms/nav/admin and `globals.css` | N/A | Responsive classes/layouts exist | No claim of accessibility/device acceptance | No mobile browser or visual test | NEEDS LIVE/EXTERNAL TEST |
| Secure authentication | Supabase Auth, middleware, server auth checks | Auth handled by GoTrue; service actions reauthenticate | Real auth forms; no fake auth | No credentials found; vulnerable dependencies S12, storage/return-URL gaps | SQL identity shim only | PARTIALLY VERIFIED |
| Server-side authorization | All relevant RPCs/actions/policies cited above | Real RBAC/RLS + M37 correction | UI restrictions not relied on as authority | Remaining direct-write/media defects S04–S09/S11 | Negative SQL tests and new probes | PARTIALLY VERIFIED |
| Payment signature + webhook verification | Razorpay helper + both verify routes | HMAC comparison and raw request signature | No client activation | Fail closed when unconfigured; provider tests needed | Inspection only for cryptography/HTTP | NEEDS LIVE/EXTERNAL TEST |
| No public phone/email exposure | Public search/cards mask; contact RPC/PDF gate | Profiles table owner-only; no public email output | Phone shown only after gated result | Baseline consent bypass fixed; structured contact paths locally tested | TRUST/PRIV/AUTHZ | VERIFIED |
| Secure image storage | M04/M14; photoUrl; upload components | Profile bucket public, verification bucket private | Images/videos use public URLs | **Not acceptance-compliant for private/expired content** S04 | No real storage HTTP tests | PARTIALLY VERIFIED |
| Account deletion | `app/profile/actions.ts`, deletion card, M35/M36 | Hide/anonymize/detach → storage wipe → auth delete | Self and typed-confirm admin flow | No stale-payment resurrection in SQL; incomplete file cleanup S05 | PRIV/PAY/ADMIN/AUTHZ; no Auth/Storage API integration | PARTIALLY VERIFIED |
| Privacy settings | `/profile/settings`, privacy action/RPC, M35 | Allow-listed flags; own writes; PDF honors flags | About/family-description/photo/income/WhatsApp toggles | Family-photo bytes still public S04; malformed direct JSON not restricted to RPC | PRIV payload checks | PARTIALLY VERIFIED |
| Audit logs | `admin_audit_log`, activity triggers, `lib/admin/server.ts` | SQL admin audit; TS actions insert audit after mutation | Admin detail history/analytics | No client audit table write; TS audit error ignored (S13) | ADMIN/TRUST/ACT | PARTIALLY VERIFIED |
| Blocked users cannot interact | Interest SELECT/update, send/report/contact/chat gates | Main interaction paths deny blocked pairs | Block removes reachable profiles and contact | Public media not revoked; immutable interest fix preserves block gate | TRUST/AUTHZ | PARTIALLY VERIFIED |
| Family-photo privacy | M35 `get_public_profile` and PDF `show_family_photo` | Payload/metadata hidden | Toggle and display exist | Public bucket defeats content-access promise | PRIV + S04 source evidence | PARTIALLY VERIFIED |
| Actual notifications | Notification table/triggers/bell | Real events, not sample counts | Real unread badge | N01/N02 missing/unstable event delivery | ACT/TRUST/PAY subset | PARTIALLY VERIFIED |
| 24-hour story expiry | Default expires_at; list/RLS use now() | Default only, writable on INSERT; no media expiry | Rail loads once; no timed removal refresh | S04/S14 allow long-lived data/media | Residual direct-write probe; no duration test suite | PARTIALLY VERIFIED |
| No fake/demo statistics | Home, success-stories queries, admin analytics | Counts from real tables; no production demo users found | Honest story empty state; blurred example fields are placeholders, not members | Operator-entered stories still require truthful publication practice | ACT + home source review | VERIFIED |
| No manual admin activation for normal paid membership | Verify/webhook → activation; admin `manualActivate` separate | Normal capture automatically activates; recovery grants remain | Paid checkout does not require admin | Recovery service-only/audited; incomplete profiles do not bypass gate | PAY/ADMIN; external normal checkout pending | NEEDS LIVE/EXTERNAL TEST |

**Remaining dependencies:** items marked VERIFIED still need staging/browser deployment acceptance; their status is local evidence only. External rows require the explicit checklist in D. Partial rows depend on closing their named findings, not on simply adding credentials.

## B. Missing functionality (not merely untested)

1. **Daily/new-match notification producer:** `new_matches` exists in the enum and bell icon map, but no active function, trigger, job or app caller writes that event. D5 is fetched on page load, not delivered to the notification feed.
2. **New Mali Moment notification producer:** `new_moment` likewise has only enum/icon support. Posting creates activity, not a new-Moment notification to relevant members.
3. **Compatibility on individual profile view:** `/profile/[id]/page.tsx` does not call a compatibility RPC or display score/reasons. `/matches` does. Thus the requested “View profile → See compatibility” segment is absent, although the engine exists.
4. **Linked pages:** `/terms`, `/privacy`, `/cancellation-and-refund`, `/rules` are footer links without app routes or rewrites. Do not invent legal policy text as an audit fix.
5. **Repository-managed scheduled expiry execution:** there is no cron migration, scheduled API endpoint, CI workflow or worker calling the global expiry sweep. This is missing deployment wiring, **not** missing read-time expiry authorization. An externally configured job may exist, but this checkout cannot prove it.

No new Platinum/free-offer functionality is counted as missing Phase 1 work.

## C. Partially implemented / incorrect functionality

### Complete journey review

These are source/SQL journey reviews with named executable coverage, **not end-to-end browser executions**.

| Journey | Actual path and outcome | Remaining acceptance gap |
|---|---|---|
| FREE: register → login | Supabase signup, email confirmation `/verify`, password login/mobile resolver, DB profile trigger | Real confirmation redirect/session/SMS/rate limits not tested |
| Create biodata → profile photo → family photo → partner preferences | Wizard upserts actual tables, uploads actual Storage objects, DB community validation | Upload/storage runtime untested; private media is public; adult-age validation absent |
| Submit → remain hidden | Wizard submits `active`; complete free profile coerced to `hidden` by `enforce_publishable_profile` | Locally verified SQL; wizard save/draft/reload not browser tested |
| Browse paid → basic search → view profile | Public gate, masked free RPC payloads, /search and /profile/[id] | Known public-media gaps; arbitrary profile compatibility missing |
| See compatibility → Daily 5 | Compatibility only available on /matches cards; D5 free access works and does not pad | No push/new-match notification or persisted daily delivery; exact five not guaranteed if candidates insufficient |
| View Stories → notifications | `/profile` mounts MomentsRail; header mounts NotificationBell | S04/S14/N01/N02; no time-driven open-rail refresh |
| Try interest → correct restriction → upgrade | UI upgrade CTA and `PAID_MEMBERSHIP_REQUIRED` RPC guard; packages checkout path | Real checkout pending; not a UI-only paid gate |
| PAID: select → order → checkout → server verify → webhook | Real server routes use DB snapshot and signatures; service RPC auto-activates | HTTP/checkout/webhook not executed; P02/P03 below |
| Membership → public → searchable → recommendation eligible | Payment activation attempts publication; centralized public gate enforces complete profile/photos, status and expiry | Payment alone deliberately does not override suspension/hold or incomplete biodata |
| Express → recipient notification → accept → contact | RPC insert, trigger notification, receiver update, paid/mutual contact RPC | M37 fixes baseline forged consent; resending an old declined/withdrawn row misses “received” notification |
| EXPIRY: lose benefits → hide → no search/recs/send → retain biodata → renew | All read/benefit gates check timestamp even before sweep; renewal stacks remaining time | Lazy sweep can consume transition without expiry notification/activity; no scheduled global caller |
| SAFETY: report → block → no interaction/contact → preserved visibility | Report/block RPCs, symmetrical blocks, public payload/contact/chat enforcement | Direct report INSERT bypass; media still public; blocked interest response tested after M37 |
| DELETE: hide first → files → auth → retention → no stale webhook resurrection | M35 detaches financial/moderation links, wipes personal rows, M36 rejects activation for retired/missing account | Storage wipe best-effort/unpaginated; service/Auth API failure recovery untested; M37 stops owner reactivation |

### Mali Moments detail

| Requirement | Evidence and actual behavior | Status |
|---|---|---|
| Upload photo | MomentsRail `post()` uploads to `profile-photos`, then inserts own moment; cleans new upload on row error | PARTIALLY VERIFIED |
| Short video | Same path supports `video/*`; client 50MB limit, video elements with playsInline/controls; **no short-duration enforcement, MIME sniff/transcode or server duration cap** | PARTIALLY VERIFIED |
| 24h | M14 default `now()+24h`, M35 list/RLS filters; owner may SELECT own expired rows | PARTIALLY VERIFIED |
| Dashboard | MomentsRail rendered on `/profile`, not an infinite feed | VERIFIED |
| Author visibility | M35 masks name; active account plus own row or public author; block filter; free/hidden own author can see own live moments | VERIFIED |
| Hidden/suspended/expired author | Other members' list/RLS removes nonpublic authors; file URL remains open | PARTIALLY VERIFIED |
| Report / self remove | report_moment dedupes and rejects own report; owner can delete own row + attempts file removal | PARTIALLY VERIFIED |
| Admin removal | `removeMoment` server action sets is_removed, audits/logs, resolves open reports, but does not notify the author; list/RLS hides row | PARTIALLY VERIFIED |
| Storage access / expired bytes | Public URLs; row filtering does not revoke bytes; no cleanup/expiry worker | PARTIALLY VERIFIED |
| RLS | Own INSERT/DELETE; public-live-other SELECT; INSERT does not bind path/created_at/expires_at or require active account | PARTIALLY VERIFIED |
| Activity | `moment_posted`, `moment_reported`, admin `moment_removed`; no view event found and owner hard-delete does not produce removal event | PARTIALLY VERIFIED |
| Notification behavior | Moment report notifies the author; no admin-removal notification and no new_moment event producer | PARTIALLY VERIFIED |

**S14 repro:** a paid member inserted a moment with `expires_at = now()+interval '100 years'` and another member's storage path. It succeeded. The default is not a server-enforced lifetime. Client upload sizes are not bucket MIME/size/duration policy. Rail `load()` runs on mount and user actions, not at expiry.

### Notifications detail

| Event / feed function | Real creation/read path | Coverage / remaining issue | Status |
|---|---|---|---|
| Interest received | M10 `notify_interest_event` AFTER INSERT of pending | Normal path exists; UPDATE back to pending on resend does not notify (N01) | PARTIALLY VERIFIED |
| Interest accepted | Same trigger AFTER status change | ACT + AUTHZ execute acceptance and notification | VERIFIED |
| Interest declined | Same trigger AFTER status change | ACT covers response; dedicated all-recipient assertions absent | PARTIALLY VERIFIED |
| Profile view | M10 `notify_profile_view`; once per pair per 7 days | VIEWS/ACT subset; real rows, not fake counts | VERIFIED |
| Daily 5/new matches | Enum + icon only | No producer | MISSING |
| Package expiry | M30 global sweep writes package_expiring with “has expired” wording | No advance-warning producer; no scheduler; lazy sweep skips notification (N02) | PARTIALLY VERIFIED |
| Boost expiry | M30 global sweep writes boost_expiring | Same scheduler dependency; entitlement expiry gate itself works | PARTIALLY VERIFIED |
| New Mali Moment | Enum + icon only | Posting activity is not notification | MISSING |
| Verification submission/decision/mobile | M34 submission trigger, decision trigger, mobile completion; M37 trusted completion | TRUST/AUTHZ subset; real OTP untested | PARTIALLY VERIFIED |
| Report-related | Moment report notifies author anonymously; admin report resolution RPC audits but does **not** notify reporter | Profile-report submission/resolution and Moment removal lack notification producers; moderation queues exist | PARTIALLY VERIFIED |
| Payment/admin moderation/story publication | Activation and admin actions call push_notification | Some calls best-effort; no durable delivery retry | PARTIALLY VERIFIED |
| Unread/persistence/authorization | M10 notifications SELECT owner; UPDATE only is_read/read_at; no member INSERT; mark RPCs scope auth.uid | Actual count, polling; no standalone cross-user read/mark/count suite; client ignores returned error in markRead/markAll | PARTIALLY VERIFIED |

**N02 demonstrated ordering bug:** expire subscription → member calls `sweep_my_membership()` → global `sweep_expired_memberships()` → **zero package expiry notifications**. The self-sweep changes status first without notification/activity, so the global sweep no longer selects it. `src/app/profile/page.tsx` calls the self-sweep. Benefits still expire correctly.

### Verification detail

- Request UI, pending request persistence, optional photo/ID upload, admin filters and decisions, badge and activity/audit are real.
- Before M37, authenticated `complete_mobile_otp_verification()` required only a stored mobile, not a request or OTP. It was directly callable despite the API checking GoTrue first. The new RPC is service-only and binds the verified mobile to the locked active member and an outstanding ten-minute request.
- The API uses a **fresh** service client after verifyOtp: the verifying client's auth session may become the phone identity. Provider phone must match the original number. No credentials added.
- Verification documents use the private `verification-docs` bucket and admin 120-second signed URLs. Tests do not prove production signed-URL/byte access. Request `storage_path` is not owner-prefix validated in SQL (S09).
- OTP verification is optional in the current login/publication path: mobile-password login and publication do not require `mobile_verified`. UI saying “Verify to use your number for sign-in and contact” overstates the gate. If the original PRD intended mandatory OTP before those actions, that requirement is **not enforced**; confirm intent before adding a new gate.

### Homepage section-by-section

| Section | Actual implementation and issue | Status |
|---|---|---|
| Hero | `hero-section.tsx`, real /search and /packages CTAs, localized copy; decorative imagery, not fabricated member count | PARTIALLY VERIFIED |
| How It Works | `how-it-works-section.tsx`, register/profile/upgrade/connect steps | PARTIALLY VERIFIED |
| Featured Profiles | Real RPC; entire section returns null if unconfigured, RPC error, or no curated profiles | PARTIALLY VERIFIED |
| Why Choose Us | `why-choose-section.tsx` + dictionaries; “genuine/verified” wording not a universal verification gate | PARTIALLY VERIFIED |
| Success Stories | Published DB rows only, truthful empty state; real submission/moderation paths; no seeded invented couples found | PARTIALLY VERIFIED |
| WhatsApp Community CTA | Configured community invite or support link fallback; default `919000000000` is a placeholder, not proven functioning support | NEEDS LIVE/EXTERNAL TEST |
| Register CTA | Free registration + packages links and database copy fallback | PARTIALLY VERIFIED |

All seven are wired once, not duplicate homepage sections. No actual member-count/success-rate statistic is fabricated in the current homepage code. `featured-carousel.tsx` hardcodes “Maharashtra” for every city and uses a blurred example “27 / Pune”; the latter is placeholder layout, not a demo profile, but the state suffix can mislabel real members. The footer's four dead links are confirmed by the route tree/build output. No mobile visual/overflow/keyboard/contrast acceptance test ran.

Unsupported claims needing copy/product review: VIP “Premium verified badge” and priority placement/support; “most popular” is configured merchandising, not measured analytics; About says all profile/family photos are human reviewed although payment can publish a complete unverified profile; verification UI promises usual one-day review with no enforced SLA; bad-signature payment response promises automatic refund without implementing a refund request; admin Moments says removal hides content “everywhere” despite public bytes. Do not replace these with invented numbers or stories.

### Packages / configuration

**Seeded active authority, locally queried in PAY:** SMART `smart-3-month` ₹999 / 90 days; PREMIUM `premium-6-month` ₹2,499 / 180 days; VIP `vip-12-month` ₹4,999 / 365 days. **No pricing was changed.** Admin can edit DB price/days/features/benefits. `duration_days`, not 3/6/12 display months, drives expiry. Changing days can leave the name/month display stale because the admin action does not synchronize those labels.

**P01 — benefit mapping is only partly operative.** `advanced_search`, `who_viewed_me`, `express_interest`, interest quotas and `boosts_included` are consumed. `priority_recommendations`, `verified_badge`, `priority_support`, `featured_eligible` have no operative consumers in the current search/D5/feature/badge/support paths. Search sorts boost then update recency, D5 score then boost, Featured explicit admin position. Admin feature requires public eligibility, not `featured_eligible`. Badges require actual verification, not VIP payment (do **not** “fix” that by selling verified identity). Per-package `daily_match_count` is redundant: matching_config.daily_count is the authority. Several other boolean benefits describe unconditional paid behavior rather than independently configurable gates. Free-text/JSON admin editing can therefore advertise unsupported benefits or invalid types. Admin form checkboxes use a hidden `false` input before the checkbox while the action reads `FormData.get`, which returns the first value; `is_active`/`is_popular` checked values are ignored. The same pattern in `/admin/stories/page.tsx:173` prevents the checked `is_published` value from reaching saveStory, so its normal form cannot publish a success story. This requires a targeted form/action regression test, not a price change.

**P02 — false checkout success UI.** Verify route's provider-fetch failure returns HTTP 202 `{error: ...}` with no `status:'pending'`. PurchaseButton uses `verifyRes.ok && body.status !== 'pending'`, so this response takes the success redirect although no activation occurred. `/packages?payment=success` also shows success based solely on a query parameter. This **does not activate membership**, but is an incorrect user journey. No route/component test covers it.

**P03 — webhook delivery/reconciliation gap.** Unknown local order/payment returns 202 and does not persist the event. There is no reconciliation worker in the repository. Whether Razorpay will redeliver these responses and how an order-write race recovers needs explicit provider testing; the code does not establish eventual delivery. Provider-failed attempts are terminal locally; retries of a Razorpay order using another payment ID and partial refunds also need provider-policy acceptance, not assumptions from SQL fixtures. Deactivating a package after creating an order prevents `activate_membership` (it still requires active package) even though the payment snapshot is retained.

**Old-price inventory is complete for tracked application/SQL/tests/docs:**

| Exact occurrence | Classification / disposition |
|---|---|
| `supabase/migrations/20260915020000_packages_pricing.sql:11` | Historical explanation that old PRD ₹5,999 is retired; retain |
| Same file `:176`, `:178` (`price_inr = 5999`) | Corrective guard mapping old VIP value to ₹4,999, not live price; retain |
| `src/app/admin/packages/page.tsx:26` | Explicit warning **not** to introduce ₹5,999; not stale product price |
| `mv-db-tests/tests/payment-membership-lifecycle.test.mjs:93` | Correct assertion that VIP is ₹4,999 and not ₹5,999; retain |

M05 seeds Silver ₹999, Gold ₹1,799, old Platinum ₹2,999; M09 deactivates those rows and labels their tier. They are historical data/migration compatibility, not active package offerings. No live UI/test restores ₹5,999. `fallbackPackages()` duplicates current values intentionally for display-only outage fallback; negative IDs block checkout, but copy can drift from admin changes.

### Admin action and module acceptance

Every exported business mutation in `app/admin/actions.ts` first calls `requireAdminAction`; pages use `requireAdminPage` (layout alone is not the protection). Member/trust RPCs are service-only and check the actor; analytics also checks is_admin. Configuration actions use service-only table access after the server guard, not a separately exposed member mutation RPC.

| Admin action | Actual backend and UI | Evidence / limitation | Status |
|---|---|---|---|
| Approve | `approveMemberProfile` → `admin_approve_profile`; member detail | ADMIN free/paid/incomplete/state tests | VERIFIED |
| Edit | `updateMemberProfile` → allow-listed `admin_update_member_profile`; `/admin/members/[id]/edit` | ADMIN hierarchy and fields; browser save untested | VERIFIED |
| Suspend | `setProfileSuspended` → admin_set_profile_suspended | ADMIN + AUTHZ direct-owner bypass regression | VERIFIED |
| Delete | `adminDeleteMember` → admin_prepare_member_deletion → wipeMemberFiles → auth delete | ADMIN/PRIV SQL; S05 cleanup unresolved | PARTIALLY VERIFIED |
| Verify | `setProfileVerified` / `decideVerification` → M34 RPCs | TRUST/ADMIN/AUTHZ; document bytes external | PARTIALLY VERIFIED |
| Feature | `setFeatured` → service featured_profiles upsert/delete | FEAT/ADMIN; ignored package eligibility P01 | PARTIALLY VERIFIED |
| Boost | `adminGrantBoost` → admin_grant_boost | BOOST/ADMIN; configured duration, audit and notifications | VERIFIED |
| Hide | `setProfileHidden` → admin_set_profile_hidden | ADMIN + AUTHZ; media unaffected S04 | PARTIALLY VERIFIED |
| Reactivate | `reactivateMemberProfile` → admin_reactivate_profile | ADMIN state-aware restore; cannot grant payment by reactivation | VERIFIED |

| Required admin module | Route / implementation | Security / test evidence / dependency | Status |
|---|---|---|---|
| Users | `/admin/members` → admin_list_members | Guard + service RPC; ADMIN filters/paging | VERIFIED |
| Profiles | `/admin/members/[id]`, `/edit` (combined module, not missing separate `/admin/profiles`) | ADMIN; media/privacy gaps above | PARTIALLY VERIFIED |
| Verification | `/admin/verification` | Guard + signed docs + M34 decisions; TRUST; hosted docs pending | PARTIALLY VERIFIED |
| Packages | `/admin/packages`, updatePackage | Guarded DB mutation; P01 checkbox/benefit validation gaps | PARTIALLY VERIFIED |
| Payments | `/admin/payments`, manualActivate/refundPayment | Guard; PAY/ADMIN; refund marks local ledger, **does not issue provider refund** | PARTIALLY VERIFIED |
| Featured | `/admin/featured`, setFeatured | FEAT/ADMIN; P01 | PARTIALLY VERIFIED |
| Boosts | `/admin/boosts`, grant/config | BOOST/ADMIN; provider purchase pending | PARTIALLY VERIFIED |
| Stories | `/admin/stories` = success stories; `/admin/moments` = 24-hour stories | Both real, not duplicate route concepts; ACT subset; media flaws | PARTIALLY VERIFIED |
| Reports | `/admin/reports`, admin_resolve_report | TRUST; S06 alternate INSERT | PARTIALLY VERIFIED |
| Blocked users | `/admin/blocks`, admin_list_blocks | Actor check, masked normal-member views; TRUST | VERIFIED |
| Matching configuration | `/admin/matching`, matching_config | Guard; D5 configured count; no full form/action tests | PARTIALLY VERIFIED |
| Content | `/admin/content`, site_content | Guard; actual consumer RPCs, selective editable blocks not every localized string | PARTIALLY VERIFIED |
| WhatsApp links | `/admin/whatsapp`, whatsapp_config | Guard + domain validation; operator still must set/test real link | NEEDS LIVE/EXTERNAL TEST |
| Analytics | `/admin/analytics`, admin_analytics | ACT role/date/count tests; event omissions N02, browser external | PARTIALLY VERIFIED |

## D. Needs external/live testing

Run these only after relevant security fixes are deployed; **none is claimed complete** here:

- Supabase staging: all migrations in sequence with actual managed roles/default grants, Auth triggers, PostgREST schema cache, production data/backfills and RLS. Verify M37 and API deploy together; old no-arg OTP calls must fail closed.
- OTP provider: actual request/delivery/code/wrong/expired/replayed code; verified phone matches intended member; phone-user cleanup; cooldown/hourly/provider limits; mobile change during verification; ten-minute request window versus configured provider token lifetime. No credentials supplied/used.
- Auth: signup duplicate email/mobile, confirmation mail/redirect allowlist, PKCE/session cookies, login/logout/expired session, password reset expectations and deployed password/rate policies.
- Razorpay test transaction (later authorized step): every current package and add-on, order amount/INR, authorized vs captured, cancelled/failure, provider API outage, pending UI, callback/webhook both arrival orders/concurrent replay, webhook retry/redelivery, real refund policy and reconciliation. SQL transactions are not this test.
- Storage: public-url exposure closure, actual family-photo toggles, anonymous/block/expired/removed byte fetch, signed verification documents, forged object paths, MIME/size/video length, object replacement, caching/CDN invalidation and orphan cleanup. Synthetic SQL storage tests are insufficient.
- Scheduler: deploy/observe global sweep; no login required for notification; lazy-first and cron-first orderings; empty/exhausted quota, timezone and renewal/refund edge cases.
- Deletion: >1,000 objects, nested files, success-story photos, storage listing/removal failures, auth deletion retry, retained moderation/financial records and late webhook; assert object bytes are gone, not merely absent from DB.
- Browser/device: complete free→paid→mutual journey with two members plus admin, refresh/back/error handling, notification read state, upload camera/HEIC support and actual video playback, 320/360/390px widths, iOS Safari/Android Chrome, keyboard and screen reader, all footer/community links.
- Realtime chat subscription/publication and reconnect/read-state delivery (existing additional feature, not evidence for core Phase 1 acceptance).

## E. Redundant, stale and dead code

No production code or historical migration was deleted just because it appeared unused.

| Exact file/symbol | Confirmed reference finding | Recommendation |
|---|---|---|
| `src/components/layout/coming-soon.tsx` / ComingSoon | No import/reference from other source files; Next does not auto-route components | Safe removal candidate after confirming no external consumers; untouched |
| `src/lib/profile/mask.ts` / maskedText, maskDots | No source caller beyond declarations; maskName/maskPhone/constant **are used** | Remove only unused exports if cleanup is approved |
| `src/app/shortlist/page.tsx` | Deliberate redirect to `/interests`; no active shortlist UI | Keep redirect for bookmarks; do not call it missing |
| M02 `shortlists`, types, M34 policies | Still writable/readable RPC-table surface; no product caller | Decide retention and revoke obsolete writes in a forward migration; don't drop historical data blindly |
| `request_account_deletion(text)` and `account_deletion_requests` pending flow (M13) | No current UI caller; current flow uses delete_my_account | Retain necessary processed retention records; retire old callable request-only behavior deliberately |
| `log_account_deletion(text)` (M30) | No current app caller; member-callable legacy business-event writer | Revoke/retire after compatibility check; do not mistake generic log_activity lockdown for this function's lockdown |
| `submit_success_story` RPC (M18) vs `app/success-stories/submit/actions.ts` | UI uses server action/service insert; still-callable SQL submission duplicates paid/consent/duplicate checks with different upload handling | Consolidate one authority with behavior tests, not unreferenced-RPC deletion |
| `src/lib/env.ts` / isRazorpayConfigured | Duplicate of the used server-only helper in `lib/payments/razorpay.ts`; no caller imports the env copy | Remove unused copy in cleanup; keep secret reads server-side |
| `loadCheckoutScript` in `purchase-button.tsx` **and** `boost-card.tsx` | Duplicated implementation and Window.Razorpay declaration; both actively used | Share loader/error recovery in later refactor |
| `lib/profile/visibility.ts` rowsMutual fallback vs mutual_interest_exists | Deliberate legacy RPC fallback, but duplicated mutual semantics; fallback ignores blocks itself | Remove fallback only after enforcing minimum migration level; DB contact gate remains authority |
| `lib/profile/subscription.ts` hasActiveSubscription RPC/direct fallback | Supports missing-RPC deployments although current migrations required | Document minimum schema; avoid silent old-schema acceptance |
| `lib/profile/subscription.ts` fallbackPackages | Duplicate values/copy for outage display; negative IDs prevent charge | Keep or replace with honest unavailable state; not payment authority |
| M05 Silver/Gold/old Platinum; M09 retirement map | Inactive historic rows, tests/migrations may rely on them | Retain historical migration; not new Platinum scope |
| M14/M25 boost duration defaults, older “7-day” text | Later M25 helper/config supersedes active paths; BOOST checks duration | Do not rewrite historical defaults; no active hardcoded duration defect found |
| M09 benefits.daily_match_count vs M33 matching_config.daily_count | Former is unconsumed; UI brands “Daily 5” even if admin changes count | Clarify authority and configurable branding; do not replace actual count gate with hardcoded 5 |
| `lib/profile/community.ts` | Real DB hierarchy loader; no hardcoded community fallback list | Keep. SQL seed community rows are data, not a duplicate UI list |
| `lib/contact.ts`, M21 support seed | Placeholder phone/WhatsApp; email/phone fallback still compiled; README overstates universal editability | Operator configuration/copy review; do not invent real contact details |
| `featured-carousel.tsx` | Hardcoded state suffix and blurred demographic examples | Use real state for entitled viewers; placeholders are not genuine statistics |
| `supabase/README.md:4,453` | Describes shortlist as a shipping flow/route, now redirect-only | Stale documentation; this audit records correction |
| `supabase/README.md:593` | “scheduled sweep” assertion without shipped scheduler | Deployment prerequisite, not verified scheduled implementation |
| Comments on Moments expiry/public storage/privacy, admin-only reasons | Claim stronger authority/privacy than grants/URLs implement | Correct in remediation alongside actual behavior; don't merely change wording |

Repository searches found no `TODO`, `FIXME`, `console.log` or debugger statement in application source. `console.warn` in login/register/wizard reports repair failures; `console.error` in success-story upload action reports real errors. Test console output is the harness reporter, not shipping debug code. No abandoned commented-out full implementation or duplicate API route was established. `/contact` is an intentional `/about#contact` redirect. Brides/Grooms share BrowseGrid; Featured and Daily cards intentionally differ, so they are not deletion candidates. No separate Connection Request product/table/route was found; interests implement the connection journey. Demo identities are confined to tests; form examples and blurred placeholders are not production user seeds.

### Phase 1 scope exclusions

| Excluded scope | Actual repository finding | Status |
|---|---|---|
| Android application | No native project/package | OUT OF SCOPE / PRD CONDITIONAL |
| iOS application | No native project/package | OUT OF SCOPE / PRD CONDITIONAL |
| Advanced AI/ML matching | D5 is explicit SQL rules/weights, no inference/vendor | OUT OF SCOPE / PRD CONDITIONAL |
| AI chatbot | No chatbot path | OUT OF SCOPE / PRD CONDITIONAL |
| WhatsApp API automation | Links/opt-in only, no automated messaging integration | OUT OF SCOPE / PRD CONDITIONAL |
| Video calling | Moment video files are not calling; no call path | OUT OF SCOPE / PRD CONDITIONAL |
| Followers | No follower feature | OUT OF SCOPE / PRD CONDITIONAL |
| Likes | No member/story likes feature (decorative heart icons are not likes) | OUT OF SCOPE / PRD CONDITIONAL |
| Comments | No member comment feature | OUT OF SCOPE / PRD CONDITIONAL |
| Infinite social feed | Moments bounded to 100 live rows; no social timeline/infinite scroll | OUT OF SCOPE / PRD CONDITIONAL |
| Matrimonial events platform | Marketing mentions events, no platform | OUT OF SCOPE / PRD CONDITIONAL |
| Wedding marketplace | No product path | OUT OF SCOPE / PRD CONDITIONAL |
| Franchise system | No product path | OUT OF SCOPE / PRD CONDITIONAL |
| Advanced horoscope engine | Biodata gotra, not horoscope computation | OUT OF SCOPE / PRD CONDITIONAL |

**Additional active functionality to explicitly reconcile with the full original PRD:** paid-mutual in-app chat (`/messages`, chat RPCs/tables/Realtime, M16–M17), and richer success-story submission/rating workflow. Chat is not on the supplied MUST BUILD list but also not on its explicit prohibition list. It is therefore a scope clarification, not justification to delete it. Success-story ratings are submission fields, not social likes. None of the explicitly excluded systems above was added in this audit.

## F. Security findings (confirmed paths, not keyword guesses)

| ID / severity | Finding and exact authority path | Evidence / disposition |
|---|---|---|
| **S01 Critical** | `interests` had table-wide UPDATE + receiver policy constraining receiver/status but not sender. Recipient could rewrite sender, accept, then get another paid member's phone/PDF through “mutual” consent | **Reproduced on baseline**: fake accepted row returned target phone. **Fixed M37**: UPDATE(status) only; AUTHZ denies sender/receiver/time rewrite, preserves legitimate acceptance and blocks |
| **S02 High** | M19/M34 `complete_mobile_otp_verification()` executable by authenticated, sets its own trusted flag, needs no OTP/request | **Reproduced baseline** `{ok:true}`, mobile_verified true without request. **Fixed M37 + route**: no-arg function removed, service-only bound completion after GoTrue; external provider still unverified |
| **S03 High** | Own-row grants allowed clearing admin_hidden_at, suspended→active, is_active false→true; verified_at protection only UPDATE could be bypassed by matrimony DELETE+INSERT | **Reproduced baseline**, public after unhide; replacement verified_at accepted. **Fixed M37**: invoker trigger protects direct state/INSERT; revoke member matrimony DELETE; trusted lifecycle RPCs preserved; AUTHZ/ADMIN/PRIV pass |
| **S04 High, OPEN** | `profile-photos` public bucket + universal storage SELECT (M02/M04); family photos, Moments and some other media share it; `photoUrl()` always `/object/public/` | File access has no membership/block/privacy/expiry checks. Row RLS does not revoke known URLs and bucket-wide listing policy is also permissive. Hosted byte test still needed, but insecure policy/path is explicit. Requires private protected-media architecture, migration of existing objects/URLs and cache review |
| **S05 High, OPEN** | `wipeMemberFiles` scans the two current member buckets with 1,000 entries/folder, max depth 3, ignores list/remove errors; auth deletion proceeds | Large folders, deeper paths or Storage errors can leave personal files behind with no retry record. Success-story uploads currently use the covered `profile-photos/<uid>/` prefix; their names/text remain published with submitted_by detached, so retention/consent withdrawal needs an explicit policy. SQL deletion tests do not test actual storage cleanup |
| **S06 Medium, OPEN** | `reports` authenticated INSERT “Member files a report” remains after report_profile RPC introduced | Reproduced inserting own report already `resolved`; can bypass RPC dedupe/rate limit/activity path. No target gets reporter rows via normal SELECT. Revoke raw INSERT or constrain all fields/centralize writes |
| **S07 Medium, OPEN** | M35 `profile_photo_is_listable` checks active status/hold/account but **not live membership**, unlike is_profile_public | Expired, unswept account is not public, yet another member SELECTs one profile-photo metadata row. Reproduced. Public object problem is separate/larger |
| **S08 Medium, OPEN** | `matrimony_profiles` owner SELECT returns admin_hidden_reason/suspension_reason even though comments promise admin-only notes | Reproduced owner SELECT reading “Internal moderation note”. Put internal reasons in protected storage or expose an allow-listed owner projection; hiding them in UI isn't authorization |
| **S09 Medium, OPEN** | `verification_requests` own-pending INSERT does not bind `storage_path` to own prefix/object; Moments/profile_photos likewise accept arbitrary paths | Owner upload RLS does not constrain row references. An attacker knowing another object's path can submit misleading evidence that admin renders via a signed URL; request table privacy itself works. Need ownership/reference validation; no claim paths are guessable secrets |
| **S10 High safety gap, OPEN** | DOB constraint only `< CURRENT_DATE`, wizard schema only nonempty; public/publish gate has no minimum adult age | Reproduced one-day-old DOB still public. Adopt explicit product/legal age rules server-side, not inferred age-dropdown limits; exact legal policy requires operator confirmation |
| **S11 High, OPEN** | `/packages` passes raw searchParams.next into Link href and PurchaseButton.router.push | Unlike login getSafeRedirect, no relative-path guard. External/untrusted-scheme destinations accepted by code. Open-redirect/unsafe navigation path confirmed by source; browser exploit execution **not** claimed. Normalize once, reject schemes/network paths/backslashes/control chars, cover with runtime tests |
| **S12 Dependency exposure, OPEN** | Lockfile installs **Next 14.2.5**; npm production dependency audit returns **6 affected packages: 1 critical, 1 high, 4 low** | Registry advisory result, not a demonstrated exploit of this deployment. Next includes middleware bypass/DoS advisories; backend/RPC admin guards are defense in depth. Pin supported patched versions and run separate upgrade/regression acceptance; no automatic audit-fix upgrade here |
| **S13 Medium reliability/integrity, OPEN** | `lib/admin/server.ts` audit helper awaits INSERT but ignores returned error; many TS actions mutate then audit nontransactionally | Unlike SQL transactional audit, a successful mutation can lack audit entry. Failure-injection test and transactional/audited RPC path needed |
| **S14 Medium, OPEN** | Moments INSERT grant includes created_at/expires_at/is_removed/storage_path, policy only user_id | Reproduced 100-year lifetime + foreign media path; default 24h is bypassable. Need server-assigned immutable times/path validation and actual file access expiry |

No client-controlled package charge/entitlement activation was found in current payment paths; no source-embedded real service key or Razorpay secret was identified (the `.env.example` values are placeholders). Server-only imports and non-public env names are present. M36 SQL denies expired paid privileges and stale-payment/deleted-user resurrection. This is **not** a guarantee about deployed credentials, installed policies, CDN, unreviewed dependencies, or all user-generated free text.

M37 fixes are local until applied to the hosted database. Deploy the migration before/with the updated OTP route; an old route then fails closed rather than retaining the bypass. Existing counterfeit verification/interest/moderation history cannot be reliably auto-repaired: production operators must review affected rows/audit history. No destructive bulk “cleanup” was attempted.

## G. Tests and test gaps

### Actual commands and results

Both baseline and final checks were run in this workspace on 2026-09-20; no prior-step result was accepted as current evidence. No provider env/credentials were configured.

| Command | Baseline (M01–M36) | Final (M01–M37 + authorization fixes) |
|---|---|---|
| `npm ci` (root), `npm ci` (mv-db-tests) | Completed from lockfiles | Same installed lockfiles; not changed |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run lint` | exit 0, no warnings/errors | exit 0, no warnings/errors |
| `npm run build` | exit 0, Next 14.2.5 production build | exit 0 |
| `cd mv-db-tests && npm test` | exit 0, **12 suites / 1,060 checks / 0 failed** | exit 0, **13 suites / 1,092 checks / 0 failed** |
| Migration execution | 36/36 in multi-statement and per-file-transaction mode; newest re-applied twice | 37/37 same modes; newest re-applied twice |
| Extra `npm audit --omit=dev --json` | Audit reports vulnerabilities; not a pass gate | Lock unchanged: 6 affected packages (critical 1 / high 1 / low 4) |

The initial progress message's 1,160 baseline total was an arithmetic error; the actual suite summaries total **1,060**. No result was silently counted as live verification.

Final suite counts: ACT 63; ADMIN 236; AUTHZ 32; BOOST 156; BUS 62; COMM 56; D5 73; FEAT 101; PAY 93; PRIV 80; VIEWS 54; SEARCH 39; TRUST 47. AUTHZ includes executable database regressions **and two explicitly labelled source assertions** about OTP route wiring, not 32 provider tests.

### What the harness does NOT prove

- PGlite applies actual SQL and impersonates roles, but is not a Supabase deployment. `auth.users`/auth helpers are a shim; test signup sets confirmed email, not an actual registration/session/OTP journey.
- Storage schema/publication are absent during migration application, so guarded Storage policies and Realtime setup are skipped. TRUST later creates a synthetic storage table and one copied document-read policy. Its “admin can access verification documents” check is **not** a real signed-document fetch or validation of production migration storage DDL.
- Test `activatePackage()` uses service-role **manual** activation (`payment_id=NULL`), not checkout. PAY adds real SQL payment identity/state tests, but **no HTTP route/HMAC/provider execution** despite its header mentioning route contracts.
- Tests frequently seed valid profile/photo metadata as superuser. That missed raw member INSERT/UPDATE attacks and never uploads bytes.
- Only the newest migration is re-applied; successful fresh chronological application is not proof all historical migrations are safely repeatable after later ones or on production data.
- Root package has no browser/unit test script. Build/typecheck/lint are necessary but not behavior coverage. No Playwright/Cypress/real-device test ran.

Priority coverage gaps: complete two-member browser journey; Storage bytes and object references; success-story media deletion/consent; real Auth/OTP; HMAC known-answer/malformed webhook/HTTP ownership tests; parallel provider retries; 202 UI state; webhook unknown-order recovery; notification feed/read-state cross-user tests; resent-interest notification; lazy/cron expiry order; Moment timing/video validation and live-rail expiry; all admin config forms (checkbox payloads, typed benefits, audit failure); D5 component math/weights rather than only ranking; individual-profile compatibility; links/localization/accessibility; adversarial direct grants beyond the new suite.

## H. Dependency-ordered next steps

1. **Security baseline before any offer/payment rollout:** review/apply M37 and route together, validate hosted permissions, and assess pre-existing forged records. Close S04/S05/S07/S09/S14 as one coordinated protected-media/access/lifecycle change; handle S06/S08/S11 and age-policy decision S10. Upgrade vulnerable framework/dependencies in an isolated tested change. These are release blockers, not prerequisites to invent Platinum functionality.
2. **Then make business events and asynchronous work reliable:** unify self/global expiry transition emission, deploy an observed scheduler, implement the specified new-match/new-Moment producers with dedupe and privacy rules, fix resend notifications and audit failure handling. Add the missing negative/runtime tests before claiming event acceptance.
3. **Then align the existing product contract/UI:** individual-profile compatibility, package benefit/copy mapping without changing authoritative prices, admin checkbox parsing, pending/success checkout state, real operator WhatsApp/support values, real legal pages, correct demographics/claims. Clarify chat scope and optional-vs-mandatory OTP/ID with the authoritative full PRD if supplied later.
4. **Then stage external integrations:** configured Supabase Auth/Storage/Realtime and SMS, then separately authorized Razorpay credentials/test transactions, webhook retry/refund/reconciliation scenarios, device/browser acceptance and actual deletion failure drills. Document evidence per journey, not just “tests passed”.
5. **Only after the existing baseline is secure and accepted**, specify and implement the new Platinum/first-100/demo requirements in their own development step. Do not reuse historical retired Platinum as implicit product approval.
6. Clean up proven unused exports/components and superseded RPC surfaces after behavior/retention compatibility is established. Keep historical migrations and compatibility redirects unless a deliberate migration/retirement plan replaces them.

**PR handling:** open “Step 13: Phase 1 PRD completion and codebase audit” from the session branch; **do not merge**. This document deliberately does not certify “100% complete”.
