import { env } from '@/lib/env'

/** Public URL for a photo stored in the 'profile-photos' bucket. */
export function photoUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null
  if (!env.supabaseUrl.startsWith('http') || env.supabaseUrl.includes('YOUR-PROJECT-REF')) {
    return null
  }
  return `${env.supabaseUrl}/storage/v1/object/public/profile-photos/${storagePath}`
}
