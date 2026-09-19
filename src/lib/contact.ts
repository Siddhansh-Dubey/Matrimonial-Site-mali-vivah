/**
 * Single source of truth for public contact channels.
 * The operator sets the real numbers before go-live; every page reuses these
 * so there is never a stale number hidden in one corner of the site.
 */
export const SUPPORT_EMAIL = 'hello@mali-vivah.com'
export const SUPPORT_PHONE_DISPLAY = '90000 00000'
export const SUPPORT_WHATSAPP_NUMBER = '919000000000'

export function whatsappLink(prefill: string): string {
  return buildWhatsappLink(SUPPORT_WHATSAPP_NUMBER, prefill)
}

/** Same wa.me link for an explicit number (DB-configured support line, member phone…). */
export function buildWhatsappLink(number: string, prefill: string): string {
  const digits = number.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(prefill)}`
}
