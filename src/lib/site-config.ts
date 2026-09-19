import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_WHATSAPP_NUMBER,
} from '@/lib/contact'

/**
 * Authoritative, admin-managed site configuration.
 *
 * WhatsApp values and editable website copy live in the database
 * (`whatsapp_config`, `site_content` — migrations 20260919020000), managed
 * from /admin/whatsapp and /admin/content. The static values in
 * `src/lib/contact.ts` remain ONLY as a safe fallback for environments where
 * the tables are empty or the RPCs are not installed yet — production
 * behaviour reads the database.
 */

export type WhatsAppConfig = {
  /** Join-the-community invite link (https://chat.whatsapp.com/…). Null until an admin sets one. */
  communityLink: string | null
  /** Prebuilt support chat link (https://wa.me/…). */
  supportLink: string
  /** Digits only, with country code (e.g. 919876543210). */
  supportNumber: string
  supportEmail: string
  supportPhoneDisplay: string
  /** True when the values came from the database (false = static fallback). */
  fromDatabase: boolean
}

function staticWhatsAppConfig(): WhatsAppConfig {
  return {
    communityLink: null,
    supportLink: `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`,
    supportNumber: SUPPORT_WHATSAPP_NUMBER,
    supportEmail: SUPPORT_EMAIL,
    supportPhoneDisplay: SUPPORT_PHONE_DISPLAY,
    fromDatabase: false,
  }
}

/**
 * The live WhatsApp configuration. Never throws — an unreachable database or
 * an empty/invalid row falls back to the static constants.
 */
export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  if (!isSupabaseConfigured) return staticWhatsAppConfig()
  try {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('get_whatsapp_config')
    if (error) return staticWhatsAppConfig()
    const cfg = data as {
      community_link?: string | null
      support_link?: string | null
      support_number?: string | null
    } | null
    if (!cfg) return staticWhatsAppConfig()

    const supportNumber = /^91\d{10}$/.test(cfg.support_number ?? '')
      ? cfg.support_number!
      : SUPPORT_WHATSAPP_NUMBER

    const communityLink =
      cfg.community_link && /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/.+/.test(cfg.community_link)
        ? cfg.community_link
        : null

    return {
      communityLink,
      supportLink:
        cfg.support_link && /^https:\/\/wa\.me\/\d+/.test(cfg.support_link)
          ? cfg.support_link
          : `https://wa.me/${supportNumber}`,
      supportNumber,
      supportEmail: SUPPORT_EMAIL,
      supportPhoneDisplay: SUPPORT_PHONE_DISPLAY,
      fromDatabase: true,
    }
  } catch {
    return staticWhatsAppConfig()
  }
}

/** Build a support wa.me link with a prefilled (encoded) message. */
export function supportWhatsappLink(cfg: WhatsAppConfig, prefill?: string): string {
  if (!prefill) return cfg.supportLink
  return `https://wa.me/${cfg.supportNumber}?text=${encodeURIComponent(prefill)}`
}

export type ContentBlock = {
  title: string
  body: string
}

/**
 * One editable copy block by key. Returns null when the block is missing or
 * inactive so the caller renders its built-in fallback copy.
 */
export async function getSiteContent(key: string): Promise<ContentBlock | null> {
  if (!isSupabaseConfigured) return null
  try {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('get_site_content', { p_key: key })
    if (error) return null
    const block = data as { title?: string | null; body?: string | null } | null
    if (!block || !block.body) return null
    return { title: block.title ?? '', body: block.body }
  } catch {
    return null
  }
}
