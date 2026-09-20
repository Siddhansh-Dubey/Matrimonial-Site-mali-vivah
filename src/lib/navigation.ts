/**
 * Safe navigation and redirect sanitization.
 *
 * Ensures that post-auth and post-payment redirects stay on the local origin.
 * Prevents Open Redirect (CWE-601) attacks by rejecting external protocols,
 * protocol-relative URLs (//), backslashes, control characters, and scheme payloads.
 */
export function getSafeRedirect(candidate?: string | null, fallback = '/profile'): string {
  if (!candidate) return fallback
  const trimmed = candidate.trim()
  if (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.startsWith('/\\') &&
    !trimmed.includes('\\') &&
    !trimmed.includes('://') &&
    !/[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return trimmed
  }
  return fallback
}
