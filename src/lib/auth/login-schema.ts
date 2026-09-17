import { z } from 'zod'

/**
 * Sign-in identity: ONE identifier field + the password.
 *
 * The identifier is EITHER the registered email ID OR the registered mobile
 * number — the member never has to think about which one the form wants.
 * `parseIdentifier()` decides:
 *   • anything containing "@" must be a well-formed email address,
 *   • anything else must normalise to a 10-digit Indian mobile number
 *     (leading +91 / 91 / 0 and any spaces, dots or hyphens are tolerated).
 *
 * Both failures produce the SAME generic message, so the form cannot be used
 * to probe which emails or mobile numbers have an account. The password is
 * always required; only Supabase Auth ever sees it.
 */

/** Pragmatic email shape check (Supabase Auth does the authoritative validation). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Stored representation: 10 digits, Indian mobile series 6-9. */
export const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/

export type LoginIdentifier =
  | { kind: 'email'; value: string }
  | { kind: 'mobile'; value: string }

export type LoginInput = {
  /** Exactly what the member typed (used for "remember me"). */
  identifier: string
  password: string
  /** The resolved credential — email address or normalised 10-digit mobile. */
  credential: LoginIdentifier
}

/**
 * Normalise anything a member might type as a mobile number to the stored
 * 10-digit form, or return null when it is not a usable Indian mobile:
 *   "9876543210" → "9876543210"
 *   "+91 9876543210" → "9876543210"
 *   "98765-43210" → "9876543210"
 *   "09876543210" → "9876543210"
 *   "00919876543210" → "9876543210"
 * Only recognised country/trunk prefixes are stripped: an 11-digit number
 * that is NOT "0…" is rejected rather than silently truncated, so a typo
 * cannot quietly sign in as somebody else's number.
 */
export function normalizeMobile(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  const PREFIXES: [RegExp, number][] = [
    [/^\d{10}$/, 0], // 9876543210
    [/^0\d{10}$/, 1], // 09876543210 (trunk prefix)
    [/^91\d{10}$/, 2], // 919876543210
    [/^0091\d{10}$/, 4], // 00919876543210
  ]
  for (const [pattern, strip] of PREFIXES) {
    if (pattern.test(digits)) {
      const candidate = digits.slice(strip)
      if (INDIAN_MOBILE_RE.test(candidate)) return candidate
    }
  }
  return null
}

/** Classify one typed identifier. Never throws, never queries anything. */
export function parseIdentifier(raw: string | null | undefined): LoginIdentifier | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (value.includes('@')) {
    return EMAIL_RE.test(value) ? { kind: 'email', value: value.toLowerCase() } : null
  }
  const mobile = normalizeMobile(value)
  return mobile ? { kind: 'mobile', value: mobile } : null
}

/**
 * The login schema. Refinement reports machine-readable codes so the form can
 * pick the right translated message; the transform attaches the resolved
 * credential so callers never re-parse the identifier.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim(),
    password: z.string(),
  })
  .superRefine((data, ctx) => {
    if (!data.identifier) {
      ctx.addIssue({ code: 'custom', message: 'identifier-required', path: ['identifier'] })
    } else if (!parseIdentifier(data.identifier)) {
      ctx.addIssue({ code: 'custom', message: 'invalid-identifier', path: ['identifier'] })
    }
    if (!data.password) {
      ctx.addIssue({ code: 'custom', message: 'password-required', path: ['password'] })
    }
  })
  .transform((data): LoginInput => ({
    identifier: data.identifier,
    password: data.password,
    // Safe: the refinement above already rejected anything unparseable.
    credential: parseIdentifier(data.identifier) as LoginIdentifier,
  }))

export function lastTenDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10)
}
