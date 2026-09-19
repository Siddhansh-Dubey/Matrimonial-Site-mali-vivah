import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** Mobile OTP settings — mirrored by the mobile_otps table semantics. */
export const OTP_LENGTH = 6
export const OTP_TTL_SECONDS = 10 * 60
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS_PER_HOUR = 5
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** Cryptographically-random 6-digit code (never stored — only its hash). */
export function generateCode(): string {
  return String(randomInt(100000, 1000000))
}

/** SHA-256 hex digest — the only form persisted in mobile_otps.code_hash. */
export function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

/** Constant-time comparison of a candidate code against a stored hash. */
export function codeMatches(candidate: string, storedHash: string): boolean {
  const candidateHash = hashCode(candidate.trim())
  if (candidateHash.length !== storedHash.length) return false
  try {
    return timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

/** Keep the last 10 digits (tolerates "+91", spaces and dashes). */
export function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

export function isValidIndianMobile(mobile: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeMobile(mobile))
}
