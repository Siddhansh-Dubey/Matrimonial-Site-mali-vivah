'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2, Lock, MessageSquare } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { createClient } from '@/lib/supabase/client'
import { startConversation, type ChatErrorKind } from '@/lib/chat'

/**
 * The one chat entry point on a profile / interest row.
 *
 * The three states are decided by the SERVER from the existing relationship
 * model (paid membership + mutual interest) — never from anything the browser
 * sends. A 'ready' button still ends up in get_or_create_conversation(), which
 * re-verifies membership on both sides, mutual interest and blocks in the
 * database before it returns a conversation id, so a stale or forged "ready"
 * cannot open a chat that is not allowed.
 */
export type MessageButtonState =
  /** Paid viewer + mutual match: show a working action. */
  | 'ready'
  /** Viewer is paid but the pair is not a mutual match (or the other side is not a member). */
  | 'needs_mutual'
  /** Viewer has no live plan. */
  | 'needs_package'

export function MessageButton({
  otherUserId,
  state,
  variant = 'primary',
}: {
  otherUserId: string
  state: MessageButtonState
  variant?: 'primary' | 'inline'
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ChatErrorKind | null>(null)

  if (state === 'needs_package') {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-stone-500">
        <Lock className="h-3.5 w-3.5 text-stone-400" aria-hidden />
        <span>{t('chat.locked.title')}</span>
        <Link href="/packages" className="font-bold text-maroon underline underline-offset-2">
          {t('chat.locked.cta')}
        </Link>
      </p>
    )
  }

  if (state === 'needs_mutual') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-stone-500">
        <Lock className="h-3.5 w-3.5 text-stone-400" aria-hidden />
        {t('chat.notMutual')}
      </p>
    )
  }

  async function open() {
    if (busy) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await startConversation(supabase, otherUserId)
    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }
    router.push(`/messages?c=${result.data.conversation_id}`)
    router.refresh()
  }

  const message = error
    ? error === 'membership_required'
      ? t('chat.expired.body')
      : error === 'unauthenticated'
        ? t('chat.error.unauthenticated')
        : error === 'unavailable_service'
          ? t('chat.error.service')
          : t('chat.error.unavailable')
    : null

  const inline = variant === 'inline'

  return (
    <div className={inline ? 'space-y-1.5' : 'space-y-2'}>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className={
          inline
            ? 'inline-flex items-center gap-1.5 rounded-full bg-maroon px-3.5 py-1.5 text-xs font-bold text-white hover:bg-maroon-dark disabled:opacity-60'
            : 'btn-secondary w-full sm:w-auto'
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <MessageSquare className="h-4 w-4" aria-hidden />
        )}
        {busy ? t('chat.message.opening') : t('chat.message.action')}
      </button>
      {message && (
        <p role="alert" className="text-xs font-semibold text-brand-700">
          {message}
        </p>
      )}
    </div>
  )
}
