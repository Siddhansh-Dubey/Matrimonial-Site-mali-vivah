import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { env, requireServiceRoleKey } from '@/lib/env'

/**
 * Service-role client — bypasses RLS. Server-side only, never import this
 * from a Client Component.
 */
export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl, requireServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
