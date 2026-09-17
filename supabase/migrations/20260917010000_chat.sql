-- ============================================================================
-- Mali Vivah · In-app messaging (chat) for PAID, mutually-connected members
-- Migration 17 of the pass.
--
-- BUSINESS RULE THIS FILE ENFORCES IN THE DATABASE (not just in the UI)
--   A conversation exists — and a message can be sent — only when ALL of:
--     1. the caller is authenticated (auth.uid()),
--     2. the caller holds an active, unexpired subscription
--        (public.has_live_membership — the existing time-aware paid check),
--     3. the OTHER member holds an active, unexpired subscription,
--     4. interest is mutual (public.mutual_interest_exists — the existing
--        matrimonial relationship model; payment alone unlocks NOTHING),
--     5. neither member has blocked the other (public.is_blocked — the
--        existing blocks table).
--   Reading requires 1 + 2 + being a participant of that conversation.
--
-- WHAT IT CREATES
--   §1 conversations          — one row per eligible pair (ordered, unique)
--   §2 conversation_members   — participants (the RLS anchor)
--   §3 messages               — text only; no contact details, ever
--   §4 is_conversation_participant() / can_chat_with() — the predicates
--   §5 chat_eligibility()     — coarse, non-enumerating verdict for the UI
--   §6 get_or_create_conversation() — the ONLY conversation-creation path
--   §7 chat_inbox() / get_conversation() / list_messages() — authorised reads
--   §8 send_message()         — the ONLY message-write path
--   §9 mark_conversation_read() / unread_message_count() — read state
--   §10 Triggers: pair ordering, participant validation, last_message_at +
--       the 'message_received' notification for the EXISTING bell
--   §11 Realtime publication
--
-- SECURITY MODEL (why a malicious client cannot cheat)
--   • The three tables grant SELECT only. There is deliberately NO
--     INSERT/UPDATE/DELETE grant for `authenticated` on ANY chat table, so a
--     crafted fetch to the REST API cannot create a conversation, join one,
--     send a message, or edit a read flag — the ONLY write path is the
--     SECURITY DEFINER functions below, and every one of them re-checks
--     auth.uid(), live membership (both sides), mutual interest, blocks and
--     participant membership from the database. Nothing sent by the client
--     ("isPaid": true, a conversation_id, a sender_id) is trusted.
--   • RLS on top of that: a member sees only conversations they participate
--     in, only messages of those conversations, and only their own
--     conversation_members rows.
--   • Exactly one conversation per pair: the pair is stored ordered
--     (member_a < member_b) with a UNIQUE constraint, so A↔B always resolves
--     to the same row however many times "start chat" is pressed, and
--     member_a = member_b is refused by a CHECK constraint.
--   • Expiry: eligibility is computed live from subscriptions, so an expired
--     member instantly loses the ability to send or open chat; NOTHING is
--     deleted, and a renewal restores access when both sides are eligible
--     again. No second subscription/status system is introduced.
--   • Privacy: no phone, email or address column exists here — chat rows hold
--     UUIDs and message text only. The notification carries ids, never the
--     message body.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: every statement is idempotent.
-- DEPENDS ON 20260917000000_notification_enum_message_received.sql (adds the
-- 'message_received' enum value — it must be a separate file because a new
-- enum value cannot be used in the transaction that creates it), and on
-- 20260912000000 / 20260915020000 / 20260915100000 / 20260915110000 /
-- 20260915120000 (packages, membership resolvers, notifications, blocks).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1 conversations — exactly one row per eligible pair
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordered pair: member_a < member_b, enforced by a CHECK below and
  -- normalised by a trigger, so the UNIQUE constraint really does mean
  -- "one conversation per pair of members".
  member_a        UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  member_b        UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,

  CONSTRAINT conversations_no_self CHECK (member_a <> member_b),
  CONSTRAINT conversations_ordered CHECK (member_a < member_b),
  CONSTRAINT conversations_pair_unique UNIQUE (member_a, member_b)
);

COMMENT ON TABLE public.conversations IS
  'One row per pair of members allowed to talk. Created only by get_or_create_conversation(); the ordered unique pair makes duplicate conversations impossible.';
COMMENT ON COLUMN public.conversations.member_a IS 'Lower UUID of the pair (normalised by trigger).';
COMMENT ON COLUMN public.conversations.member_b IS 'Higher UUID of the pair.';
COMMENT ON COLUMN public.conversations.last_message_at IS 'Denormalised for inbox ordering; maintained by the messages trigger.';

CREATE INDEX IF NOT EXISTS conversations_member_a_idx ON public.conversations (member_a);
CREATE INDEX IF NOT EXISTS conversations_member_b_idx ON public.conversations (member_b);
CREATE INDEX IF NOT EXISTS conversations_recent_idx ON public.conversations (coalesce(last_message_at, created_at) DESC);

DROP TRIGGER IF EXISTS set_conversations_updated_at ON public.conversations;
CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ----------------------------------------------------------------------------
-- §2 conversation_members — participants (also the RLS anchor)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, user_id)
);

COMMENT ON TABLE public.conversation_members IS
  'Who is in a conversation. A member may only ever be a participant of conversations between themselves and the other stored member (trigger-enforced), and RLS shows them only their own rows.';

-- The inbox query is "all conversations I am in, newest first".
CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON public.conversation_members (user_id, joined_at DESC);


-- ----------------------------------------------------------------------------
-- §3 messages — text only. No contact details live in this table, ever.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Read state lives with the message (independent of notifications): set by
  -- mark_conversation_read() for every message the RECIPIENT has not read.
  read_at         TIMESTAMPTZ,

  CONSTRAINT messages_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
);

COMMENT ON TABLE public.messages IS
  'Chat messages. Written ONLY by send_message() (no INSERT grant for authenticated). Text only — phone numbers, emails and addresses are never stored here.';
COMMENT ON COLUMN public.messages.read_at IS 'When the recipient read this message. NULL = unread. Only the recipient can flip it, via mark_conversation_read().';

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON public.messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON public.messages (sender_id, created_at DESC);
-- Drives the unread badge + mark-as-read without scanning read rows.
CREATE INDEX IF NOT EXISTS messages_unread_idx
  ON public.messages (conversation_id, sender_id)
  WHERE read_at IS NULL;


-- ----------------------------------------------------------------------------
-- §3b RLS + least-privilege grants
--     SELECT only. No INSERT/UPDATE/DELETE for `authenticated` on any of the
--     three tables — writes go through the SECURITY DEFINER RPCs below.
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT ON public.conversation_members TO authenticated;
GRANT SELECT ON public.messages TO authenticated;

-- A member's own participation rows. This policy never touches
-- `conversations`, so the conversations/messages policies below can safely
-- sub-select this table without recursive RLS.
DROP POLICY IF EXISTS "Members read own participation" ON public.conversation_members;
CREATE POLICY "Members read own participation"
  ON public.conversation_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Only conversations I am a participant of.
DROP POLICY IF EXISTS "Participants read conversation" ON public.conversations;
CREATE POLICY "Participants read conversation"
  ON public.conversations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = conversations.id
        AND cm.user_id = auth.uid()
    )
  );

-- Only messages of conversations I am a participant of.
DROP POLICY IF EXISTS "Participants read messages" ON public.messages;
CREATE POLICY "Participants read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
  );


-- ----------------------------------------------------------------------------
-- §4 Predicates
-- ----------------------------------------------------------------------------

/** Am I (or the given user) in this conversation? */
CREATE OR REPLACE FUNCTION public.is_conversation_participant(
  p_conversation_id UUID,
  p_user_id         UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = p_conversation_id
      AND cm.user_id = coalesce(p_user_id, auth.uid())
  );
$$;

COMMENT ON FUNCTION public.is_conversation_participant(uuid, uuid) IS
  'Internal authorisation predicate. SECURITY DEFINER so the chat RPCs can verify participation for any pair regardless of the caller''s RLS view.';

REVOKE ALL ON FUNCTION public.is_conversation_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;


/**
 * Can these two members talk right now?
 * Both must hold a live membership, interest must be mutual, neither may have
 * blocked the other, and both accounts must be active. Time-aware: the moment
 * a subscription expires this returns FALSE.
 */
CREATE OR REPLACE FUNCTION public.can_chat_with(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RETURN FALSE;
  END IF;

  -- Paid members only — BOTH sides. Reuses the existing time-aware check.
  IF NOT public.has_live_membership(p_a) OR NOT public.has_live_membership(p_b) THEN
    RETURN FALSE;
  END IF;

  -- Mutual interest is the gate. Payment alone never opens a conversation.
  IF NOT public.mutual_interest_exists(p_a, p_b) THEN
    RETURN FALSE;
  END IF;

  -- Blocks cut messaging in both directions (existing blocks table).
  IF public.is_blocked(p_a, p_b) THEN
    RETURN FALSE;
  END IF;

  -- Deleted / deactivated accounts cannot receive messages.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id IN (p_a, p_b) AND p.is_active = FALSE
  ) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.can_chat_with(uuid, uuid) IS
  'TRUE only when both members are live paid members, interest is mutual, neither is blocked and both accounts are active. The single chat-authorisation predicate.';

REVOKE ALL ON FUNCTION public.can_chat_with(uuid, uuid) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- §5 chat_eligibility() — what the UI may show, without leaking anything
--    Deliberately COARSE: everything except "you need a package" collapses to
--    'unavailable', so this endpoint cannot be used to probe who has an
--    account, who is paid, or who blocked whom.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_eligibility(p_other_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'unauthenticated');
  END IF;

  IF NOT public.has_live_membership(v_me) THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'membership_required');
  END IF;

  IF public.can_chat_with(v_me, p_other_user_id) THEN
    RETURN jsonb_build_object('allowed', TRUE, 'reason', 'ok');
  END IF;

  RETURN jsonb_build_object('allowed', FALSE, 'reason', 'unavailable');
END;
$$;

COMMENT ON FUNCTION public.chat_eligibility(uuid) IS
  'Coarse chat verdict for the caller against one member: {allowed, reason}. Reasons are only ok / unauthenticated / membership_required / unavailable — never account, subscription or block details of the other member.';

REVOKE ALL ON FUNCTION public.chat_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_eligibility(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- §6 get_or_create_conversation() — the ONLY way a conversation is created
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me   UUID := auth.uid();
  v_a    UUID;
  v_b    UUID;
  v_id   UUID;
  v_new  BOOLEAN := FALSE;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_AUTHENTICATED';
  END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = v_me THEN
    -- No self-conversations, ever.
    RAISE EXCEPTION 'CHAT_INVALID_TARGET';
  END IF;

  -- Paid membership for the CALLER is reported distinctly (it drives the
  -- "Messaging is available to paid members" upgrade prompt). Everything
  -- else is a single generic refusal.
  IF NOT public.has_live_membership(v_me) THEN
    RAISE EXCEPTION 'PAID_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.can_chat_with(v_me, p_other_user_id) THEN
    RAISE EXCEPTION 'CHAT_UNAVAILABLE';
  END IF;

  v_a := least(v_me, p_other_user_id);
  v_b := greatest(v_me, p_other_user_id);

  -- Race-safe: two simultaneous "start chat" presses converge on one row.
  INSERT INTO public.conversations (member_a, member_b)
  VALUES (v_a, v_b)
  ON CONFLICT (member_a, member_b) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id
    FROM public.conversations c
    WHERE c.member_a = v_a AND c.member_b = v_b;
  ELSE
    v_new := TRUE;
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'CHAT_UNAVAILABLE';
  END IF;

  -- Both participants always exist; adding anyone else is impossible.
  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (v_id, v_a), (v_id, v_b)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'conversation_id', v_id,
    'other_user_id', p_other_user_id,
    'created', v_new
  );
END;
$$;

COMMENT ON FUNCTION public.get_or_create_conversation(uuid) IS
  'Resolves (or creates) the single conversation between the caller and another member. Verifies auth, live membership on BOTH sides, mutual interest and blocks before creating anything. Idempotent: repeated calls return the same conversation.';

REVOKE ALL ON FUNCTION public.get_or_create_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- §7 Authorised reads
-- ----------------------------------------------------------------------------

/** The conversation list behind /messages. No contact details, ever. */
CREATE OR REPLACE FUNCTION public.chat_inbox(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_AUTHENTICATED';
  END IF;
  -- Messaging is a paid feature: a free or expired member cannot read chat.
  -- Nothing is deleted — history returns as soon as the plan is renewed.
  IF NOT public.has_live_membership(v_me) THEN
    RAISE EXCEPTION 'PAID_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT coalesce(jsonb_agg(row_data ORDER BY sort_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'conversation_id', c.id,
        'other_user_id', p.id,
        'name', p.full_name,
        'photo', pp.storage_path,
        'last_message', CASE WHEN lm.id IS NULL THEN NULL ELSE left(lm.body, 140) END,
        'last_message_at', lm.created_at,
        'unread_count', (
          SELECT count(*)::int FROM public.messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id <> v_me
            AND m.read_at IS NULL
        ),
        -- Lets the UI explain why the composer is disabled without ever
        -- exposing the other member's subscription record.
        'other_is_member', public.has_live_membership(p.id),
        'created_at', c.created_at
      ) AS row_data,
      coalesce(lm.created_at, c.created_at) AS sort_at
    FROM public.conversation_members cm
    JOIN public.conversations c ON c.id = cm.conversation_id
    JOIN public.profiles p
      ON p.id = CASE WHEN c.member_a = v_me THEN c.member_b ELSE c.member_a END
    LEFT JOIN LATERAL (
      SELECT m.id, m.body, m.created_at
      FROM public.messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) lm ON TRUE
    LEFT JOIN LATERAL (
      SELECT ph.storage_path
      FROM public.profile_photos ph
      WHERE ph.profile_id = p.id AND ph.kind = 'profile_photo'
      ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
      LIMIT 1
    ) pp ON TRUE
    WHERE cm.user_id = v_me
    ORDER BY coalesce(lm.created_at, c.created_at) DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  ) t;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.chat_inbox(integer) IS
  'The caller''s conversations with the other member''s name/photo, last-message preview, last activity and unread count. Names and photos only — never phone, email or address.';

REVOKE ALL ON FUNCTION public.chat_inbox(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_inbox(integer) TO authenticated;


/** Conversation header + whether the caller may currently send. */
CREATE OR REPLACE FUNCTION public.get_conversation(p_conversation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_other  UUID;
  v_result JSONB;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_AUTHENTICATED';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_me) THEN
    RAISE EXCEPTION 'CHAT_NOT_A_PARTICIPANT';
  END IF;

  SELECT CASE WHEN c.member_a = v_me THEN c.member_b ELSE c.member_a END
  INTO v_other
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  SELECT jsonb_build_object(
    'conversation_id', c.id,
    'other_user_id', p.id,
    'name', p.full_name,
    'photo', pp.storage_path,
    'other_is_member', public.has_live_membership(p.id),
    'can_send', public.can_chat_with(v_me, p.id),
    'created_at', c.created_at
  )
  INTO v_result
  FROM public.conversations c
  JOIN public.profiles p ON p.id = CASE WHEN c.member_a = v_me THEN c.member_b ELSE c.member_a END
  LEFT JOIN LATERAL (
    SELECT ph.storage_path
    FROM public.profile_photos ph
    WHERE ph.profile_id = p.id AND ph.kind = 'profile_photo'
    ORDER BY ph.is_primary DESC, ph.sort_order ASC, ph.id ASC
    LIMIT 1
  ) pp ON TRUE
  WHERE c.id = p_conversation_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_conversation(uuid) IS
  'Header data for one of the caller''s own conversations (name, photo, can_send). Raises CHAT_NOT_A_PARTICIPANT for any conversation the caller is not in.';

REVOKE ALL ON FUNCTION public.get_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid) TO authenticated;


/** The newest `p_limit` messages of one of the caller's conversations. */
CREATE OR REPLACE FUNCTION public.list_messages(
  p_conversation_id UUID,
  p_limit           INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_limit  INTEGER := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_result JSONB;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_AUTHENTICATED';
  END IF;
  IF NOT public.has_live_membership(v_me) THEN
    RAISE EXCEPTION 'PAID_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_me) THEN
    RAISE EXCEPTION 'CHAT_NOT_A_PARTICIPANT';
  END IF;

  -- Newest window, returned oldest-first so the UI can render top-to-bottom.
  SELECT coalesce(jsonb_agg(row_data ORDER BY sort_at ASC, id ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'id', m.id,
        'conversation_id', m.conversation_id,
        'sender_id', m.sender_id,
        'body', m.body,
        'created_at', m.created_at,
        'read_at', m.read_at
      ) AS row_data,
      m.created_at AS sort_at,
      m.id         AS id
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit
  ) t;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.list_messages(uuid, integer) IS
  'Newest messages of one conversation, oldest-first. Only for participants, and only while the caller holds a live membership.';

REVOKE ALL ON FUNCTION public.list_messages(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_messages(uuid, integer) TO authenticated;


-- ----------------------------------------------------------------------------
-- §8 send_message() — the ONLY message-write path
--    Every rule is re-verified here from the database on every single send.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id UUID, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_body   TEXT := nullif(btrim(coalesce(p_body, '')), '');
  v_other  UUID;
  v_row    RECORD;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_AUTHENTICATED';
  END IF;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'CHAT_EMPTY_MESSAGE';
  END IF;
  IF char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'CHAT_MESSAGE_TOO_LONG';
  END IF;

  -- Membership of the conversation — the sender cannot be spoofed: sender_id
  -- is always auth.uid(), never a client-supplied value.
  IF NOT public.is_conversation_participant(p_conversation_id, v_me) THEN
    RAISE EXCEPTION 'CHAT_NOT_A_PARTICIPANT';
  END IF;

  -- Paid, unexpired plan for the sender.
  IF NOT public.has_live_membership(v_me) THEN
    RAISE EXCEPTION 'PAID_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT CASE WHEN c.member_a = v_me THEN c.member_b ELSE c.member_a END
  INTO v_other
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF v_other IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_A_PARTICIPANT';
  END IF;

  -- Recipient still paid, interest still mutual, no block, account live.
  -- An existing conversation never bypasses these — they are re-checked on
  -- every send, so an expired plan or a new block stops messaging at once.
  IF NOT public.can_chat_with(v_me, v_other) THEN
    RAISE EXCEPTION 'CHAT_UNAVAILABLE';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, body)
  VALUES (p_conversation_id, v_me, v_body)
  RETURNING id, conversation_id, sender_id, body, created_at, read_at
  INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION public.send_message(uuid, text) IS
  'The only way a message is written. Re-verifies participant membership, live membership on BOTH sides, mutual interest and blocks on every call; sender_id is always auth.uid(). Body is trimmed, non-empty and capped at 2000 characters.';

REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- §9 Read state (kept in messages, independent of notifications)
-- ----------------------------------------------------------------------------

/** Marks every message the caller has not read in one conversation as read. */
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_n  INTEGER;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'CHAT_NOT_AUTHENTICATED';
  END IF;
  IF NOT public.is_conversation_participant(p_conversation_id, v_me) THEN
    RAISE EXCEPTION 'CHAT_NOT_A_PARTICIPANT';
  END IF;

  -- Only the other member's messages, and only the unread ones. A member can
  -- never mark their own messages read or touch another conversation.
  UPDATE public.messages
  SET read_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_me
    AND read_at IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.mark_conversation_read(uuid) IS
  'Marks the caller''s unread messages in one of their own conversations as read and returns the count. Called when the conversation is actually opened.';

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;


/** Unread chat count for the navbar badge. */
CREATE OR REPLACE FUNCTION public.unread_message_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;
  -- A member without a live plan cannot open chat, so advertising a badge
  -- they cannot act on would be misleading: report 0 until they renew.
  IF NOT public.has_live_membership(v_me) THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT count(*)::int
    FROM public.messages m
    JOIN public.conversation_members cm
      ON cm.conversation_id = m.conversation_id AND cm.user_id = v_me
    WHERE m.sender_id <> v_me
      AND m.read_at IS NULL
  );
END;
$$;

COMMENT ON FUNCTION public.unread_message_count() IS
  'Exact unread chat message count for the calling member (0 when signed out or without a live membership). Drives the Messages badge in the navbar.';

REVOKE ALL ON FUNCTION public.unread_message_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unread_message_count() TO authenticated;


-- ----------------------------------------------------------------------------
-- §10 Triggers
-- ----------------------------------------------------------------------------

/**
 * Normalise the stored pair. Even though the only caller orders it already,
 * this guarantees the UNIQUE (member_a, member_b) constraint can never be
 * defeated by inserting the same pair the other way round.
 */
CREATE OR REPLACE FUNCTION public.normalize_conversation_pair()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tmp UUID;
BEGIN
  IF NEW.member_a = NEW.member_b THEN
    RAISE EXCEPTION 'CHAT_INVALID_TARGET';
  END IF;
  IF NEW.member_a > NEW.member_b THEN
    v_tmp := NEW.member_a;
    NEW.member_a := NEW.member_b;
    NEW.member_b := v_tmp;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalize_conversation_pair() IS
  'BEFORE INSERT trigger on conversations: swaps the pair into (lower, higher) order so the unique pair constraint holds no matter how the row was built, and refuses self-conversations.';

DROP TRIGGER IF EXISTS conversations_normalize_pair ON public.conversations;
CREATE TRIGGER conversations_normalize_pair
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_conversation_pair();


/**
 * Only the two stored members can ever be participants. Belt and braces:
 * `authenticated` has no INSERT grant at all, so this can only fire for the
 * SECURITY DEFINER path — and it makes the invariant explicit.
 */
CREATE OR REPLACE FUNCTION public.guard_conversation_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = NEW.conversation_id
      AND NEW.user_id IN (c.member_a, c.member_b)
  ) THEN
    RAISE EXCEPTION 'CHAT_NOT_A_PARTICIPANT';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_conversation_member() IS
  'BEFORE INSERT trigger on conversation_members: a participant row may only ever name one of the two members the conversation was created between.';

DROP TRIGGER IF EXISTS conversation_members_guard ON public.conversation_members;
CREATE TRIGGER conversation_members_guard
  BEFORE INSERT ON public.conversation_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_conversation_member();


/**
 * After a message lands: stamp the conversation (inbox ordering + the
 * Realtime wake-up the recipient's inbox listens to) and notify the other
 * member through the EXISTING notifications table.
 */
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other UUID;
  v_name  TEXT;
BEGIN
  SELECT CASE WHEN c.member_a = NEW.sender_id THEN c.member_b ELSE c.member_a END
  INTO v_other
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_other IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      updated_at      = now()
  WHERE id = NEW.conversation_id;

  -- One unread "New message" per conversation is enough to bring the member
  -- back; it keeps the bell usable during an active exchange.
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = v_other
      AND n.type = 'message_received'
      AND n.metadata ->> 'conversation_id' = NEW.conversation_id::text
      AND n.is_read = FALSE
  ) THEN
    SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = NEW.sender_id;

    -- No message body, and no contact details: push_notification() also
    -- scrubs phone/email/contact/address/password/token keys defensively.
    PERFORM public.push_notification(
      v_other,
      'message_received',
      'New message',
      'You have a new message from ' || coalesce(v_name, 'a member') || '.',
      jsonb_build_object('conversation_id', NEW.conversation_id, 'sender_id', NEW.sender_id),
      '/messages?c=' || NEW.conversation_id::text
    );
  END IF;

  PERFORM public.log_activity(
    NEW.sender_id,
    'message_sent',
    jsonb_build_object('conversation_id', NEW.conversation_id)
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_message() IS
  'AFTER INSERT trigger on messages: updates conversations.last_message_at, sends the recipient one unread message_received notification through the existing bell (ids only — never the message body), and logs the event.';

DROP TRIGGER IF EXISTS messages_after_insert ON public.messages;
CREATE TRIGGER messages_after_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_message();


-- ----------------------------------------------------------------------------
-- §11 Realtime — live delivery without polling
--     The client subscribes to postgres_changes and treats the event purely
--     as a wake-up signal, then re-reads through the SECURITY DEFINER RPCs
--     above. That keeps the browser on the authorised read path even if a
--     project has Realtime RLS enforcement switched off.
--     Guarded so the file still runs on a project without the publication.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;
  END IF;
END
$$;
