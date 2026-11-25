-- =====================================================
-- MIGRATION 009
-- MESSAGE-LEVEL IDEMPOTENCY
-- Project: Omnichannel AI Customer Support
-- Database: Supabase PostgreSQL
-- =====================================================

BEGIN;

-- Associate messages with the API request that created them.
-- NULL preserves compatibility with existing messages.

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS idempotency_key UUID;


-- Prevent duplicate customer/bot messages for the same
-- conversation and API request.

CREATE UNIQUE INDEX IF NOT EXISTS
uq_messages_conversation_idempotency_sender
ON public.messages (
    conversation_id,
    idempotency_key,
    sender_type
)
WHERE idempotency_key IS NOT NULL;


COMMIT;
