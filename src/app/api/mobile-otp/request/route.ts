import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured, smsEnv } from '@/lib/env'
import {
  capabilityMessage,
  checkSmsCapability,
  classifySendFailure,
  logOtp,
  maskMobile,
  type OtpFailureCode,
} from '@/lib/sms/otp-provider'

export const dynamic = 'force-dynamic'

/** Response contract the browser renders from — the UI never guesses. */
type RequestResult = {
  ok?: true
  error?: string
  code?: OtpFailureCode | 'NOT_CONFIGURED' | 'NOT_SIGNED_IN' | 'MOBILE_NOT_ON_FILE' | 'OTP_COOLDOWN' | 'OTP_LIMIT_EXCEEDED'
  /** 'real' = GoTrue accepted a genuine provider send, 'simulated' = local test provider. */
  delivery?: 'real' | 'simulated'
  provider?: string
  cooldown_seconds?: number
  retry_after_seconds?: number
  verify_window_minutes?: number
  max_per_hour?: number
  mobile_masked?: string
}

function json(body: RequestResult, status: number) {
  return NextResponse.json(body, { status })
}

/**
 * Member-facing wording for a preflight refusal lives with the classifiers in
 * `@/lib/sms/otp-outcomes` (via `capabilityMessage`) so the sentence the member
 * reads and the diagnostics code that is recorded can never drift apart.
 * Every one of them says plainly that NO code was sent, so the UI can never
 * show "OTP sent" for a configuration problem.
 */

/**
 * Mobile OTP verification — step 1: request a code.
 *
 * The OTP is generated and delivered by Supabase phone auth (GoTrue
 * signInWithOtp with the service role) using the SMS provider configured on
 * the Supabase project. This app NEVER generates, stores or fakes a code:
 *
 *   1. The member's OWN stored mobile is the only eligible number — it is read
 *      server-side, never accepted from the request body.
 *   2. The project's SMS capability is PRE-FLIGHTED (GoTrue /auth/v1/settings)
 *      BEFORE any rate-limit budget is spent, so a deployment that cannot
 *      deliver never burns a member's 5-per-hour allowance on phantom sends.
 *   3. request_mobile_otp() (security definer, migration 20260919000000,
 *      hardened in 20260921010000) enforces the rate limits (60s cooldown,
 *      5/hour) and records the attempt.
 *   4. Only then is the SMS sent, and the OUTCOME — accepted or refused — is
 *      recorded against that request row and reported to the browser verbatim.
 *      A provider failure is never presented as success.
 */
export async function POST() {
  if (!isSupabaseConfigured) {
    return json({ error: 'Supabase is not configured.', code: 'NOT_CONFIGURED' }, 503)
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    logOtp('request', 'rejected', { code: 'NOT_SIGNED_IN' })
    return json({ error: 'Please sign in.', code: 'NOT_SIGNED_IN' }, 401)
  }

  // -- 2. Capability preflight (no rate-limit slot is spent before this) -----
  const capability = await checkSmsCapability()
  if (!capability.ok) {
    logOtp('preflight', 'rejected', {
      userId: user.id,
      code: capability.code,
      detail: capability.detail,
      expectedProvider: smsEnv.expectedProvider || null,
      senderId: smsEnv.senderId || null,
    })
    return json({ error: capabilityMessage(capability.code), code: capability.code }, 503)
  }
  // Narrowed once, reused everywhere below (closures do not keep the narrowing).
  const providerName = capability.provider

  // -- 3. Server-side rate-limit gate + attempt record -----------------------
  const { data: gate, error: rpcError } = await supabase.rpc('request_mobile_otp')
  if (rpcError) {
    const msg = rpcError.message
    // OTP_COOLDOWN now carries the real remaining seconds from the database
    // ("OTP_COOLDOWN: please wait 42 seconds …") so the browser can render the
    // server's countdown instead of a guessed 60.
    const wait = /please wait (\d+) seconds/.exec(msg)?.[1]
    if (msg.includes('OTP_COOLDOWN')) {
      logOtp('request', 'rejected', { userId: user.id, code: 'OTP_COOLDOWN', retryAfter: Number(wait ?? 60) })
      return json(
        {
          error: 'Please wait a moment before requesting another code.',
          code: 'OTP_COOLDOWN',
          cooldown_seconds: 60,
          retry_after_seconds: Number(wait ?? 60),
        },
        429
      )
    }
    if (msg.includes('OTP_LIMIT_EXCEEDED')) {
      logOtp('request', 'rejected', { userId: user.id, code: 'OTP_LIMIT_EXCEEDED' })
      return json(
        {
          error: 'Too many verification attempts. Please try again in an hour.',
          code: 'OTP_LIMIT_EXCEEDED',
          retry_after_seconds: 3600,
        },
        429
      )
    }
    if (msg.includes('MOBILE_NOT_ON_FILE')) {
      logOtp('request', 'rejected', { userId: user.id, code: 'MOBILE_NOT_ON_FILE' })
      return json(
        { error: 'Add a valid 10-digit mobile number to your profile before verifying it.', code: 'MOBILE_NOT_ON_FILE' },
        400
      )
    }
    logOtp('request', 'error', { userId: user.id, detail: msg })
    return json({ error: 'Could not start verification. Please try again.' }, 500)
  }

  const gateResult = (gate ?? {}) as Record<string, unknown>
  const requestId = typeof gateResult.request_id === 'number' ? gateResult.request_id : null
  const cooldownSeconds = Number(gateResult.cooldown_seconds ?? 60)
  const verifyWindowMinutes = Number(gateResult.verify_window_minutes ?? 10)
  const maxPerHour = Number(gateResult.max_per_hour ?? 5)

  // The number the SMS goes to — always the member's own stored mobile.
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('mobile')
    .eq('id', user.id)
    .maybeSingle()
  const mobile = (profile?.mobile ?? '').replace(/\D/g, '')
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    logOtp('request', 'rejected', { userId: user.id, code: 'OTP_INVALID_PHONE', mobile: maskMobile(mobile) })
    return json({ error: 'No valid mobile number on file.', code: 'OTP_INVALID_PHONE' }, 400)
  }

  // Records the provider's verdict against the attempt (sent / failed). This
  // is diagnostics only — it can never set mobile_verified.
  async function recordDelivery(status: 'sent' | 'failed', failureCode?: string) {
    if (requestId === null) return
    try {
      await createAdminClient().rpc('record_mobile_otp_delivery', {
        p_request_id: requestId,
        p_user_id: user!.id,
        p_status: status,
        p_failure_code: failureCode ?? null,
        p_provider: providerName,
      })
    } catch (err) {
      // Losing a diagnostic row must not change the truthful answer we give
      // the member, but it must be loud for operators.
      console.error(
        `[MOBILE_OTP] delivery record failed (request=${requestId}):`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  try {
    const { error: otpError } = await admin.auth.signInWithOtp({
      phone: `+91${mobile}`,
      options: {
        // Explicit channel: never let a project default route this to WhatsApp.
        channel: 'sms',
        // Mali Vivah accounts are email-based, so GoTrue will create a
        // throwaway phone identity. That is intended and is cleaned up by the
        // verify route; the member's own account/session is never replaced.
        shouldCreateUser: true,
      },
    })

    if (otpError) {
      const failure = classifySendFailure(otpError)
      await recordDelivery('failed', failure.code)
      logOtp('send', 'rejected', {
        userId: user.id,
        requestId,
        code: failure.code,
        provider: providerName,
        mobile: maskMobile(mobile),
        // The provider's own reason — server log only, never the browser.
        providerMessage: otpError.message,
        providerStatus: otpError.status ?? null,
      })
      return json({ error: failure.message, code: failure.code, retry_after_seconds: cooldownSeconds }, failure.httpStatus)
    }

    await recordDelivery('sent')
    logOtp('send', capability.delivery === 'simulated' ? 'simulated' : 'ok', {
      userId: user.id,
      requestId,
      provider: providerName,
      mobile: maskMobile(mobile),
    })

    // TRUTHFUL SUCCESS ONLY. `delivery:'simulated'` means GoTrue's local test
    // provider accepted the send and nothing was actually delivered — the UI
    // must not claim an SMS is on its way.
    return json(
      {
        ok: true,
        delivery: capability.delivery,
        provider: capability.provider,
        cooldown_seconds: cooldownSeconds,
        verify_window_minutes: verifyWindowMinutes,
        max_per_hour: maxPerHour,
        mobile_masked: maskMobile(mobile),
      },
      200
    )
  } catch (err) {
    await recordDelivery('failed', 'OTP_PROVIDER_ERROR')
    logOtp('send', 'error', {
      userId: user.id,
      requestId,
      provider: providerName,
      mobile: maskMobile(mobile),
      detail: err instanceof Error ? err.message : String(err),
    })
    return json(
      { error: 'Could not send the verification code. Please try again.', code: 'OTP_PROVIDER_ERROR' },
      503
    )
  }
}
