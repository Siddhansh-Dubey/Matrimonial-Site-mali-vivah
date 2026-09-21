import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import { classifyVerifyFailure, logOtp, maskMobile } from '@/lib/sms/otp-provider'

export const dynamic = 'force-dynamic'

/**
 * Mobile OTP verification — step 2: verify the entered code.
 *
 * The code is validated by Supabase (GoTrue verifyOtp with the service key)
 * — never by this app, and never from anything in the request body except the
 * digits themselves. The number is re-read server-side from the member's own
 * profile row, so a client cannot point the verification at another number.
 * Only after Supabase confirms the code does the service-only RPC
 * complete_mobile_otp_verification(user, mobile) flip profiles.mobile_verified
 * — and since migration 20260921010000 that RPC also refuses a request window
 * whose provider delivery was recorded as FAILED. There is no path to mark a
 * number verified without a real, provider-delivered OTP.
 *
 * Housekeeping: verifying a phone identity may create a throwaway phone-auth
 * user in auth.users. If it has no email (it can never be a real account —
 * every Mali Vivah account is email-based), we delete it immediately so the
 * user table is not polluted.
 *
 * Diagnostics: every outcome is logged server-side with a stable code, the
 * member id and a MASKED number. The entered code is never logged, never
 * stored and never echoed back.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.', code: 'NOT_CONFIGURED' }, { status: 503 })
  }

  let body: { otp?: string }
  try {
    body = (await req.json()) as { otp?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request.', code: 'BAD_REQUEST' }, { status: 400 })
  }
  const otp = (body.otp ?? '').trim()
  if (!/^\d{4,8}$/.test(otp)) {
    // Same generic message for empty and malformed input — no probing, and the
    // digits themselves never reach a log line.
    logOtp('verify', 'rejected', { code: 'OTP_MALFORMED' })
    return NextResponse.json(
      { error: 'Enter the 6-digit code from the SMS.', code: 'OTP_MALFORMED' },
      { status: 400 }
    )
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    logOtp('verify', 'rejected', { code: 'NOT_SIGNED_IN' })
    return NextResponse.json({ error: 'Please sign in.', code: 'NOT_SIGNED_IN' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('mobile')
    .eq('id', user.id)
    .maybeSingle()
  const mobile = (profile?.mobile ?? '').replace(/\D/g, '')
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    logOtp('verify', 'rejected', { userId: user.id, code: 'MOBILE_NOT_ON_FILE' })
    return NextResponse.json(
      { error: 'No valid mobile number on file.', code: 'MOBILE_NOT_ON_FILE' },
      { status: 400 }
    )
  }

  let verified: { user?: { id: string; email?: string | null; phone?: string } | null } = {}
  try {
    const { data, error } = await admin.auth.verifyOtp({
      phone: `+91${mobile}`,
      token: otp,
      type: 'sms',
    })
    if (error || !data?.user || data.user.phone?.replace(/\D/g, '') !== `91${mobile}`) {
      const failure = classifyVerifyFailure({
        code: error?.code,
        status: error?.status,
        // A provider-side mismatch (right code, wrong identity) is treated as
        // an invalid code — it must never complete verification.
        message: error?.message ?? 'provider phone identity did not match the stored number',
      })
      logOtp('verify', 'rejected', {
        userId: user.id,
        code: failure.code,
        mobile: maskMobile(mobile),
        phoneMatched: Boolean(data?.user && data.user.phone?.replace(/\D/g, '') === `91${mobile}`),
        providerMessage: error?.message ?? null,
        providerCode: error?.code ?? null,
      })
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: 400 })
    }
    verified = { user: data.user }
  } catch (err) {
    logOtp('verify', 'error', {
      userId: user.id,
      mobile: maskMobile(mobile),
      detail: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: 'Could not verify the code. Please try again.', code: 'OTP_PROVIDER_ERROR' },
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
    logOtp('complete', 'error', {
      userId: user.id,
      mobile: maskMobile(mobile),
      detail: completeError.message,
    })
    return NextResponse.json(
      {
        error:
          completeError.message.includes('OTP_REQUEST_REQUIRED')
            ? 'No open code request was found for this number. Request a new code and try again.'
            : 'The code was valid, but saving the verification failed. Please try again.',
        code: completeError.message.includes('OTP_REQUEST_REQUIRED') ? 'OTP_REQUEST_REQUIRED' : 'COMPLETE_FAILED',
      },
      { status: completeError.message.includes('OTP_REQUEST_REQUIRED') ? 400 : 500 }
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

  logOtp('complete', 'ok', { userId: user.id, mobile: maskMobile(mobile) })
  return NextResponse.json({ ok: true })
}
