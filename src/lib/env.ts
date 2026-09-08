/**
 * Centralised environment access.
 * `isSupabaseConfigured` lets the UI render a helpful setup notice instead of
 * crashing when the project has not been connected to Supabase yet.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
}

export const isSupabaseConfigured =
  url.startsWith('http') && !url.includes('YOUR-PROJECT-REF') && anonKey.length > 20

export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return key
}
