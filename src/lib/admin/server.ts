import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import type { Json } from '@/lib/supabase/database.types'

/**
 * Admin gate — every /admin page AND every admin server action goes through
 * this. `is_admin` is a profiles flag checked through the SECURITY DEFINER
 * RPC so the check survives future RLS tightening. Admin actions run through
 * the service-role client and are audit-logged.
 */
export type AdminContext = {
  userId: string
  admin: ReturnType<typeof createAdminClient>
}

/** Throws-redirect variant for pages. */
export async function requireAdminPage(): Promise<AdminContext> {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (isAdmin !== true) redirect('/profile')
  return { userId: user.id, admin: createAdminClient() }
}

/** Error-throwing variant for server actions (JSON-safe failure). */
export async function requireAdminAction(): Promise<AdminContext> {
  if (!isSupabaseConfigured) throw new Error('Server not configured')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (isAdmin !== true) throw new Error('Admins only')
  return { userId: user.id, admin: createAdminClient() }
}

/** Elevated-action audit trail (service-only table; never rendered to members). */
export async function audit(
  ctx: AdminContext,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await ctx.admin.from('admin_audit_log').insert({
    admin_id: ctx.userId,
    action,
    target_type: targetType,
    target_id: targetId,
    details: details as Json,
  })
  if (error) {
    console.error(`[ADMIN_AUDIT_FAILURE] Action "${action}" failed to record in admin_audit_log:`, error.message)
    throw new Error(`Admin audit record failed: ${error.message}`)
  }
}
