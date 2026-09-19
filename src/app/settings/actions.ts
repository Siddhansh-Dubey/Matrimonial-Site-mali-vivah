'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'

export type PrivacyResult = { ok: true } | { ok: false; error: string }

/**
 * Member privacy controls. Writes the caller's own matrimony row through
 * their session (RLS: owner-only):
 *  - privacy_settings.* — honoured by get_public_profile() for paid viewers
 *    (income, about, family details, family photo; all default visible),
 *  - whatsapp_opt_in — whether the member may be contacted on WhatsApp.
 */
export async function updatePrivacySettings(formData: FormData): Promise<PrivacyResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'The database is not configured on this server yet.' }
  }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You are signed out — please sign in again.' }

  const get = (key: string): boolean => formData.get(key) === 'on'
  const privacy = {
    show_income: get('show_income'),
    show_about: get('show_about'),
    show_family_details: get('show_family_details'),
    show_family_photo: get('show_family_photo'),
  }

  const { error } = await supabase
    .from('matrimony_profiles')
    .update({
      privacy_settings: privacy,
      whatsapp_opt_in: get('whatsapp_opt_in'),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings')
  revalidatePath('/profile')
  return { ok: true }
}
