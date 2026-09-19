'use server'

/**
 * Self-serve account deletion.
 *
 * There is no "deletion request" step any more: confirming on the profile
 * page wipes the account immediately and irreversibly.
 *
 * How it works server-side (never client-side — this is the only path that
 * may delete an auth user):
 *   1. Storage files are removed first (profile + family photos, Mali
 *      Moments, verification docs). Everything a member uploads lives under
 *      a top-level folder named after their user id ("<uid>/…"), so wiping
 *      that prefix in each bucket wipes all of it.
 *   2. The auth user is deleted. Every table keyed to the profile id already
 *      declares ON DELETE CASCADE (profiles, matrimony_profiles, photo rows,
 *      interests, matches, shortlist, views, notifications, blocks, reports,
 *      moments, boosts, subscriptions, payments, login history, activity
 *      events…), so one delete removes the entire member footprint. Rows in
 *      tables owned by OTHER members that merely reference this account
 *      (audit log, admin references) are cleaned via CASCADE / SET NULL.
 *   3. The now-dead session cookies are cleared.
 *
 * Deliberately depends on NO custom RPCs or extra tables — it only needs the
 * base schema, so it works even on databases where later optional migrations
 * were never applied.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'

export type DeleteAccountResult = { ok: true } | { ok: false; error: string }

/** All buckets a member can have uploaded objects into. */
const MEMBER_BUCKETS = ['profile-photos', 'verification-docs'] as const
const MAX_SCAN_DEPTH = 3
const MAX_OBJECTS_PER_FOLDER = 1000

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/** Recursively collect file paths under a folder. Best-effort by design. */
async function collectFiles(
  admin: SupabaseAdmin,
  bucket: string,
  folder: string,
  depth: number
): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) return []
  const { data, error } = await admin.storage
    .from(bucket)
    .list(folder, { limit: MAX_OBJECTS_PER_FOLDER })
  if (error || !data) return []
  const paths: string[] = []
  for (const item of data) {
    const path = `${folder}/${item.name}`
    // Storage marks folders with a null metadata payload; anything else is a file.
    if (item.metadata === null || item.metadata === undefined) {
      paths.push(...(await collectFiles(admin, bucket, path, depth + 1)))
    } else {
      paths.push(path)
    }
  }
  return paths
}

/**
 * Recursively wipe everything a member uploaded (profile + family photos,
 * moments, verification docs). Exported so the admin delete action can reuse
 * the exact same logic.
 */
export async function wipeMemberFiles(admin: SupabaseAdmin, userId: string): Promise<void> {
  for (const bucket of MEMBER_BUCKETS) {
    try {
      const paths = await collectFiles(admin, bucket, userId, 1)
      if (paths.length > 0) await admin.storage.from(bucket).remove(paths)
    } catch {
      // A missing/disabled storage bucket must never block the deletion —
      // removing the auth user still takes every DB row with it.
    }
  }
}

export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'The database is not configured on this server yet.' }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You are signed out — please sign in again.' }

  let admin: SupabaseAdmin
  try {
    admin = createAdminClient()
  } catch {
    return { ok: false, error: 'This server is missing the service-role key required for deletion.' }
  }

  await wipeMemberFiles(admin, user.id)

  const { error } = await admin.auth.admin.deleteUser(user.id)
  // "Not found" means another tab/request already deleted the account — that
  // is the outcome we want, so treat it as success and just clean the session.
  if (error && !/not\s*found/i.test(error.message)) {
    return { ok: false, error: `Deletion failed: ${error.message}` }
  }

  // The auth user no longer exists — clear the local session cookies without
  // calling the auth API (scope: 'local' skips the network round-trip).
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Cookie header already committed or client already detached — harmless.
  }

  return { ok: true }
}

/**
 * Remove one of the caller's own blocks (Settings → Blocked members).
 * Runs in the member session: RLS ("Blocker manages own blocks") makes it
 * impossible to delete anyone else's row — the extra blocker_id filter is
 * belt and braces.
 */
export async function unblockMember(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured) throw new Error('The database is not configured on this server yet.')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('You are signed out — please sign in again.')

  const blockId = Number(formData.get('block_id'))
  if (!Number.isFinite(blockId)) throw new Error('Invalid request.')

  const { error } = await supabase.from('blocks').delete().eq('id', blockId).eq('blocker_id', user.id)
  if (error) throw new Error(error.message)
  revalidatePath('/profile/settings')
}
