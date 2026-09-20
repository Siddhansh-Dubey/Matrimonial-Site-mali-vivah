# Matrimonial-Site-mali-vivah

Mali Vivah — trusted matrimony for the Mali Samaj. Built with Next.js 14 + Supabase.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your Supabase keys
npm run dev
```

## Database setup (Supabase)

Login & registration data is stored in Supabase (`profiles` + `login_history`
tables, auto-created profile rows, RLS, login audit). Full guide:

👉 **[supabase/README.md](supabase/README.md)** — 5-minute setup: create project →
add env vars → run every file in `supabase/migrations/` **in filename order** in the
SQL Editor → test register/login.

## What ships in this app

- **Registration / login** — one identifier field (email ID **or** mobile
  number) plus a password; mobile sign-in resolves the account server-side so
  the stored email never reaches the browser. Profiles auto-created, login
  audited, every registration + login recorded in one `activity_events` stream.
- **Visibility rules** — free members can build a full profile but stay hidden;
  paid members are public. Contact details unlock only after a *mutual, accepted*
  interest — payment alone never reveals a phone number.
- **Payments (Razorpay)** — `/packages` checkout, server-side signature verify +
  webhook, membership auto-activates on capture; expiry self-hides, renewal restores.
- **Daily 5 compatible matches, Mali Moments (24h photo + video, reportable),
  profile boosts (plan quota + à la carte purchase), homepage featured profiles,
  success stories, biodata PDF** (unlocked for the member and for mutual-accepted
  paid viewers).
- **Mobile verification by SMS OTP** (Supabase phone auth — configure an SMS
  provider in the project), **photo + ID document** verification tracks, and a
  member **Settings & privacy** page (`/profile/settings`: paid-viewer
  visibility toggles, WhatsApp opt-in, own block list).
- **In-app messaging at `/messages`** — paid members with a **mutual** match
  only. Conversations, messages, read state and unread badges live in
  Supabase with RLS; writes go exclusively through SECURITY DEFINER RPCs that
  re-check membership, mutual interest and blocks on every send, and new
  messages arrive live over Supabase Realtime. Payment alone never opens a
  chat, and a lapsed plan pauses messaging without deleting history.
- **Safety** — report + block, verification requests (photo/ID reviewed in admin).
- **Admin panel at `/admin`** — RBAC via `profiles.is_admin`, every mutation is a
  server action audited into `admin_audit_log`: dashboard, analytics (growth +
  engagement), members, verification queue (status/type filters), packages &
  pricing, payments (refund / manual recovery), reports, blocked users
  (searchable), boosts, moments moderation (incl. member reports), featured
  curation, stories, matching config, site content + WhatsApp config.
- **Admin → Members** — server-side filters (status, paid/free/expired,
  verified, featured, city, package) over one paged query, a per-member page
  (`/admin/members/[id]`: account, profile, family, photos, membership,
  verification, visibility, engagement, admin history) and every member
  action as an audited, state-aware server action: approve / send back,
  edit (allow-listed, community hierarchy validated), suspend / unsuspend,
  hide (admin hold) / unhide, reactivate, verify, feature, boost, manual
  paid activation and a typed-confirmation delete. Unsuspend / reactivate
  restore the status the member's real membership implies (paid → active,
  free → approved/hidden, lapsed → expired, draft → draft) — never a paid
  state without a payment. See `supabase/README.md` → "Admin member
  management".
- **Account deletion is self-serve and immediate** — the profile is hidden
  first (`delete_my_account()`), then photos are wiped and the auth user is
  removed. Payments / reports are retained in anonymised form. See
  `supabase/README.md` → "Personal-data lifecycle".

## Promoting the first admin

Admin access is data-only (no env var). In the Supabase SQL Editor:

```sql
UPDATE public.profiles SET is_admin = TRUE WHERE email = 'you@example.com';
```

Everyone else hitting `/admin` is redirected to `/login`.

## Support contact channels

WhatsApp/phone/email shown in the footer + the contact section of the About page
are operator-editable in **Admin → Content** and **Admin → WhatsApp**
(`site_content` / `whatsapp_config` tables, migration `20260919020000`). The
compiled fallbacks live in ONE place: `src/lib/contact.ts` — set the real
numbers before go-live.
(`src/app/contact/page.tsx` is only a redirect stub to `/about#contact`.)

## Database test harness

Repo-level PGlite harness (outside the deploy — own `package.json`, never
bundled) at `mv-db-tests/`:

```bash
cd mv-db-tests && npm install && npm test          # everything
cd mv-db-tests && npm test -- boosts               # one suite
```

It boots an in-process Postgres (PGlite) with a minimal Supabase shim
(`auth.users`, `auth.uid()`, the `anon` / `authenticated` / `service_role`
roles), applies **every** file in `supabase/migrations/` in filename order —
once as multi-statement scripts (SQL Editor style) and once wrapped in a
transaction each — re-applies the newest file to prove it is idempotent, and
then runs the suites in `mv-db-tests/tests/`. Tests impersonate members and
the service role the way PostgREST does, so RLS, GRANTs and SECURITY DEFINER
boundaries are the real ones.

* `boosts.test.mjs` — the Profile Boost system (156 checks): configured
  duration everywhere, package-quota isolation, purchase ↔ payment identity
  under stacking, refund safety + idempotency (cases A–E), expiry wording, no
  hard-coded 7 days, RLS/grants, account-deletion cascade, and the legacy
  backfill of migration 25 on a pre-existing database.

## Phase 1 acceptance audit (Step 13)

See **[the requirement-by-requirement audit](docs/audits/step13-phase1-audit.md)**
and **[migration/test evidence](docs/audits/step13-evidence.md)**. This is not
production sign-off: it documents remaining media/privacy, notification,
configuration and external-testing gaps. Migration
`20260920160000_audit_authorization_boundaries.sql` and the corresponding OTP
route must deploy together; they close confirmed direct-write authorization
defects without adding packages/offers or changing prices.
