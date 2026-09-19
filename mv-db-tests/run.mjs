#!/usr/bin/env node
// Mali Vivah DB test harness — entry point.
//
//   npm test                 → migrations (multi-statement + transaction mode)
//                              followed by every suite under tests/
//   npm test -- boosts       → only suites whose file name contains "boosts"
//
// Exit code is non-zero when any migration fails to apply or any check fails.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyMigrations, freshDb, migrationFiles } from './lib/harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'))

let failed = 0
const summaries = []

// 1. Migrations must apply cleanly in BOTH modes on an empty database.
for (const mode of ['multi', 'tx']) {
  const db = await freshDb()
  const t0 = Date.now()
  try {
    const applied = await applyMigrations(db, mode)
    console.log(`✔ ${applied.length}/${migrationFiles().length} migrations applied (${mode} mode) in ${Date.now() - t0} ms`)
  } catch (err) {
    failed += 1
    console.error(`✘ ${err.message}`)
  } finally {
    await db.close()
  }
}

// 2. Re-running the NEWEST migration on an already migrated database must be
//    a no-op (the file advertises "safe to re-run"). Older files are not
//    re-run as a set: some later files legitimately change a function's
//    return type, which CREATE OR REPLACE cannot do backwards.
{
  const db = await freshDb()
  try {
    await applyMigrations(db, 'multi')
    const latest = migrationFiles().at(-1)
    await applyMigrations(db, 'multi', [latest])
    await applyMigrations(db, 'tx', [latest])
    console.log(`✔ ${latest} is idempotent (re-applied twice on a migrated database)`)
  } catch (err) {
    failed += 1
    console.error(`✘ idempotency: ${err.message}`)
  } finally {
    await db.close()
  }
}

// 3. Behavioural suites.
const suiteFiles = readdirSync(join(here, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => filter.length === 0 || filter.some((k) => f.includes(k)))
  .sort()

for (const file of suiteFiles) {
  console.log(`\n── ${file} ──`)
  const mod = await import(pathToFileURL(join(here, 'tests', file)).href)
  const db = await freshDb()
  try {
    await applyMigrations(db, 'multi')
    const checks = await mod.default(db)
    summaries.push(checks.summary())
    if (checks.failed > 0) {
      failed += checks.failed
      for (const f of checks.failures) console.error(`   ✘ ${f}`)
    }
  } catch (err) {
    failed += 1
    console.error(`✘ ${file} crashed: ${err.stack ?? err.message}`)
  } finally {
    await db.close()
  }
}

console.log('\n' + summaries.join('\n'))
if (failed > 0) {
  console.error(`\n${failed} problem(s) — see above.`)
  process.exit(1)
}
console.log('\nAll database checks passed.')
