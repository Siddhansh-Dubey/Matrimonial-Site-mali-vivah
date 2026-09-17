import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CHAT_MESSAGE_LIMIT,
  type ChatEligibility,
  type ChatMessageItem,
  type ConversationDetail,
  type ConversationSummary,
  type Database,
  type Json,
  type StartConversationResult,
} from '@/lib/supabase/database.types'

type AnyClient = SupabaseClient<Database>

/**
 * Client-side helpers for the chat RPCs.
 *
 * Every read and write goes through a SECURITY DEFINER database function
 * (see supabase/migrations/20260917010000_chat.sql) that re-verifies
 * auth.uid(), live membership on both sides, mutual interest, blocks and
 * conversation participation. Nothing here trusts a value produced by the
 * browser, and nothing here re-implements those rules — these wrappers only
 * cast the JSON payloads and turn database error codes into stable kinds the
 * UI can translate. The chat tables grant SELECT only, so there is no
 * alternative path even for a hand-crafted request.
 */

export type ChatErrorKind =
  /** Not signed in (or session expired). */
  | 'unauthenticated'
  /** The caller has no live plan — show the upgrade prompt. */
  | 'membership_required'
  /** Not mutual / blocked / self / the other side lapsed. */
  | 'unavailable'
  /** The caller is not in that conversation. */
  | 'not_a_participant'
  /** Composer guard rails. */
  | 'empty'
  | 'too_long'
  /** Migration not applied, Supabase down, or anything unexpected. */
  | 'unavailable_service'

export type ChatResult<T> = { ok: true; data: T } | { ok: false; error: ChatErrorKind }

const ERROR_CODES: [RegExp, ChatErrorKind][] = [
  [/CHAT_NOT_AUTHENTICATED/i, 'unauthenticated'],
  [/PAID_MEMBERSHIP_REQUIRED/i, 'membership_required'],
  [/CHAT_NOT_A_PARTICIPANT/i, 'not_a_participant'],
  [/CHAT_EMPTY_MESSAGE/i, 'empty'],
  [/CHAT_MESSAGE_TOO_LONG/i, 'too_long'],
  [/CHAT_UNAVAILABLE|CHAT_INVALID_TARGET/i, 'unavailable'],
]

/** Map a PostgREST error message to a coarse, non-enumerating kind. */
export function chatErrorKind(message: string | undefined | null): ChatErrorKind {
  const text = message ?? ''
  for (const [pattern, kind] of ERROR_CODES) {
    if (pattern.test(text)) return kind
  }
  return 'unavailable_service'
}

function asArray<T>(value: Json | null): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asObject<T>(value: Json | null): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
}

/** The caller's conversation list, newest activity first. */
export async function fetchInbox(
  supabase: AnyClient,
  limit = 50
): Promise<ChatResult<ConversationSummary[]>> {
  try {
    const { data, error } = await supabase.rpc('chat_inbox', { p_limit: limit })
    if (error) return { ok: false, error: chatErrorKind(error.message) }
    return { ok: true, data: asArray<ConversationSummary>(data) }
  } catch {
    return { ok: false, error: 'unavailable_service' }
  }
}

/** Header of one of the caller's conversations (refuses non-participants). */
export async function fetchConversation(
  supabase: AnyClient,
  conversationId: string
): Promise<ChatResult<ConversationDetail>> {
  try {
    const { data, error } = await supabase.rpc('get_conversation', {
      p_conversation_id: conversationId,
    })
    if (error) return { ok: false, error: chatErrorKind(error.message) }
    const detail = asObject<ConversationDetail>(data)
    return detail ? { ok: true, data: detail } : { ok: false, error: 'not_a_participant' }
  } catch {
    return { ok: false, error: 'unavailable_service' }
  }
}

/** Newest messages of a conversation, oldest-first for rendering. */
export async function fetchMessages(
  supabase: AnyClient,
  conversationId: string,
  limit = 60
): Promise<ChatResult<ChatMessageItem[]>> {
  try {
    const { data, error } = await supabase.rpc('list_messages', {
      p_conversation_id: conversationId,
      p_limit: limit,
    })
    if (error) return { ok: false, error: chatErrorKind(error.message) }
    return { ok: true, data: asArray<ChatMessageItem>(data) }
  } catch {
    return { ok: false, error: 'unavailable_service' }
  }
}

/**
 * Open (or create) the conversation with another member. Idempotent: the
 * database keeps exactly one conversation per pair.
 */
export async function startConversation(
  supabase: AnyClient,
  otherUserId: string
): Promise<ChatResult<StartConversationResult>> {
  try {
    const { data, error } = await supabase.rpc('get_or_create_conversation', {
      p_other_user_id: otherUserId,
    })
    if (error) return { ok: false, error: chatErrorKind(error.message) }
    const result = asObject<StartConversationResult>(data)
    return result?.conversation_id
      ? { ok: true, data: result }
      : { ok: false, error: 'unavailable' }
  } catch {
    return { ok: false, error: 'unavailable_service' }
  }
}

/** Send one trimmed text message. Returns the stored row. */
export async function postMessage(
  supabase: AnyClient,
  conversationId: string,
  body: string
): Promise<ChatResult<ChatMessageItem>> {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'empty' }
  if (trimmed.length > CHAT_MESSAGE_LIMIT) return { ok: false, error: 'too_long' }
  try {
    const { data, error } = await supabase.rpc('send_message', {
      p_conversation_id: conversationId,
      p_body: trimmed,
    })
    if (error) return { ok: false, error: chatErrorKind(error.message) }
    const message = asObject<ChatMessageItem>(data)
    return message?.id ? { ok: true, data: message } : { ok: false, error: 'unavailable_service' }
  } catch {
    return { ok: false, error: 'unavailable_service' }
  }
}

/** Mark the caller's unread messages in one conversation as read. */
export async function markConversationRead(
  supabase: AnyClient,
  conversationId: string
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
    })
    return error || typeof data !== 'number' ? 0 : data
  } catch {
    return 0
  }
}

/** Unread chat count for the navbar badge (0 for free members). */
export async function fetchUnreadCount(supabase: AnyClient): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('unread_message_count')
    return error || typeof data !== 'number' ? 0 : data
  } catch {
    return 0
  }
}

/** Coarse chat verdict for one member — drives the Message button states. */
export async function fetchChatEligibility(
  supabase: AnyClient,
  otherUserId: string
): Promise<ChatEligibility> {
  try {
    const { data, error } = await supabase.rpc('chat_eligibility', {
      p_other_user_id: otherUserId,
    })
    if (error) return { allowed: false, reason: 'unavailable' }
    const verdict = asObject<ChatEligibility>(data)
    return verdict ?? { allowed: false, reason: 'unavailable' }
  } catch {
    return { allowed: false, reason: 'unavailable' }
  }
}
