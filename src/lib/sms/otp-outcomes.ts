/**
 * Pure OTP outcome vocabulary + provider-error classification.
 *
 * Deliberately dependency-free (no `server-only`, no env, no fetch) so the
 * database test harness can import and exercise it directly as the contract
 * both the API routes and the browser rely on. Nothing here talks to a
 * provider; it only maps a provider's answer onto a stable, member-safe
 * outcome.
 *
 * SECURITY: no OTP value, no full mobile number, no credential and no session
 * token may ever appear in anything produced by this module.
 */

/** Stable failure codes — mirrored into mobile_otp_requests.failure_code. */
export type OtpFailureCode =
  | 'OTP_PHONE_DISABLED'
  | 'OTP_SMS_NOT_CONFIGURED'
  | 'OTP_SMS_TEST_PROVIDER'
  | 'OTP_SMS_PROVIDER_MISMATCH'
  | 'OTP_SMS_UNREACHABLE'
  | 'OTP_RATE_LIMITED'
  | 'OTP_INVALID_PHONE'
  | 'OTP_PROVIDER_ERROR'

/** The shape supabase-js gives us for an auth error (code + status + message). */
export type ProviderError = {
  code?: string | null
  status?: number | null
  message?: string | null
}

export type SendFailure = {
  code: OtpFailureCode
  httpStatus: number
  /** Member-facing text. Specific about the situation, never about internals. */
  message: string
}

export type VerifyFailure = {
  code: 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_RATE_LIMITED'
  message: string
}

/** "9876543210" → "98•••••3210". Diagnostics and UI never carry the full number. */
export function maskMobile(mobile: string | null | undefined): string {
  const d = (mobile ?? '').replace(/\D/g, '')
  if (d.length < 6) return 'not-on-file'
  return `${d.slice(0, 2)}•••••${d.slice(-4)}`
}

/**
 * Member-facing wording for a preflight that proved the project cannot deliver
 * right now. Every one of these says plainly that NO code was sent, so the UI
 * can never show "OTP sent" for a configuration problem.
 */
export const PREFLIGHT_MESSAGES: Record<string, string> = {
  OTP_SMS_UNREACHABLE:
    'SMS status could not be confirmed on this deployment right now. No code was sent — please try again shortly.',
  OTP_PHONE_DISABLED:
    'Mobile verification is switched off on this deployment. No code was sent — please contact support.',
  OTP_SMS_NOT_CONFIGURED:
    'SMS delivery is not configured on this deployment yet. No code was sent — please contact support.',
  OTP_SMS_PROVIDER_MISMATCH:
    'SMS delivery is misconfigured on this deployment. No code was sent — please contact support.',
  OTP_SMS_TEST_PROVIDER:
    'SMS delivery is running in local test mode on this deployment, so no real code can be sent. Please contact support.',
}

const PHONE_DISABLED: SendFailure = {
  code: 'OTP_PHONE_DISABLED',
  httpStatus: 503,
  message: PREFLIGHT_MESSAGES.OTP_PHONE_DISABLED,
}
const SMS_NOT_CONFIGURED: SendFailure = {
  code: 'OTP_SMS_NOT_CONFIGURED',
  httpStatus: 503,
  message: PREFLIGHT_MESSAGES.OTP_SMS_NOT_CONFIGURED,
}
const RATE_LIMITED: SendFailure = {
  code: 'OTP_RATE_LIMITED',
  httpStatus: 429,
  message: 'Supabase has temporarily limited SMS sends. Please try again in a few minutes.',
}
const INVALID_PHONE: SendFailure = {
  code: 'OTP_INVALID_PHONE',
  httpStatus: 400,
  message: 'That mobile number was rejected. Update it on your profile and try again.',
}
const PROVIDER_ERROR: SendFailure = {
  code: 'OTP_PROVIDER_ERROR',
  httpStatus: 502,
  message:
    'The SMS provider refused to send the code just now. Nothing was delivered — please try again shortly.',
}

/**
 * Turn a GoTrue `signInWithOtp` failure into a precise outcome.
 *
 * supabase-js exposes GoTrue's stable error `code` (phone_provider_disabled,
 * sms_send_failed, over_sms_send_rate_limit, validation_failed, otp_disabled …)
 * so that is matched first; the HTTP status and the message text are the
 * fallbacks for older GoTrue builds. The previous route answered "SMS delivery
 * is not configured" for EVERY failure — a rate limit, a rejected number and a
 * provider outage all looked like a setup problem, and the provider's own
 * reason was thrown away with no log line. Nothing here is echoed to the
 * browser verbatim: the raw message goes to the server log only and the member
 * gets the stable sentence for the classified code.
 */
export function classifySendFailure(error: ProviderError): SendFailure {
  const code = (error.code ?? '').toString().toLowerCase()
  const status = typeof error.status === 'number' ? error.status : undefined
  const raw = (error.message ?? '').toLowerCase()

  if (code === 'phone_provider_disabled' || code === 'otp_disabled' || code === 'provider_disabled') {
    return PHONE_DISABLED
  }
  if (code === 'over_sms_send_rate_limit' || code === 'over_request_rate_limit') return RATE_LIMITED
  if (code === 'sms_send_failed') return PROVIDER_ERROR
  if (code === 'validation_failed') return INVALID_PHONE

  if (
    /phone (logins|sign.?ins?) (are |is )?disabled/.test(raw) ||
    /sms (logins? )?(are )?disabled/.test(raw) ||
    /phone.*(not|isn't).*enabled/.test(raw)
  ) {
    return PHONE_DISABLED
  }
  if (
    /sms provider/.test(raw) ||
    /provider.*(not|isn't)\s+configured/.test(raw) ||
    /no such (sms|provider)/.test(raw) ||
    /twilio|msg91|textlocal|vonage/.test(raw)
  ) {
    return SMS_NOT_CONFIGURED
  }
  if (status === 429 || /rate limit|too many (requests|sms)|for security purposes/.test(raw)) {
    return RATE_LIMITED
  }
  if (/invalid.*phone|phone.*invalid|not a valid phone/.test(raw)) return INVALID_PHONE
  if (status === 503 || status === 502 || status === 500) return PROVIDER_ERROR

  return PROVIDER_ERROR
}

/**
 * Classify a GoTrue `verifyOtp` failure.
 *
 * The endpoint is authenticated and the number is ALWAYS the caller's own
 * stored mobile, so distinguishing "expired" from "invalid" leaks nothing a
 * member does not already know — and the UI needs both states. Everything else
 * (wrong code, already-used code, no code outstanding) shares ONE generic
 * message: no probing.
 */
export function classifyVerifyFailure(error: ProviderError): VerifyFailure {
  const code = (error.code ?? '').toString().toLowerCase()
  const raw = (error.message ?? '').toLowerCase()

  if (
    code === 'over_sms_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    /rate limit|too many/.test(raw)
  ) {
    return {
      code: 'OTP_RATE_LIMITED',
      message: 'Too many attempts. Please wait a moment and request a new code.',
    }
  }
  if (code === 'otp_expired' || /otp_expired|token has expired|code has expired|expired/.test(raw)) {
    return { code: 'OTP_EXPIRED', message: 'That code has expired. Request a new one and try again.' }
  }
  return {
    code: 'OTP_INVALID',
    message: 'That code is invalid or has expired. Request a new one if needed.',
  }
}
