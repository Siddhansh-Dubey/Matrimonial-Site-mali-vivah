import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Mobile OTP verification — step 1: request a code.
 *
 * The OTP is generated and delivered by Supabase phone auth (GoTrue
 * signInWithOtp with the service role) using the project's configured SMS
 * provider. This app NEVER generates or fakes a code itself:
 *
 *   1. The member's OWN stored mobile is the only eligible number.
 *   2. request_mobile_otp() (security definer, migration 20260919000000)
 *      enforces the rate limits (60s cooldown, 5/hour) and records the
 *      request before any SMS is spent.
 *   3. Only then is the SMS sent — if the project has no SMS provider
 *      configured, GoTrue fails and we surface a clear setup error instead
 *      of pretending.
 */
export async function POST() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }

  // Server-side gate first (cooldown / hourly limit / number on file).
  const { error: rpcError } = await supabase.rpc('request_mobile_otp')
  if (rpcError) {
    const msg = rpcError.message
    if (msg.includes('OTP_COOLDOWN')) {
      return NextResponse.json({ error: 'Please wait a minute before requesting another code.' }, { status: 429 })
    }
    if (msg.includes('OTP_LIMIT_EXCEEDED')) {
      return NextResponse.json({ error: 'Too many verification attempts. Please try again later.' }, { status: 429 })
    }
    if (msg.includes('MOBILE_NOT_ON_FILE')) {
      return NextResponse.json({ error: 'Add your mobile number before verifying it.' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Could not start verification. Please try again.' }, { status: 500 })
  }

  // The number the SMS goes to — always the member's own stored mobile.
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('mobile')
    .eq('id', user.id)
    .maybeSingle()
  const mobile = (profile?.mobile ?? '').replace(/\D/g, '')
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return NextResponse.json({ error: 'No valid mobile number on file.' }, { status: 400 })
  }

  try {
    const { error: otpError } = await admin.auth.signInWithOtp({
      phone: `+91${mobile}`,
    })
    if (otpError) {
      // No SMS provider configured (or provider rejected the send).
      return NextResponse.json(
        {
          error:
            'SMS delivery is not configured on this deployment yet. Please contact support — no code was sent.',
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: 'Could not send the verification code. Please try again.' },
      { status: 503 }
    )
  }
}
