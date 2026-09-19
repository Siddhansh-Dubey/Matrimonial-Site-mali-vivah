import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/env'
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_WHATSAPP_NUMBER,
} from '@/lib/contact'

/**
 * Operator-editable public settings, stored in the `site_config` table and
 * edited from /admin/settings (audited). Server components read through
 * getSiteConfig(), which is request-cached and ALWAYS falls back to the
 * compiled-in contact.ts defaults — the site keeps rendering even when the
 * table (or the whole database) is missing.
 */

export type SiteConfig = {
  supportEmail: string
  supportPhoneDisplay: string
  supportWhatsapp: string
  supportHours: string
  boostPriceInr: number
  boostDurationDays: number
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  supportEmail: SUPPORT_EMAIL,
  supportPhoneDisplay: SUPPORT_PHONE_DISPLAY,
  supportWhatsapp: SUPPORT_WHATSAPP_NUMBER,
  supportHours: 'Monday – Saturday, 10:00 – 19:00 IST',
  boostPriceInr: 199,
  boostDurationDays: 7,
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const getSiteConfig = cache(async (): Promise<SiteConfig> => {
  if (!isSupabaseConfigured) return DEFAULT_SITE_CONFIG
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('site_config').select('key, value')
    if (error || !data) return DEFAULT_SITE_CONFIG
    const map = new Map((data as { key: string; value: unknown }[]).map((r) => [r.key, r.value]))
    return {
      supportEmail: asString(map.get('support_email'), DEFAULT_SITE_CONFIG.supportEmail),
      supportPhoneDisplay: asString(
        map.get('support_phone_display'),
        DEFAULT_SITE_CONFIG.supportPhoneDisplay
      ),
      supportWhatsapp: asString(map.get('support_whatsapp'), DEFAULT_SITE_CONFIG.supportWhatsapp),
      supportHours: asString(map.get('support_hours'), DEFAULT_SITE_CONFIG.supportHours),
      boostPriceInr: Math.round(
        asNumber(map.get('boost_price_inr'), DEFAULT_SITE_CONFIG.boostPriceInr)
      ),
      boostDurationDays: Math.round(
        asNumber(map.get('boost_duration_days'), DEFAULT_SITE_CONFIG.boostDurationDays)
      ),
    }
  } catch {
    return DEFAULT_SITE_CONFIG
  }
})
