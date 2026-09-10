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
add env vars → run `supabase/migrations/20260910000000_auth_profiles.sql` in the
SQL Editor → test register/login.
