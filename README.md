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

- **Registration / login** — profiles auto-created, login audited, every
  registration + login recorded in one `activity_events` stream.
- **Visibility rules** — free members can build a full profile but stay hidden;
  paid members are public. Contact details unlock only after a *mutual, accepted*
  interest — payment alone never reveals a phone number.
- **Payments (Razorpay)** — `/packages` checkout, server-side signature verify +
  webhook, membership auto-activates on capture; expiry self-hides, renewal restores.
- **Daily 5 compatible matches, Mali Moments (24h), profile boosts, homepage
  featured profiles, success stories, biodata PDF** (unlocked for the member and
  for mutual-accepted paid viewers).
- **Safety** — report + block, verification requests (photo/ID reviewed in admin).
- **Admin panel at `/admin`** — RBAC via `profiles.is_admin`, every mutation is a
  server action audited into `admin_audit_log`: members, verification queue,
  packages & pricing, payments (refund / manual recovery), reports, moments
  moderation, featured curation, stories, matching config, account deletions.

## Promoting the first admin

Admin access is data-only (no env var). In the Supabase SQL Editor:

```sql
UPDATE public.profiles SET is_admin = TRUE WHERE email = 'you@example.com';
```

Everyone else hitting `/admin` is redirected to `/login`.

## Support contact channels

WhatsApp/phone/email shown in the footer + the contact section of the About page
live in ONE place: `src/lib/contact.ts` — set the real numbers before go-live.
(`src/app/contact/page.tsx` is only a redirect stub to `/about#contact`.)

## Database test harness

Repo-level PGlite harness (outside the deploy) at `mv-db-tests/` executes all 15
migrations in both multi-statement and transaction modes and walks the full member
lifecycle: register → biodata → photos → preferences → free-hidden → pay →
auto-activate → appear in search → interest → accept → contact + PDF unlock →
expiry hides → renewal restores (142 checks).
