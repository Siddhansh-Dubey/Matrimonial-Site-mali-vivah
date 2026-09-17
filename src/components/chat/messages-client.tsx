'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isSameDay } from 'date-fns'
import {
  ArrowLeft,
  CheckCheck,
  Inbox,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  WifiOff,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { createClient } from '@/lib/supabase/client'
import { photoUrl } from '@/lib/profile/photos'
import {
  CHAT_MESSAGE_LIMIT,
  type ChatMessageItem,
  type ConversationDetail,
  type ConversationSummary,
} from '@/lib/supabase/database.types'
import {
  fetchConversation,
  fetchInbox,
  fetchMessages,
  markConversationRead,
  postMessage,
  type ChatErrorKind,
} from '@/lib/chat'

/**
 * The /messages experience: conversation list + active thread + composer.
 *
 * DATA & SECURITY
 *   Every read and write is a SECURITY DEFINER RPC (src/lib/chat.ts) that
 *   re-checks auth.uid(), live membership on BOTH sides, mutual interest,
 *   blocks and conversation participation in the database. The chat tables
 *   grant SELECT only, so there is no client-side write path to bypass.
 *
 * REALTIME
 *   Supabase Realtime is used purely as a wake-up signal: when a row lands in
 *   `messages` for the open conversation (or `conversations` for the list),
 *   the component re-reads through the authorised RPC instead of rendering
 *   the replication payload. Updates are instant and the browser never
 *   displays a row it was not entitled to read. There is no polling.
 */

type Props = {
  currentUserId: string
  initialInbox: ConversationSummary[]
  initialConversation: ConversationDetail | null
  initialMessages: ChatMessageItem[]
  /** Set when the ?c= deep link could not be authorised or loaded. */
  initialError: ChatErrorKind | null
}

function Avatar({ name, photo, size = 'md' }: { name: string; photo?: string | null; size?: 'sm' | 'md' }) {
  const url = photoUrl(photo)
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  return (
    <span className={`${box} shrink-0 overflow-hidden rounded-full bg-brand-50 ring-1 ring-stone-200`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-display text-base font-bold text-brand-300">
          {(name || 'M').charAt(0)}
        </span>
      )}
    </span>
  )
}

/** Compact timestamp: time today, day + month otherwise. */
function timeLabel(iso: string): string {
  const date = new Date(iso)
  if (isSameDay(date, new Date())) return format(date, 'HH:mm')
  return format(date, 'd MMM')
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (isSameDay(date, new Date())) return format(date, 'd MMMM')
  return format(date, 'd MMMM yyyy')
}

/** Page heading — keeps the /messages copy translatable. */
export function MessagesHeading() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-[13px] font-semibold uppercase tracking-[0.34em] text-gold-700">
        {t('chat.kicker')}
      </p>
      <h1 className="mt-3 font-display text-4xl font-bold text-maroon">{t('chat.title')}</h1>
      <p className="mt-3 text-sm text-stone-600">{t('chat.subtitle')}</p>
    </div>
  )
}

/** The locked state shown to members without a live plan. */
export function ChatLocked({ expired = false }: { expired?: boolean }) {
  const { t } = useI18n()
  return (
    <div className="card mx-auto mt-8 max-w-xl px-6 py-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-600">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-2xl font-bold text-maroon">{t('chat.locked.title')}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-600">
        {expired ? t('chat.expired.body') : t('chat.locked.body')}
      </p>
      <Link href="/packages" className="btn-primary mt-6">
        {expired ? t('chat.expired.cta') : t('chat.locked.cta')}
      </Link>
    </div>
  )
}

export function MessagesClient({
  currentUserId,
  initialInbox,
  initialConversation,
  initialMessages,
  initialError,
}: Props) {
  const { t } = useI18n()
  const supabase = useMemo(() => createClient(), [])

  const [inbox, setInbox] = useState<ConversationSummary[]>(initialInbox)
  const [activeId, setActiveId] = useState<string | null>(
    initialConversation?.conversation_id ?? null
  )
  const [header, setHeader] = useState<ConversationDetail | null>(initialConversation)
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialMessages)
  const [loadingThread, setLoadingThread] = useState(
    Boolean(initialError) || (Boolean(activeId) && !initialConversation)
  )
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<ChatErrorKind | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [realtimeDown, setRealtimeDown] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
  }, [])

  const refreshInbox = useCallback(async () => {
    const result = await fetchInbox(supabase)
    if (result.ok) setInbox(result.data)
  }, [supabase])

  /** Mark the open thread read — only when it is actually on screen. */
  const markRead = useCallback(
    async (conversationId: string) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      const updated = await markConversationRead(supabase, conversationId)
      if (updated <= 0) return
      const now = new Date().toISOString()
      setMessages((prev) =>
        prev.map((m) =>
          m.sender_id !== currentUserId && !m.read_at ? { ...m, read_at: now } : m
        )
      )
      setInbox((prev) =>
        prev.map((c) => (c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c))
      )
    },
    [supabase, currentUserId]
  )

  const openConversation = useCallback(
    async (conversationId: string) => {
      setActiveId(conversationId)
      setError(null)
      setNotice(null)
      setLoadingThread(true)
      const [headerResult, messagesResult] = await Promise.all([
        fetchConversation(supabase, conversationId),
        fetchMessages(supabase, conversationId),
      ])
      if (!headerResult.ok) {
        setHeader(null)
        setMessages([])
        setError(headerResult.error)
        setLoadingThread(false)
        return
      }
      setHeader(headerResult.data)
      if (messagesResult.ok) {
        setMessages(messagesResult.data)
        setLoadingThread(false)
        scrollToBottom()
        await markRead(conversationId)
      } else {
        setMessages([])
        setError(messagesResult.error)
        setLoadingThread(false)
      }
    },
    [supabase, markRead, scrollToBottom]
  )

  // A deep link (?c=…) the server could not pre-render still gets opened once.
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current) return
    deepLinkHandled.current = true
    const params = new URLSearchParams(window.location.search)
    const wanted = params.get('c')
    if (!wanted || wanted === initialConversation?.conversation_id) return
    void openConversation(wanted)
  }, [initialConversation?.conversation_id, openConversation])

  // Re-read on a Realtime wake-up instead of trusting the replication payload.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        if (cancelled) return
        void fetchMessages(supabase, activeId).then((result) => {
          if (result.ok && !cancelled) {
            setMessages(result.data)
            scrollToBottom()
          }
        })
        void refreshInbox()
        void markRead(activeId)
      }, 120)
    }

    const channel = supabase
      .channel(`mv-chat:${activeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeId}`,
        },
        scheduleRefresh
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeDown(false)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeDown(true)
      })

    return () => {
      cancelled = true
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [activeId, supabase, refreshInbox, markRead, scrollToBottom])

  // The conversation rows carry no private data, so a table-wide listen is
  // safe and keeps previews/unread fresh even with no thread open.
  useEffect(() => {
    const channel = supabase
      .channel('mv-chat-inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => void refreshInbox()
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeDown(true)
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, refreshInbox])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(id)
  }, [notice])

  async function sendMessage() {
    const body = draft.trim()
    if (!body || !activeId || sending) return
    if (body.length > CHAT_MESSAGE_LIMIT) {
      setError('too_long')
      return
    }
    setSending(true)
    setError(null)
    const result = await postMessage(supabase, activeId, body)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
    setNotice(t('chat.sentNotice'))
    setMessages((prev) => (prev.some((m) => m.id === result.data.id) ? prev : [...prev, result.data]))
    setInbox((prev) =>
      prev.map((c) =>
        c.conversation_id === activeId
          ? { ...c, last_message: body.slice(0, 140), last_message_at: result.data.created_at }
          : c
      )
    )
    scrollToBottom()
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage()
  }

  // No header means the conversation could not be authorised — never offer a
  // composer for a thread the member is not entitled to write to.
  const composerBlockedReason = !header
    ? t('chat.error.notParticipant')
    : header.can_send
      ? null
      : header.other_is_member
        ? t('chat.notMutual')
        : t('chat.recipientExpired')

  const errorText = error
    ? error === 'membership_required'
      ? t('chat.expired.body')
      : error === 'not_a_participant'
        ? t('chat.error.notParticipant')
        : error === 'unauthenticated'
          ? t('chat.error.unauthenticated')
          : error === 'empty'
            ? t('chat.error.empty')
            : error === 'too_long'
              ? t('chat.error.tooLong')
              : error === 'unavailable'
                ? t('chat.error.unavailable')
                : t('chat.error.service')
    : null

  return (
    <div className="card mt-6 flex h-[min(76dvh,44rem)] overflow-hidden sm:mt-8">
      {/* Conversation list */}
      <aside
        className={`${
          activeId ? 'hidden lg:flex' : 'flex'
        } w-full flex-col border-stone-200 lg:w-[21rem] lg:shrink-0 lg:border-r`}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h2 className="font-display text-lg font-bold text-maroon">{t('chat.list.title')}</h2>
          <span className="text-xs font-semibold text-stone-400">{inbox.length}</span>
        </div>

        {!activeId && errorText && (
          <p role="alert" className="border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-xs text-brand-800">
            {errorText}
          </p>
        )}

        {inbox.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <Inbox className="h-8 w-8 text-stone-300" aria-hidden />
            <p className="font-semibold text-stone-700">{t('chat.empty.title')}</p>
            <p className="text-xs leading-relaxed text-stone-500">{t('chat.empty.body')}</p>
            <Link href="/search" className="btn-secondary mt-1 !py-2 text-xs">
              {t('chat.empty.browse')}
            </Link>
          </div>
        ) : (
          <ul className="flex-1 divide-y divide-stone-100 overflow-y-auto">
            {inbox.map((conversation) => {
              const active = conversation.conversation_id === activeId
              return (
                <li key={conversation.conversation_id}>
                  <button
                    type="button"
                    onClick={() => void openConversation(conversation.conversation_id)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-cream ${
                      active ? 'bg-brand-50/60' : ''
                    }`}
                  >
                    <Avatar name={conversation.name} photo={conversation.photo} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-stone-800">
                          {conversation.name}
                        </span>
                        {conversation.last_message_at && (
                          <span className="shrink-0 text-[10px] font-medium text-stone-400">
                            {timeLabel(conversation.last_message_at)}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-stone-500">
                          {conversation.last_message ?? t('chat.list.noMessages')}
                        </span>
                        {conversation.unread_count > 0 && (
                          <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-maroon px-1 text-[10px] font-bold text-white">
                            {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      {/* Active conversation */}
      <section className={`${activeId ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col bg-cream/40`}>
        {!activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <MessageSquare className="h-9 w-9 text-stone-300" aria-hidden />
            <p className="font-semibold text-stone-600">{t('chat.empty.title')}</p>
            <p className="max-w-xs text-xs leading-relaxed text-stone-500">{t('chat.empty.body')}</p>
          </div>
        ) : (
          <>
            {header && (
              <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-stone-600 hover:bg-stone-100 lg:hidden"
                  aria-label={t('chat.back')}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Avatar name={header.name} photo={header.photo} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-stone-900">
                    {header.name}
                  </span>
                  <span className="block truncate text-[11px] text-stone-500">{t('chat.subtitle')}</span>
                </span>
                <Link
                  href={`/profile/${header.other_user_id}`}
                  className="shrink-0 rounded-full border border-brand-200 px-3 py-1.5 text-[11px] font-bold text-brand-800 hover:border-brand-500 hover:bg-brand-50"
                >
                  {t('chat.viewProfile')}
                </Link>
              </div>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5">
              {loadingThread ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('chat.loading')}
                </p>
              ) : messages.length === 0 ? (
                <p className="mx-auto max-w-sm py-10 text-center text-sm leading-relaxed text-stone-500">
                  {t('chat.thread.empty')}
                </p>
              ) : (
                messages.map((message, index) => {
                  const mine = message.sender_id === currentUserId
                  const previous = messages[index - 1]
                  const showDay =
                    !previous || !isSameDay(new Date(previous.created_at), new Date(message.created_at))
                  return (
                    <Fragment key={message.id}>
                      {showDay && (
                        <p className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                          {dayLabel(message.created_at)}
                        </p>
                      )}
                      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
                            mine ? 'bg-brand-600 text-white' : 'bg-white text-stone-800 ring-1 ring-stone-100'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {message.body}
                          </p>
                          <span
                            className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                              mine ? 'text-brand-100' : 'text-stone-400'
                            }`}
                          >
                            {format(new Date(message.created_at), 'HH:mm')}
                            {mine && message.read_at && (
                              <CheckCheck className="h-3 w-3" aria-label={t('chat.read')} />
                            )}
                          </span>
                        </div>
                      </div>
                    </Fragment>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {realtimeDown && (
              <p className="flex items-center justify-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11px] font-medium text-amber-900">
                <WifiOff className="h-3.5 w-3.5" aria-hidden /> {t('chat.live.offline')}
              </p>
            )}

            <form onSubmit={submit} className="border-t border-stone-200 bg-white px-3 py-3 sm:px-4">
              {composerBlockedReason && (
                <p className="mb-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {composerBlockedReason}
                </p>
              )}
              {errorText && !composerBlockedReason && (
                <p role="alert" className="mb-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
                  {errorText}
                </p>
              )}
              {notice && !errorText && (
                <p role="status" className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {notice}
                </p>
              )}
              <div className="flex items-end gap-2">
                <label htmlFor="chat-composer" className="sr-only">
                  {t('chat.placeholder')}
                </label>
                <textarea
                  id="chat-composer"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MESSAGE_LIMIT))}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter keeps a line break.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendMessage()
                    }
                  }}
                  rows={1}
                  disabled={Boolean(composerBlockedReason) || sending}
                  placeholder={t('chat.placeholder')}
                  className="input max-h-32 min-h-[44px] flex-1 resize-none py-2.5"
                />
                <button
                  type="submit"
                  disabled={Boolean(composerBlockedReason) || sending || draft.trim().length === 0}
                  className="btn-primary !px-4 !py-2.5"
                  aria-label={t('chat.send')}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden />
                  )}
                  <span className="hidden sm:inline">{sending ? t('chat.sending') : t('chat.send')}</span>
                </button>
              </div>
              {draft.length > 0 && (
                <p className="mt-1 text-right text-[10px] text-stone-400">
                  {draft.length}/{CHAT_MESSAGE_LIMIT}
                </p>
              )}
            </form>
          </>
        )}
      </section>
    </div>
  )
}
