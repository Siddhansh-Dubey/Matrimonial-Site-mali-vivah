// Mali Vivah DB test harness — shared helpers.
//
// Everything runs inside ONE in-process PGlite Postgres. Tests impersonate a
// member exactly the way PostgREST does (request.jwt.claim.sub + SET ROLE
// authenticated), so RLS, GRANTs and SECURITY DEFINER boundaries are the
// real ones from the migration files, not mocks.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '..', '..')
export const migrationsDir = join(repoRoot, 'supabase', 'migrations')

export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** Boot a fresh database with the Supabase shim applied. */
export async function freshDb() {
  const db = new PGlite()
  await db.exec(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'))
  return db
}

/**
 * Apply every migration in filename order.
 *   mode 'multi' — each file is executed as one multi-statement script, the
 *                  way the Supabase SQL Editor / CLI apply it.
 *   mode 'tx'    — each file is additionally wrapped in BEGIN … COMMIT, which
 *                  proves the file is safe as a single transaction (no enum
 *                  value used in the transaction that created it, etc.).
 */
export async function applyMigrations(db, mode = 'multi', files = migrationFiles()) {
  const applied = []
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    try {
      if (mode === 'tx') {
        await db.exec(`BEGIN;\n${sql}\nCOMMIT;`)
      } else {
        await db.exec(sql)
      }
    } catch (err) {
      if (mode === 'tx') {
        try { await db.exec('ROLLBACK;') } catch { /* nothing open */ }
      }
      err.message = `[migration ${file} · ${mode}] ${err.message}`
      throw err
    }
    applied.push(file)
  }
  return applied
}

// ---------------------------------------------------------------------------
// Minimal assertion runner (no framework: keeps the harness dependency-free
// apart from PGlite, and prints one line per check like the lifecycle walk).
// ---------------------------------------------------------------------------
export class Checks {
  constructor(title) {
    this.title = title
    this.passed = 0
    this.failed = 0
    this.failures = []
  }

  check(name, condition, detail) {
    if (condition) {
      this.passed += 1
      console.log(`  ✔ ${name}`)
    } else {
      this.failed += 1
      const extra = detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
      this.failures.push(`${name}${extra}`)
      console.log(`  ✘ ${name}${extra}`)
    }
  }

  equal(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    this.check(name, ok, ok ? undefined : { actual, expected })
  }

  summary() {
    return `${this.title}: ${this.passed} passed, ${this.failed} failed`
  }
}

/** Run `fn` expecting it to throw; returns the error message ('' if it did not throw). */
export async function expectError(fn) {
  try {
    await fn()
    return ''
  } catch (err) {
    return err?.message ?? String(err)
  }
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

/** Run a callback as a signed-in member (RLS + GRANTs of `authenticated`). */
export async function asUser(db, userId, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);
                 SELECT set_config('request.jwt.claim.role', 'authenticated', false);
                 SET ROLE authenticated;`)
  try {
    return await fn()
  } finally {
    // Inside an aborted transaction this would itself fail and mask the real
    // error; the ROLLBACK that follows restores the role anyway.
    try {
      await db.exec(`RESET ROLE;
                     SELECT set_config('request.jwt.claim.sub', '', false);
                     SELECT set_config('request.jwt.claim.role', '', false);`)
    } catch { /* aborted transaction — see above */ }
  }
}

/** Run a callback as the service role (RLS bypass, service-only RPCs). */
export async function asService(db, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);
                 SELECT set_config('request.jwt.claim.role', 'service_role', false);
                 SET ROLE service_role;`)
  try {
    return await fn()
  } finally {
    try {
      await db.exec(`RESET ROLE;
                     SELECT set_config('request.jwt.claim.role', '', false);`)
    } catch { /* aborted transaction — see asUser */ }
  }
}

/** Convenience: first row of a query (as superuser / current role). */
export async function one(db, sql, params = []) {
  const r = await db.query(sql, params)
  return r.rows[0] ?? null
}

/** Convenience: scalar of the first column of the first row. */
export async function scalar(db, sql, params = []) {
  const row = await one(db, sql, params)
  if (!row) return null
  return row[Object.keys(row)[0]]
}

/**
 * Register a member the way Supabase Auth would: insert into auth.users and
 * let the handle_new_user trigger create public.profiles (+ the matrimony
 * draft rows). Returns the new user id.
 */
export async function signUp(db, { email, name, mobile, forWhom = 'self' }) {
  const row = await one(
    db,
    `INSERT INTO auth.users (email, raw_user_meta_data, email_confirmed_at)
     VALUES ($1, $2::jsonb, now())
     RETURNING id`,
    [email, JSON.stringify({ full_name: name, phone: mobile, for_whom: forWhom })]
  )
  return row.id
}

/**
 * Publish-ready matrimony profile: fills the publish gate's required fields
 * (gender, DOB, city, education, occupation) + a profile photo and a family
 * photo, so activate_membership() can flip the profile to 'active'.
 */
export async function completeProfile(db, userId, { gender = 'male' } = {}) {
  await db.query(
    `UPDATE public.matrimony_profiles
     SET gender = $2::public.gender,
         date_of_birth = (now() - interval '28 years')::date,
         city = 'Pune',
         education = 'B.E.',
         occupation = 'Engineer'
     WHERE user_id = $1`,
    [userId, gender]
  )
  await db.query(
    `INSERT INTO public.profile_photos (profile_id, storage_path, is_primary, sort_order, kind)
     VALUES ($1::uuid, $1::text || '/profile.jpg', TRUE, 0, 'profile_photo'),
            ($1::uuid, $1::text || '/family.jpg', FALSE, 1, 'family_photo')`,
    [userId]
  )
}

/** Service-role activation of a package (manual activation path, no payment). */
export async function activatePackage(db, userId, slug) {
  const pkg = await one(db, `SELECT id FROM public.packages WHERE slug = $1`, [slug])
  if (!pkg) throw new Error(`package ${slug} not found`)
  return asService(db, async () =>
    one(db, `SELECT public.activate_membership($1, $2, NULL) AS r`, [userId, pkg.id])
  )
}
