'use server'

/**
 * Mobile-number sign-in for the login form.
 *
 * Supabase passwords live on the email address, so "log in with my mobile"
 * means: resolve the account behind the UNIQUE profiles.mobile with the
 * service role (a signed-out browser could never read another member's row),
 * then perform the password sign-in server-side so the stored email is never
 * handed to the browser to type back in. Unknown numbers and wrong passwords
 * return the SAME generic failure, so this cannot be used to enumerate which
 * mobile numbers have accounts.
 */
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'

export type MobileSignInResult = { ok: true } | { ok: false; error: 'invalid' | 'unavailable' }

export async function signInWithMobile(
  mobileDigits: string,
  password: string
): Promise<MobileSignInResult> {
  if (!isSupabaseConfigured || !password) return { ok: false, error: 'unavailable' }
  if (!/^[6-9]\d{9}$/.test(mobileDigits)) return { ok: false, error: 'invalid' }

  try {
    const admin = createAdminClient()
    // Depending on the write path the number is stored raw ("7412589630") or
    // with the form's spacing ("74125 89630") — accept both.
    const formatted = `${mobileDigits.slice(0, 5)} ${mobileDigits.slice(5)}`
    const { data: member } = await admin
      .from('profiles')
      .select('email')
      .in('mobile', [mobileDigits, formatted])
      .maybeSingle()
    if (!member?.email) return { ok: false, error: 'invalid' }

    const supabase = createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: member.email,
      password,
    })
    if (error || !data.user) return { ok: false, error: 'invalid' }

    // Audit the login (last_login_at / login_count / login_history row).
    // Non-fatal: a logging failure must never block a successful sign-in.
    await supabase.rpc('record_login').then(() => undefined, () => undefined)

    // Deliberately returns nothing else: the account's stored email is never
    // handed to the browser. "Remember me" keeps the mobile the member typed.
    return { ok: true }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}
