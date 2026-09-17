import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/env'
import { hasActiveSubscription } from '@/lib/profile/subscription'
import { fetchConversation, fetchInbox, fetchMessages, type ChatErrorKind } from '@/lib/chat'
import { ChatLocked, MessagesClient, MessagesHeading } from '@/components/chat/messages-client'
import type { ChatMessageItem, ConversationDetail } from '@/lib/supabase/database.types'

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Private conversations with your mutual matches on Mali Vivah.',
}
export const dynamic = 'force-dynamic'

/**
 * In-app messaging — paid members only, mutual connections only.
 *
 * The gate below is a convenience for the first paint; the real enforcement
 * lives in the database (supabase/migrations/20260917010000_chat.sql). Every
 * RPC this page and its client call re-verifies the caller's live membership,
 * the other member's live membership, mutual interest, blocks and conversation
 * participation, and the chat tables grant SELECT only — so nothing here can
 * be bypassed by skipping the UI.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams?: { c?: string }
}) {
  if (!isSupabaseConfigured) redirect('/login')
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Same time-aware paid check the rest of the site uses.
  const isPaid = await hasActiveSubscription(supabase, user.id)

  // Distinguish "never subscribed" from "plan lapsed" so the locked state can
  // offer a renewal instead of a first purchase.
  let lapsed = false
  if (!isPaid) {
    const { data: past } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .lt('expires_at', new Date().toISOString())
      .limit(1)
    lapsed = (past?.length ?? 0) > 0
  }

  if (!isPaid) {
    return (
      <section className="bg-cream">
        <div className="container-page py-8 sm:py-12">
          <MessagesHeading />
          <ChatLocked expired={lapsed} />
        </div>
      </section>
    )
  }

  const inboxResult = await fetchInbox(supabase)
  const inbox = inboxResult.ok ? inboxResult.data : []

  // Deep link from a notification (?c=<conversation id>). Authorised by the
  // RPC: a conversation the caller is not part of simply will not load.
  const wanted = typeof searchParams?.c === 'string' && searchParams.c.length > 0 ? searchParams.c : null
  let conversation: ConversationDetail | null = null
  let thread: ChatMessageItem[] = []
  let initialError: ChatErrorKind | null = null

  if (wanted) {
    const headerResult = await fetchConversation(supabase, wanted)
    if (headerResult.ok) {
      conversation = headerResult.data
      const messagesResult = await fetchMessages(supabase, wanted)
      if (messagesResult.ok) thread = messagesResult.data
      else initialError = messagesResult.error
    } else {
      initialError = headerResult.error
    }
  } else if (!inboxResult.ok) {
    initialError = inboxResult.error
  }

  return (
    <section className="bg-cream">
      <div className="container-page py-8 sm:py-12">
        <MessagesHeading />
        <MessagesClient
          currentUserId={user.id}
          initialInbox={inbox}
          initialConversation={conversation}
          initialMessages={thread}
          initialError={initialError}
        />
      </div>
    </section>
  )
}
