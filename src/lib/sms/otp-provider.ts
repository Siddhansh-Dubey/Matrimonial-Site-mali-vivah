import 'server-only'
import { env, smsEnv } from '@/lib/env'
import { PREFLIGHT_MESSAGES } from './otp-outcomes'
import type { OtpFailureCode } from './otp-outcomes'

/**
 * Mobile-OTP delivery capability + diagnostics.
 *
 * WHY THIS EXISTS
 *   The SMS is ALWAYS delivered by Supabase phone auth (GoTrue `signInWithOtp`
 *   with the service role) using the SMS provider configured on the Supabase
 *   project. This app never generates, stores or fakes a code — that does not
 *   change. What was missing was any way to know whether the project can
 *   actually deliver, so a deployment with phone auth disabled, no SMS provider,
 *   or GoTrue's local `test` provider (which accepts the send and delivers
 *   nothing) looked identical to a working one until a member complained that
 *   no code ever arrived.
 *
 *   This module reads GoTrue's OWN published capability endpoint
 *   (`GET /auth/v1/settings` → `{ external: { phone }, sms_provider }`) so the
 *   OTP route can:
 *     • refuse BEFORE `request_mobile_otp()` spends one of the member's
 *       5-per-hour slots on a send that could never arrive, and
 *     • tell the truth about what happened — "sent" only when the provider
 *       really accepted it, "simulated" when the test provider was allowed for
 *       local development, and a precise failure code otherwise.
 *
 * SPLIT WITH ./otp-outcomes
 *   The pure, dependency-free half — the failure-code vocabulary, the masking
 *   helper, the member-facing wording and the provider-error classifiers —
 *   lives in `./otp-outcomes.ts` so the database test harness can import and
 *   exercise the EXACT contract the routes use instead of re-implementing it.
 *   This file keeps only what genuinely needs a server: the env contract, the
 *   GoTrue capability probe and the structured log line.
 *
 * SECURITY
 *   Server-only (`import 'server-only'`). Nothing here holds an SMS credential:
 *   Twilio / MSG91 / Textlocal / Vonage secrets belong to the Supabase
 *   project's GoTrue configuration and must never be duplicated into this app
 *   or exposed to the browser. The only app-side variables are the *contract*
 *   ones in `smsEnv` (expected provider name, sender id for diagnostics, and
 *   the local-development test-provider flag). Diagnostics never contain an OTP
 *   value, a full mobile number, an API key or a session token.
 */

/**
 * Re-exported so server code has one import site (`@/lib/sms/otp-provider`)
 * while the harness imports the pure module directly.
 */
export {
  maskMobile,
  classifySendFailure,
  classifyVerifyFailure,
  PREFLIGHT_MESSAGES,
} from './otp-outcomes'
export type {
  OtpFailureCode,
  ProviderError,
  SendFailure,
  VerifyFailure,
} from './otp-outcomes'

export type SmsCapability =
  | { ok: true; provider: string; delivery: 'real' | 'simulated' }
  | { ok: false; code: OtpFailureCode; detail: string }

type GoTrueSettings = {
  external?: Record<string, boolean> | null
  sms_provider?: string | null
  phone_autoconfirm?: boolean | null
}

/** Short-lived cache: the project's auth config does not change per request. */
const CACHE_MS = 60_000
let cache: { at: number; value: GoTrueSettings | null } | null = null

/**
 * Structured server-side diagnostics for the OTP flow.
 * Deliberately narrow: outcome code, masked number, HTTP status and the
 * provider's own reason. Never an OTP value, never a key, never a full number.
 */
export function logOtp(
  stage: 'preflight' | 'request' | 'send' | 'verify' | 'complete',
  outcome: 'ok' | 'simulated' | 'rejected' | 'error',
  detail: Record<string, unknown> = {}
): void {
  const line = `[MOBILE_OTP] ${stage} ${outcome} ${JSON.stringify(detail)}`
  if (outcome === 'ok' || outcome === 'simulated') console.info(line)
  else console.error(line)
}

async function readGoTrueSettings(): Promise<GoTrueSettings | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  let value: GoTrueSettings | null = null
  try {
    const res = await fetch(`${env.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
      cache: 'no-store',
      // Never let a slow auth endpoint hang the member's request.
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) value = (await res.json()) as GoTrueSettings
  } catch {
    value = null
  }
  cache = { at: Date.now(), value }
  return value
}

/** Test hook: drop the cached settings so the next probe re-reads the project. */
export function resetSmsCapabilityCache(): void {
  cache = null
}

/**
 * Can this Supabase project actually deliver an SMS OTP right now?
 *
 * `sms_provider` absent from the payload means the GoTrue build does not
 * publish it — we cannot conclude anything, so the send is attempted and the
 * provider's own answer decides. An EMPTY string means "no provider", which is
 * a hard, provable misconfiguration.
 */
export async function checkSmsCapability(): Promise<SmsCapability> {
  const settings = await readGoTrueSettings()
  if (!settings) {
    return {
      ok: false,
      code: 'OTP_SMS_UNREACHABLE',
      detail: 'GoTrue /auth/v1/settings did not answer — SMS capability could not be confirmed.',
    }
  }
  if (settings.external && settings.external.phone !== true) {
    return {
      ok: false,
      code: 'OTP_PHONE_DISABLED',
      detail: 'Phone sign-in / phone OTP is disabled on this Supabase project.',
    }
  }

  const provider = typeof settings.sms_provider === 'string' ? settings.sms_provider.trim().toLowerCase() : null

  if (provider === '') {
    return {
      ok: false,
      code: 'OTP_SMS_NOT_CONFIGURED',
      detail: 'No SMS provider is configured on this Supabase project (GOTRUE_SMS_PROVIDER is empty).',
    }
  }

  if (provider === 'test') {
    // GoTrue's test provider ACCEPTS the send and delivers nothing. Claiming
    // "OTP sent" here would be a lie, so it is refused unless an operator has
    // explicitly opted in for local development — and even then the API
    // answers delivery:'simulated' and the UI says so.
    if (!smsEnv.allowTestProvider) {
      return {
        ok: false,
        code: 'OTP_SMS_TEST_PROVIDER',
        detail:
          "The project's SMS provider is GoTrue's local 'test' provider, which never sends a real SMS.",
      }
    }
    return { ok: true, provider: 'test', delivery: 'simulated' }
  }

  if (provider === null) {
    // Older GoTrue build that does not publish sms_provider: inconclusive, so
    // let the real send decide and log that we could not pre-verify.
    return { ok: true, provider: 'unknown', delivery: 'real' }
  }

  if (smsEnv.expectedProvider && smsEnv.expectedProvider !== provider) {
    return {
      ok: false,
      code: 'OTP_SMS_PROVIDER_MISMATCH',
      detail: `Project reports sms_provider="${provider}" but this deployment expects "${smsEnv.expectedProvider}".`,
    }
  }

  return { ok: true, provider, delivery: 'real' }
}

/** Member-facing sentence for a preflight refusal (never reveals internals). */
export function capabilityMessage(code: OtpFailureCode): string {
  return PREFLIGHT_MESSAGES[code] ?? PREFLIGHT_MESSAGES.OTP_SMS_UNREACHABLE
}
