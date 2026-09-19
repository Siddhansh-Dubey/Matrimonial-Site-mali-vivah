import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { OTP_MAX_ATTEMPTS, codeMatches } from '@/lib/verification/otp'

export const dynamic = 'force-dynamic'

/**
 * Step 2 of mobile verification: check the 6-digit code.
 *
 * On success the route (service-role):
 *   1. marks profiles.mobile_verified,
 *   2. records a verification_requests row (type 'mobile', status
 *      'verified' — a direct insert, so the photo/ID decision trigger that
 *      grants the profile badge is deliberately NOT involved),
 *   3. notifies + logs the event.
 * Max 5 attempts per code; codes expire after 10 minutes.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'The database is not configured yet.' }, { status: 503 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }

  let body: { code?: string }
  try {
    body = (await req.json()) as { code?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const code = (body.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code from the SMS.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: otp } = await admin
    .from('mobile_otps')
    .select('id, code_hash, attempts, expires_at')
    .eq('user_id', user.id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!otp) {
    return NextResponse.json(
      { error: 'This code has expired — request a new one.', expired: true },
      { status: 400 }
    )
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await admin
      .from('mobile_otps')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id)
    return NextResponse.json(
      { error: 'Too many wrong attempts — request a new code.', expired: true },
      { status: 429 }
    )
  }

  if (!codeMatches(code, otp.code_hash)) {
    await admin
      .from('mobile_otps')
      .update({ attempts: otp.attempts + 1 })
      .eq('id', otp.id)
    const left = OTP_MAX_ATTEMPTS - otp.attempts - 1
    return NextResponse.json(
      { error: `Wrong code — ${left} attempt${left === 1 ? '' : 's'} left.`, attemptsLeft: left },
      { status: 400 }
    )
  }

  // ---- success ----
  await admin.from('mobile_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
  await admin.from('profiles').update({ mobile_verified: true }).eq('id', user.id)
  // Audit trail row (direct 'verified' insert — the decision trigger only
  // fires on status UPDATE, so no badge/notification side effects here).
  await admin.from('verification_requests').insert({
    user_id: user.id,
    type: 'mobile',
    status: 'verified',
    note: 'Verified by SMS one-time passcode.',
    reviewed_at: new Date().toISOString(),
  })
  await admin
    .rpc('push_notification', {
      p_user_id: user.id,
      p_type: 'profile_verified',
      p_title: 'Mobile number verified',
      p_message: 'Your mobile number is now verified. Thank you for helping keep Mali Vivah safe.',
      p_metadata: { verification_type: 'mobile' },
      p_link: '/profile',
    })
    .then(() => undefined, () => undefined)
  await admin
    .rpc('log_activity', {
      p_user_id: user.id,
      p_event: 'mobile_verified',
      p_metadata: {},
    })
    .then(() => undefined, () => undefined)

  return NextResponse.json({ ok: true })
}
