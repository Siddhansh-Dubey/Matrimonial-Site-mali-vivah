import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import {
  OTP_MAX_SENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  generateCode,
  hashCode,
  normalizeMobile,
} from '@/lib/verification/otp'
import { sendOtpSms } from '@/lib/verification/sms'

export const dynamic = 'force-dynamic'

/**
 * Step 1 of mobile verification: issue a 6-digit code by SMS.
 *
 * Only the SHA-256 hash is stored (mobile_otps is service-role-only).
 * Rate limits: 60s between sends, max 5 sends/hour. The code itself is
 * returned ONLY outside production and ONLY when no SMS provider is
 * configured — the local-dev path. Production never leaks it.
 */
export async function POST() {
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

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('mobile, mobile_verified')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.mobile_verified) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }
  const rawMobile = (profile?.mobile ?? '').trim()
  if (!rawMobile) {
    return NextResponse.json(
      { error: 'No mobile number on your account — add one during registration or contact support.' },
      { status: 400 }
    )
  }
  const mobile = normalizeMobile(rawMobile)
  if (mobile.length !== 10) {
    return NextResponse.json(
      { error: 'Your saved mobile number looks incomplete — please contact support to update it.' },
      { status: 400 }
    )
  }

  const now = Date.now()
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const { data: recent } = await admin
    .from('mobile_otps')
    .select('created_at')
    .eq('user_id', user.id)
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false })
    .limit(OTP_MAX_SENDS_PER_HOUR)

  if ((recent?.length ?? 0) >= OTP_MAX_SENDS_PER_HOUR) {
    return NextResponse.json(
      { error: 'Too many codes requested. Please try again in an hour.' },
      { status: 429 }
    )
  }
  const lastSentAt = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0
  const cooldownLeft = OTP_RESEND_COOLDOWN_SECONDS - Math.floor((now - lastSentAt) / 1000)
  if (lastSentAt && cooldownLeft > 0) {
    return NextResponse.json(
      { error: `Please wait ${cooldownLeft}s before requesting a new code.`, retryAfter: cooldownLeft },
      { status: 429 }
    )
  }

  // Supersede any outstanding codes before issuing a fresh one.
  await admin
    .from('mobile_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('consumed_at', null)

  const code = generateCode()
  const { error: insertError } = await admin.from('mobile_otps').insert({
    user_id: user.id,
    mobile,
    code_hash: hashCode(code),
    expires_at: new Date(now + OTP_TTL_SECONDS * 1000).toISOString(),
  })
  if (insertError) {
    return NextResponse.json({ error: 'Could not issue a code. Please try again.' }, { status: 500 })
  }

  const sms = await sendOtpSms(mobile, code)
  if (!sms.sent) {
    // The code row exists but no SMS left the building — the member can
    // retry after the cooldown; do not burn their hourly quota on this.
    await admin.from('mobile_otps').delete().eq('user_id', user.id).is('consumed_at', null)
    return NextResponse.json(
      { error: 'Could not send the SMS right now. Please try again in a minute.' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    channel: sms.provider,
    // Local-dev convenience only — never present in production.
    ...(process.env.NODE_ENV !== 'production' && sms.provider === 'dev' ? { devCode: code } : {}),
  })
}
