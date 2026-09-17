'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Heart, MessageSquare, Rocket, ShieldCheck, Star, User, Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/env'
import type { NotificationItem, NotificationType } from '@/lib/supabase/database.types'

const ICONS: Partial<Record<NotificationType, typeof Bell>> = {
  interest_received: Heart,
  interest_accepted: Heart,
  interest_declined: Heart,
  profile_viewed: User,
  new_matches: Star,
  new_moment: Zap,
  package_expiring: Rocket,
  boost_expiring: Rocket,
  profile_verified: ShieldCheck,
  payment_received: CheckCheck,
  admin_message: MessageSquare,
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * The header bell — unread badge + dropdown of recent notifications.
 * Pure member-scoped client: it reads only the caller's own rows (RLS), uses
 * the mark_*_read RPCs, and polls lightly while the dropdown is closed.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('unread_notification_count')
      if (!error && typeof data === 'number') setUnread(data)
    } catch {
      /* ignore */
    }
  }, [])

  const loadItems = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('notifications')
        .select('id, type, title, message, link, is_read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(15)
      setItems((data as NotificationItem[] | null) ?? [])
    } catch {
      /* ignore */
    }
  }, [userId])

  useEffect(() => {
    refreshCount()
    const id = setInterval(refreshCount, 60_000)
    return () => clearInterval(id)
  }, [refreshCount])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      await loadItems()
      await refreshCount()
    }
  }

  async function markRead(id: number, isRead: boolean) {
    if (isRead) return
    try {
      const supabase = createClient()
      await supabase.rpc('mark_notification_read', { p_id: id })
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
      setUnread((v) => Math.max(0, v - 1))
    } catch {
      /* ignore */
    }
  }

  async function markAll() {
    try {
      const supabase = createClient()
      await supabase.rpc('mark_all_notifications_read')
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnread(0)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-stone-300 bg-white text-stone-700 transition-colors hover:border-brand-400 hover:text-brand-700"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-maroon px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <p className="text-sm font-bold text-stone-900">Notifications</p>
            {items.some((n) => !n.is_read) && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs font-semibold text-maroon hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[min(60vh,26rem)] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-stone-500">
                Nothing yet — matches, interests and reminders will show up here.
              </li>
            )}
            {items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell
              const body = (
                <div className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                      n.is_read ? 'bg-stone-100 text-stone-500' : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${n.is_read ? 'font-medium text-stone-700' : 'font-bold text-stone-900'}`}>
                      {n.title}
                    </span>
                    {n.message && (
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-stone-500">
                        {n.message}
                      </span>
                    )}
                    <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                  {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-maroon" aria-hidden />}
                </div>
              )
              return (
                <li key={n.id} className={n.is_read ? '' : 'bg-brand-50/40'}>
                  {n.link ? (
                    <Link
                      href={n.link}
                      className="block transition-colors hover:bg-cream"
                      onClick={() => {
                        setOpen(false)
                        markRead(n.id, n.is_read)
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => markRead(n.id, n.is_read)} className="w-full text-left transition-colors hover:bg-cream">
                      {body}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
