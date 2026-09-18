import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { hasActiveSubscription } from '@/lib/profile/subscription'

export type StoryCtaStatus = 'unauthenticated' | 'unpaid' | 'active'

export type StoryCtaResult = {
  href: string
  status: StoryCtaStatus
}

/**
 * Resolves the authentication- and subscription-aware destination for Success Story entry points:
 *
 * 1. Unauthenticated → /login?next=/success-stories/submit
 * 2. Authenticated but Free / Expired → /packages?next=/success-stories/submit&reason=stories
 * 3. Authenticated and Active Paid Member → /success-stories/submit
 *
 * Never blindly redirects to /register.
 */
export async function getSuccessStoryCta(
  supabase: SupabaseClient<Database> | null,
  userId: string | null | undefined
): Promise<StoryCtaResult> {
  if (!supabase || !userId) {
    return {
      href: '/login?next=/success-stories/submit',
      status: 'unauthenticated',
    }
  }

  const isPaid = await hasActiveSubscription(supabase, userId)
  if (!isPaid) {
    return {
      href: '/packages?next=/success-stories/submit&reason=stories',
      status: 'unpaid',
    }
  }

  return {
    href: '/success-stories/submit',
    status: 'active',
  }
}
