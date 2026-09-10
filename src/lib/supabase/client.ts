'use client'

import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'

/** Supabase client for use in Client Components. Safe to call repeatedly. */
export function createClient() {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey)
}
