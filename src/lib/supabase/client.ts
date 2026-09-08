'use client'

import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

/** Supabase client for use in Client Components. Safe to call repeatedly. */
export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey)
}
