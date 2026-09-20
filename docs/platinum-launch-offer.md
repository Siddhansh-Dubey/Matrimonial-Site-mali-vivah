# Platinum Launch Offer — implementation notes

Temporary launch promotion for Mali Vivah, added **additively** on top of the
existing membership/payment architecture (migrations
`20260920180000_enum_tier_platinum.sql` + `20260920190000_platinum_launch_offer.sql`).

Two benefits:

1. **First 100 users** — the first 100 eligible members receive a **FREE
   30-day Platinum membership**.
2. **24-hour Platinum demo** — once those 100 launch slots are claimed, any
   member who completes the required profile/biodata details receives exactly
   one **FREE 24-hour Platinum demo**.

The paid packages are untouched: **Smart ₹999/90 days · Premium ₹2,499/180
days · VIP ₹4,999/365 days** remain the authoritative price list, and no
Platinum plan is ever purchasable.

---

## 1. What "Platinum" is in this codebase

Platinum is a **promotional membership tier**, not a second membership
system:

* `membership_tier` gained the enum value `'platinum'` (own migration file —
  PostgreSQL forbids using a new enum value inside the transaction that
  created it, the same convention as migrations 7 and 16).
* Two **non-purchasable** package rows exist so a grant is an *ordinary
  `subscriptions` row* that every existing gate already honours:
  * `platinum-launch-30d` — 30 days, ₹0, `is_active = FALSE`, tier
    `platinum`, full benefit map (visibility, search incl. advanced,
    recommendations, interests — unlimited —, full biodata + download,
    profile views + who-viewed-me, featured eligibility, 3 boosts included).
  * `platinum-demo-24h` — 1 day (24 h), ₹0, `is_active = FALSE`, tier
    `platinum`, same core capabilities with 25 interests/month and 1 boost.
  * `verified_badge` / `priority_support` stay `false` — those follow real
    verification/operations, never a promotion.
* Because `is_active = FALSE` and `price_inr = 0`:
  * `/packages`, the admin manual-activation picker and the order route never
    list them;
  * `validate_payment_snapshot()` **rejects any payment row** for them
    (`PAYMENT_PACKAGE_INVALID`) — a Platinum "purchase" cannot exist;
  * `activate_membership()` refuses them — the claim RPC is the only path
    that can create a Platinum subscription.
* The legacy retired `platinum-12-month` row (mapped to tier `vip` by
  migration 9) is untouched; the existing Premium package was **not**
  renamed.

Everything downstream works with zero changes because the entitlement *is* a
subscription row: `has_live_membership()`, `is_profile_public()`,
`get_membership()`/`has_benefit()` (tier resolves to `platinum` with the
promotional benefit map), `express_interest()`, chat, Daily 5, boosts,
search visibility, biodata unlock, and the expiry sweeps all treat a
Platinum member as a legitimate active member — server-side.

## 2. Campaign state + claim ledger (never a user count)

```
platinum_launch_campaigns   one row: campaign_key = 'FIRST_100_PLATINUM',
                            total_slots = 100, enabled = TRUE
platinum_launch_claims      the ledger + the authoritative counter:
                            UNIQUE(campaign_id, user_id)      → one grant per member
                            UNIQUE(campaign_id, slot_number)  → one member per slot
                            grant_type 'first_100' | 'demo_24h'
                            subscription_id → the subscription row granted
                            source 'launch_promotion'
                            promotion 'first_100_platinum' | 'platinum_24h_demo'
                            granted_at / start_at / expiry_at (server-generated)
```

**The first-100 counter is `count(*)` over `platinum_launch_claims` rows with
`grant_type='first_100'` — never `COUNT(*)` of `auth.users`, `profiles` or
`matrimony_profiles`.** Pre-existing development/test accounts therefore
consume nothing: a **fresh production database starts at 0/100 claimed by
construction**, however many accounts already exist. (Verified by test:
"more accounts exist than slots, yet exactly 100 claims were made".)

Campaign rows are service-role only (RLS on, no grants/policies for
`anon`/`authenticated`); members read only their OWN claim rows. No internal
campaign id, key or counter ever reaches member-facing UI — the RPCs return
only the caller's own entitlement state.

## 3. Exactly how the first-100 allocation works

One RPC: `public.claim_platinum_launch_offer()` — `SECURITY DEFINER`,
EXECUTE for `authenticated` (+ `service_role`), **no arguments** (always acts
on `auth.uid()`, so nobody can claim for another user or pass a payload).
One call = one transaction:

1. `auth.uid()` — unauthenticated callers raise `NOT_AUTHENTICATED`
   (anon has no EXECUTE grant at all).
2. **Per-member advisory lock** — `pg_advisory_xact_lock(hashtext(
   'platinum_launch_claim:' || user))` serialises that member's double
   clicks / refreshes / retries (same mechanism `activate_membership()`
   uses per member).
3. **Existing claim → return it** (`status: 'already_claimed'`, same window,
   same slot). This is what makes the operation idempotent and enforces
   "exactly one launch grant per member, ever" — a first-100 member can
   never later receive the demo, and a demo is never restarted by
   re-editing/re-saving the profile (rules C, D, E).
4. Campaign `enabled` check (admin master switch; disabling stops both
   benefits, existing grants keep running to expiry).
5. **Account/admin gates** — active account, profile row exists, status not
   `suspended`/`rejected`, no admin hold. Existing admin/suspension/
   visibility rules stay authoritative; a blocked attempt writes **no claim
   row**, so no launch slot is wasted.
6. **Canonical completeness check** — `admin_profile_missing(user)` must
   return empty: gender, 18+ date of birth, city, education, occupation,
   profile photo AND the mandatory family photo. This is the *existing*
   publish-gate definition (the same checklist
   `enforce_publishable_profile()` enforces) — no second definition of
   "complete profile" was invented.
7. **Campaign row `SELECT … FOR UPDATE`** — from here every other member's
   claim waits; this is the cross-member serialisation.
8. **Count `first_100` claims in the ledger under the lock.** If
   `count < total_slots` → first-100 path with `slot_number = count + 1`;
   otherwise → demo path. Two members registering simultaneously can never
   both receive slot 100.
9. Insert the subscription: the promotional package, `status='active'`,
   `started_at = now()`, `expires_at = now() + duration_days` (**server-
   generated**; 30 days or 24 hours), `payment_id = NULL` — never a payment
   row, never Razorpay.
10. Insert the claim row. `UNIQUE(campaign_id, user_id)` is the final
    arbiter: on a (practically impossible under the locks) unique violation
    the just-created subscription is deleted again and the winner's state is
    returned.
11. **Publish attempt** — a complete `draft`/`hidden`/`expired` profile
    transitions to `active`, exactly like `activate_membership()` does after
    a payment (the publish gate re-validates; `pending_review`/`suspended`/
    `rejected` are never overridden).
12. Bell notification (`admin_message` — never `payment_received`) +
    idempotency-keyed activity event `platinum_first_100_granted` /
    `platinum_demo_24h_granted` with `source: launch_promotion`.

The RPC returns the resulting entitlement state (`granted` /
`already_claimed` / `not_eligible` / `campaign_disabled` + grant type, slot
number, package slug, start/expiry, `is_live`, `seconds_left`) — the client
renders it and computes nothing itself.

**Trigger points (frontend never decides):**

* the profile wizard calls the RPC after any successful save
  (`saveProfile()`), including the Publish flow — the RPC itself decides
  whether the profile just became eligible;
* the `/profile` dashboard calls it lazily on every server render (same
  pattern as `sweep_my_membership()`), which covers missed/failed wizard
  calls, refreshes and re-logins;
* both tolerate an unapplied migration (read-only fallback
  `get_my_platinum_launch()`).

Registration alone grants nothing — the first-100 eligibility rides the
existing registration → profile-completion lifecycle and does not depend on
frontend timing.

## 4. Exactly how the 24-hour demo works

* **When:** only after the ledger holds 100 `first_100` claims (checked
  under the campaign row lock in step 8 above).
* **Who:** any member passing the same eligibility + canonical completeness
  gates (steps 5–6). Opening the wizard does nothing; the server decides.
* **What:** one subscription row on `platinum-demo-24h` — `started_at =
  now()`, `expires_at = now() + 24 hours` (server-generated, exactly once),
  `payment_id = NULL`.
* **Once per member:** the same `UNIQUE(campaign_id, user_id)` ledger row.
  Re-saving the profile, refreshing, logging out/in or calling the RPC
  again returns `already_claimed` with the *original* window — the demo
  never restarts.
* **Survives everything:** state lives in the database, not the session.
* **Expiry:** the existing sweeps (`sweep_expired_memberships()` cron path,
  `sweep_my_membership()` lazy path) flip the lapsed subscription to
  `expired`, hide the profile (`active → expired`) **unless another live
  (e.g. paid) membership exists**, and all capability gates
  (`has_live_membership`, `has_benefit`, `is_profile_public`, search, chat,
  interests) go back to free-tier immediately — time-aware, before any
  sweep runs. The new `subscriptions_log_promotion_expiry` trigger adds the
  idempotent `platinum_promotion_expired` analytics event and a promo-worded
  notification; the sweeps themselves are unchanged.
* **No Razorpay involvement:** no order, no payment row, no revenue, no
  `payment_received` notification, no `payment_captured`/
  `membership_activated` events — and the database rejects the creation of
  a payment for a promotional package outright.

## 5. Interaction with paid memberships (no regressions)

| Scenario | Behaviour |
| --- | --- |
| Free user completes profile, slot available | 30-day first-100 Platinum; **no** demo (one claim row per member) |
| Free user completes profile, slots exhausted | one 24-hour demo |
| User has an active paid Smart/Premium/VIP membership | grant **overlaps** (starts now); the paid row is never rewritten → not shortened, not delayed, not downgraded. `get_membership()` keeps reporting the longest-running live subscription, so the paid tier stays authoritative while it runs |
| First-100 member, later | never receives the demo from this campaign (ledger uniqueness) |
| Demo member edits profile again / refreshes / re-logs in | `already_claimed`, original window — never restarted |
| Demo (or 30-day grant) expires | existing sweep/visibility logic hides the profile unless another live entitlement exists; `platinum_promotion_expired` logged |
| User purchases a package while a promo runs | **existing** renewal-stacking rule applies unchanged (`activate_membership()`): the paid period keeps its full duration and starts where the live plan ends; the paid package never disappears and `get_membership()` reports it |
| Promo granted to a paid member, then promo expires | paid membership untouched; profile stays live through the paid row |

Prices, benefits, boost quotas, Daily 5, Featured, Express Interest,
visibility, chat and admin member controls are unchanged (the full existing
database suite passes unmodified).

## 6. UI

* **Wizard** (`/profile/edit`): after a save that completes the profile, an
  inline success panel — "🎉 You're one of the first 100 members! (Slot #n)"
  / "🎉 Your free 24-hour Platinum demo is now active." with the
  server-generated expiry. Publish redirects to `/profile?published=1&
  launch=first100|demo`.
* **Dashboard** (`/profile`): `PlatinumLaunchCard` shows Platinum status,
  start, expiry and remaining time (days for the 30-day grant, hours/minutes
  for the demo), a "Promotional grant — you were not charged" note, and an
  honest ended-state with a packages CTA. The paid "Active package till …"
  banner never renders for promotional rows.
* **Packages** (`/packages`): a launch-offer explainer panel (clearly free,
  clearly not a payment) and a promo-aware active-membership banner. The
  three paid package cards and prices are unchanged.
* No internal campaign ids/keys/counters are exposed to members.

## 7. Admin

`/admin/launch-offer` (nav: "Launch offer", behind `requireAdminPage`):

* campaign status — total slots (100), **claimed**, **remaining**, demos
  granted, live grants, enabled state;
* first-100 grants table — slot #, member (link to the member page), grant
  date, start, expiry, `source · promotion`, package slug, live/ended;
* demo grants table (newest first, same columns minus slot);
* enable/disable switch (server action `togglePlatinumCampaign`, audited);
* **typed-confirmation reset** (server action `resetPlatinumCampaign` →
  `reset_platinum_launch_campaign('FIRST_100_PLATINUM')`, audited).

Every action re-verifies `is_admin` server-side and writes an
`admin_audit_log` row. Ordinary users cannot reach any of it: the RPC reset
is service-role only (members/anon get `permission denied`), campaign state
has no member-readable grant, and claim RPCs take no arguments.

## 8. Analytics / activity

New canonical events (added to `canonical_activity_events()`, written only
by the SECURITY DEFINER paths with idempotency keys):

* `platinum_first_100_granted` — metadata: source, promotion, grant_type,
  slot_number, package_slug, subscription_id, started_at, expires_at,
  profile_status.
* `platinum_demo_24h_granted` — same shape, no slot.
* `platinum_promotion_expired` — logged by the subscriptions trigger when a
  sweep expires a promotional row (once per subscription).

A promotional grant is never recorded as a payment: no `payments` row, no
`payment_*`/`membership_activated` events, `payment_id` stays NULL.

## 9. Reset for development testing — **DEVELOPMENT ONLY**

> ⚠️ **DO NOT RUN IN PRODUCTION.** The reset removes real members' free
> Platinum entitlements. It exists so staging can be re-tested from a clean
> 0/100 state before go-live.

`public.reset_platinum_launch_campaign(p_confirm TEXT)`:

* EXECUTE granted to **service_role only** (members/anon: permission
  denied); requires `p_confirm = 'FIRST_100_PLATINUM'` (typed confirmation,
  enforced by the database itself);
* locks the campaign row, then:
  1. deletes ONLY this campaign's claim rows;
  2. deletes ONLY the subscriptions the ledger recorded, and only when
     `payment_id IS NULL` **and** the slug is a promotional slug — paid
     subscriptions, Razorpay payments, boosts and purchases can never match;
  3. restores profile-status truth: profiles `active` with no remaining live
     membership fall back to `expired` (the sweeps' own rule);
  4. leaves the campaign row (key/name/total_slots/enabled) as configured.
* Preserves: users, `auth.users`, profiles, matrimony data, paid
  subscriptions, payments/refunds, activity history (past
  `platinum_*` events stay), audit log.
* Returns a JSON summary (`claimed_slots: 0`, removed claims/subscriptions,
  profiles set expired).

**Two ways to run it:**

1. **SQL script** — [`supabase/dev/reset_platinum_launch_DEV_ONLY.sql`](../supabase/dev/reset_platinum_launch_DEV_ONLY.sql)
   in the Supabase SQL Editor (the editor runs as the table owner, so the
   service-role RPC is executable):

   ```sql
   SELECT public.reset_platinum_launch_campaign('FIRST_100_PLATINUM');
   ```

2. **Admin panel** — Admin → Launch offer → "Reset to 0/100 — development
   only", typing `FIRST_100_PLATINUM` as confirmation (audited as
   `platinum_campaign_reset`).

After a reset the campaign genuinely restarts: the next completing member
receives slot 1 again (tested).

## 10. Production deployment

1. Apply migrations in filename order — `20260920180000` (enum value; own
   file, do not merge) then `20260920190000`. Both are idempotent and
   transaction-safe (the harness proves both `multi` and single-transaction
   application, plus re-application of the newest file).
2. **No reset is needed in production:** the campaign seed creates an empty
   ledger, so eligibility starts at **0/100 claimed** regardless of any
   pre-existing development/test accounts — the counter never counts users.
3. Re-running the migration later never re-enables a disabled campaign or
   rewrites slots (`ON CONFLICT DO NOTHING` seeds).
4. Optional: watch Admin → Launch offer for claimed/remaining slots and the
   grant tables; switch the campaign off there when the promotion should
   end (already-granted entitlements run to their normal expiry).

## 11. Test coverage

`mv-db-tests/tests/platinum-launch.test.mjs` — 193 checks over the real
migration chain (PGlite, real RLS/grants/SECURITY DEFINER boundaries),
covering every required scenario:

* first-100: 1st/99th/100th get 30-day grants with sequential unique slots;
  101st does not; 101st completed user gets the demo; pre-existing test
  accounts (incl. paid ones) consume nothing; duplicate/forced claims and
  duplicate slots are rejected by the unique indexes; the RPC provably
  serialises (advisory lock + `FOR UPDATE` + ledger count — asserted against
  `pg_get_functiondef`); repeated claims/profile edits/refresh/re-login
  never duplicate or restart a grant. (True multi-connection parallelism is
  impossible in single-connection PGlite; the invariant is asserted at the
  storage layer where it lives.)
* demo: exactly one per member; never restarted; expiry removes every paid
  capability and hides the profile unless another live entitlement exists;
  paid members never downgraded/shortened; purchase during a demo keeps the
  full paid duration via the existing stacking rule.
* payments: zero payment rows, zero revenue, promo packages unpurchasable
  by database constraint, `activate_membership` refuses them.
* security: members/anon cannot write subscriptions/claims/campaign, cannot
  read campaign state, cannot call the RPC for another user (no such
  function signature exists), cannot execute the reset.
* reset: back to 0/100; only promotional entitlements removed; users,
  profiles, paid subscriptions, payments and activity history preserved;
  typed confirmation enforced; members cannot call it; campaign restarts
  cleanly (slot 1 again).
* no regressions: the full pre-existing suite (payments, membership
  lifecycle, boosts, Daily 5, featured, admin members, privacy, chat-era
  hardening — 1,318 checks) passes unchanged, and the active shop catalogue
  remains exactly Smart/Premium/VIP at ₹999/₹2,499/₹4,999.

## 12. Files touched

**Database** — `supabase/migrations/20260920180000_enum_tier_platinum.sql`,
`supabase/migrations/20260920190000_platinum_launch_offer.sql`,
`supabase/dev/reset_platinum_launch_DEV_ONLY.sql`.

**Backend/app** — `src/lib/supabase/database.types.ts` (types for the new
tables/enums/RPCs), `src/lib/profile/subscription.ts` (promotional-slug
helpers), `src/components/profile/profile-wizard.tsx` (claim after save +
success panel), `src/components/profile/platinum-launch-card.tsx` (new),
`src/app/profile/page.tsx` (lazy claim + card + promo-aware banner),
`src/app/packages/page.tsx` (explainer panel + promo-aware banner).

**Admin** — `src/app/admin/launch-offer/page.tsx` (new),
`src/app/admin/actions.ts` (`togglePlatinumCampaign`,
`resetPlatinumCampaign`), `src/app/admin/layout.tsx` (nav).

**Tests/docs** — `mv-db-tests/tests/platinum-launch.test.mjs`, this file,
`supabase/README.md`, root `README.md`.
