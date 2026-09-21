/**
 * Centralised environment access.
 * `isSupabaseConfigured` lets the UI render a helpful setup notice instead of
 * crashing when the project has not been connected to Supabase yet.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
}

export const isSupabaseConfigured =
  url.startsWith('http') && !url.includes('YOUR-PROJECT-REF') && anonKey.length > 20

export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return key
}

/** Razorpay server-side credentials (see src/lib/payments/razorpay.ts). */
export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

/**
 * Mobile-OTP / SMS delivery configuration (see src/lib/sms/otp-provider.ts).
 *
 * The SMS itself is ALWAYS delivered by Supabase phone auth (GoTrue) using the
 * SMS provider configured on the Supabase project — the provider credentials
 * (Twilio / MSG91 / Textlocal / Vonage …) live in that project's auth
 * configuration, never in this app and never in the browser.
 *
 * What this app holds is the *contract*: which provider the deployment expects
 * GoTrue to use, so a misconfigured project fails loudly with a precise reason
 * instead of silently burning a member's OTP budget. All of these are
 * server-only (no NEXT_PUBLIC_ prefix), so nothing reaches the client bundle.
 */
export const smsEnv = {
  /**
   * Expected GoTrue `sms_provider` (e.g. `twilio`, `msg91`, `textlocal`,
   * `vonage`). Optional. When set, the OTP request route verifies the live
   * project reports the same provider before spending a rate-limit slot.
   */
  expectedProvider: (process.env.SUPABASE_SMS_PROVIDER ?? '').trim().toLowerCase(),
  /**
   * DLU-approved sender id / mask, recorded in server-side diagnostics only
   * (it is a Supabase-project GoTrue setting; this app never sends SMS itself).
   */
  senderId: (process.env.SUPABASE_SMS_SENDER_ID ?? '').trim(),
  /**
   * LOCAL DEVELOPMENT ONLY. GoTrue's built-in `test` SMS provider accepts the
   * send and delivers nothing, so without this flag the route refuses to claim
   * a code was sent. Set to `true` to let a local project proceed; the API then
   * answers `delivery: 'simulated'` and the UI says so explicitly — it never
   * shows "OTP sent".
   */
  allowTestProvider: (process.env.MOBILE_OTP_ALLOW_TEST_PROVIDER ?? '').trim().toLowerCase() === 'true',
}
