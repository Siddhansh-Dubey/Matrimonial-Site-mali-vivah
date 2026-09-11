/** Mask a member's full name for display: "Ramesh" → "R*****". */
export function maskName(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n) return 'Member'
  if (n.length <= 1) return n
  return n.charAt(0) + '*'.repeat(n.length - 1)
}
