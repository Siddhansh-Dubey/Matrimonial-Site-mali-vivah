'use server'

/**
 * Self-serve account deletion.
 *
 * Confirming on the profile page retires the account immediately.
 *
 * Server-side order (never client-side — this is the only path that may
 * delete an auth user from a member session):
 *   1. `delete_my_account()` RPC (auth.uid() only) hides the profile FIRST
 *      (`profiles.is_active = false`) so a later failure can never leave the
 *      member ACTIVE_PAID / searchable / featured / contactable. Contact is
 *      anonymised; payments / subscriptions / reports are detached (retained).
 *   2. Storage files are wiped (profile + family photos, Mali Moments,
 *      verification docs). Everything a member uploads lives under a
 *      top-level folder named after their user id (`<uid>/…`).
 *   3. The auth user is deleted. Personal tables CASCADE; payments,
 *      subscriptions, reports, activity_events and admin_audit_log survive
 *      via ON DELETE SET NULL.
 *   4. The now-dead session cookies are cleared.
 *
 * If step 3 fails after step 1, the profile is already not public. Retrying
 * this action is idempotent.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import type { Json } from '@/lib/supabase/database.types'

export type DeleteAccountResult = { ok: true } | { ok: false; error: string }

export type PrivacySettingsPatch = {
  show_about?: boolean
  show_family_details?: boolean
  show_family_photo?: boolean
  show_income?: boolean
}

export type UpdatePrivacyResult =
  | { ok: true; settings: Record<string, Json> }
  | { ok: false; error: string }

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
 * the exact same logic. Never touches shared/admin-managed assets outside
 * the member's own `<uid>/` prefix.
 */
export async function wipeMemberFiles(admin: SupabaseAdmin, userId: string): Promise<void> {
  for (const bucket of MEMBER_BUCKETS) {
    try {
      const paths = await collectFiles(admin, bucket, userId, 1)
      if (paths.length > 0) await admin.storage.from(bucket).remove(paths)
    } catch {
      // A missing/disabled storage bucket must never block the deletion —
      // the RPC already hid the profile; removing the auth user still takes
      // personal DB rows with it.
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

  // Hide + anonymise + detach FIRST, as the signed-in member. The RPC has
  // no user_id argument — it always acts on auth.uid() — so a crafted call
  // cannot name another member.
  const { error: retireError } = await supabase.rpc('delete_my_account')
  if (retireError && !/not\s*found|already_deleted|PROFILE_NOT_FOUND/i.test(retireError.message)) {
    return { ok: false, error: `Deletion failed: ${retireError.message}` }
  }

  let admin: SupabaseAdmin
  try {
    admin = createAdminClient()
  } catch {
    // Profile is already hidden. Storage / auth removal needs the service role.
    return {
      ok: false,
      error: 'Your profile is no longer public. This server is missing the service-role key required to finish deleting the login.',
    }
  }

  await wipeMemberFiles(admin, user.id)

  const { error } = await admin.auth.admin.deleteUser(user.id)
  // "Not found" means another tab/request already deleted the account — that
  // is the outcome we want, so treat it as success and just clean the session.
  if (error && !/not\s*found/i.test(error.message)) {
    return {
      ok: false,
      error: `Your profile is no longer public, but the login could not be removed: ${error.message}`,
    }
  }

  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Cookie header already committed or client already detached — harmless.
  }

  return { ok: true }
}

/**
 * Writes the caller's own privacy_settings through the allow-listed RPC.
 * Unknown keys are rejected server-side; WhatsApp opt-in is a separate column.
 */
export async function updateMyPrivacySettings(
  patch: PrivacySettingsPatch
): Promise<UpdatePrivacyResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'The database is not configured on this server yet.' }
  }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You are signed out — please sign in again.' }

  const { data, error } = await supabase.rpc('update_my_privacy_settings', {
    p_settings: patch as Json,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/profile/settings')
  revalidatePath(`/profile/${user.id}`)
  return { ok: true, settings: (data ?? {}) as Record<string, Json> }
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
