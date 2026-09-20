import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Mobile OTP verification — step 2: verify the entered code.
 *
 * The code is validated by Supabase (GoTrue verifyOtp with the service key)
 * — never by this app. Only after Supabase confirms the code does the
 * service-only RPC complete_mobile_otp_verification(user, mobile) flip
 * profiles.mobile_verified. There is no path to mark a number verified
 * without a real, provider-delivered OTP.
 *
 * Housekeeping: verifying a phone identity may create a throwaway phone-auth
 * user in auth.users. If it has no email (it can never be a real account —
 * every Mali Vivah account is email-based), we delete it immediately so the
 * user table is not polluted.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })
  }

  let body: { otp?: string }
  try {
    body = (await req.json()) as { otp?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const otp = (body.otp ?? '').trim()
  if (!/^\d{4,8}$/.test(otp)) {
    // Same generic message for empty and malformed input — no probing.
    return NextResponse.json({ error: 'Enter the 6-digit code from the SMS.' }, { status: 400 })
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
    .select('mobile')
    .eq('id', user.id)
    .maybeSingle()
  const mobile = (profile?.mobile ?? '').replace(/\D/g, '')
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return NextResponse.json({ error: 'No valid mobile number on file.' }, { status: 400 })
  }

  let verified: { user?: { id: string; email?: string | null; phone?: string } | null } = {}
  try {
    const { data, error } = await admin.auth.verifyOtp({
      phone: `+91${mobile}`,
      token: otp,
      type: 'sms',
    })
    if (error || !data?.user || data.user.phone?.replace(/\D/g, '') !== `91${mobile}`) {
      // Wrong / expired / already-used code — one generic message, nothing
      // that reveals which attempt failed.
      return NextResponse.json(
        { error: 'That code is invalid or has expired. Request a new one if needed.' },
        { status: 400 }
      )
    }
    verified = { user: data.user }
  } catch {
    return NextResponse.json(
      { error: 'Could not verify the code. Please try again.' },
      { status: 503 }
    )
  }

  // A fresh service client is required: verifyOtp can replace the auth
  // session on its client with the phone identity. Never expose completion
  // to a member JWT, and bind the original member to the number just proved.
  const { error: completeError } = await createAdminClient().rpc('complete_mobile_otp_verification', {
    p_user_id: user.id,
    p_mobile: mobile,
  })
  if (completeError) {
    return NextResponse.json(
      { error: 'The code was valid, but saving the verification failed. Please try again.' },
      { status: 500 }
    )
  }

  // Best-effort cleanup of the throwaway phone-identity user, if GoTrue
  // created one. A real Mali Vivah account always has an email, so a
  // null-email user is by definition not a member account.
  const phoneUser = verified.user
  if (phoneUser && !phoneUser.email && phoneUser.id !== user.id) {
    try {
      await admin.auth.admin.deleteUser(phoneUser.id)
    } catch {
      // Harmless: the orphan cannot sign in without another OTP and has no
      // profile row (the signup trigger skips email-less users).
    }
  }

  return NextResponse.json({ ok: true })
}
