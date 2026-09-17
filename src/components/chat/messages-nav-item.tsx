'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Lock, MessageSquare } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import { fetchUnreadCount } from '@/lib/chat'

/**
 * "Messages" in the navbar, with a real unread badge.
 *
 * The count comes from unread_message_count(), which returns 0 for a member
 * without a live plan — the badge only ever advertises conversations the
 * member can actually open. Paid status is read from the existing
 * has_active_subscription() RPC; a free member still gets the item, rendered
 * as a locked affordance that leads to the upgrade prompt on /messages.
 *
 * Live updates use Supabase Realtime on `conversations` (a table whose rows
 * carry only UUIDs and timestamps) as the wake-up signal, then re-read the
 * count through the RPC — no polling.
 */
export function MessagesNavItem({
  userId,
  mobile = false,
  onNavigate,
}: {
  userId: string
  /** Renders the row used inside the mobile menu. */
  mobile?: boolean
  onNavigate?: () => void
}) {
  const { t } = useI18n()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [paid, setPaid] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return
    const supabase = createClient()
    try {
      const [{ data: isPaidMember }, count] = await Promise.all([
        supabase.rpc('has_active_subscription', { p_user_id: userId }),
        fetchUnreadCount(supabase),
      ])
      setPaid(isPaidMember === true)
      setUnread(count)
    } catch {
      /* the badge is a convenience — never block navigation on it */
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const supabase = createClient()
    const channel = supabase
      .channel('mv-chat-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => void refresh()
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  const active = pathname?.startsWith('/messages')
  const badge = unread > 0 && (
    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-maroon px-1 text-[10px] font-bold text-white">
      {unread > 99 ? '99+' : unread}
    </span>
  )

  if (mobile) {
    return (
      <Link
        href="/messages"
        onClick={onNavigate}
        className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-cream-dark"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-stone-500" aria-hidden />
          {t('nav.messages')}
          {paid === false && <Lock className="h-3.5 w-3.5 text-stone-400" aria-hidden />}
        </span>
        {badge}
      </Link>
    )
  }

  return (
    <Link
      href="/messages"
      aria-label={unread > 0 ? `${t('nav.messages')} (${unread} ${t('chat.unread')})` : t('nav.messages')}
      className={[
        'relative inline-flex items-center gap-1.5 py-2 text-[13.5px] font-medium transition-colors',
        active ? 'text-maroon' : 'text-stone-800 hover:text-maroon',
      ].join(' ')}
    >
      <MessageSquare className="h-4 w-4" aria-hidden />
      {t('nav.messages')}
      {paid === false && <Lock className="h-3 w-3 text-stone-400" aria-hidden />}
      {badge}
      {active && (
        <span className="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full bg-maroon" aria-hidden />
      )}
    </Link>
  )
}
