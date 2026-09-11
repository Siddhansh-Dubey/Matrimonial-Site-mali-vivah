/** Mask a member's full name for display: "Ramesh" → "R*****". */
export function maskName(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n) return 'Member'
  if (n.length <= 1) return n
  // Mask every word separately so "Asha Patil" → "A*** P****" (matches design refs).
  return n
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 1) return word
      return word.charAt(0) + '*'.repeat(Math.min(word.length - 1, 8))
    })
    .join(' ')
}

/** Mask a phone number: "9876543210" → "98••••••10". Returns placeholder when empty. */
export function maskPhone(phone: string | null | undefined): string {
  const p = (phone ?? '').replace(/\D/g, '')
  if (!p) return '••••••••••'
  if (p.length <= 4) return '•'.repeat(p.length)
  return `${p.slice(0, 2)}${'•'.repeat(Math.max(p.length - 4, 4))}${p.slice(-2)}`
}

/** Generic locked placeholder for a masked text value. */
export function maskedText(value: string | null | undefined, placeholder = 'Locked'): string {
  if (!value) return '—'
  void value
  return placeholder
}

/** Blur class applied to masked values for free viewers. */
export const MASK_BLUR_CLASS = 'select-none blur-[6px]'

/** Dots shown in place of a hidden value (keeps layout stable). */
export function maskDots(length = 6): string {
  return '•'.repeat(length)
}
