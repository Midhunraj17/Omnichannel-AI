-- =====================================================
-- MIGRATION 012
-- TICKET INTAKE AND ROUTING ORCHESTRATION
-- =====================================================

BEGIN;

-- Idempotency key for ticket creation requests.
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS intake_request_id UUID;

-- Ensure a request cannot create duplicate tickets
-- inside the same organization.
CREATE UNIQUE INDEX IF NOT EXISTS
uq_tickets_organization_intake_request
ON public.tickets (
    organization_id,
    intake_request_id
)
WHERE intake_request_id IS NOT NULL;

-- Efficient conversation ticket lookup.
CREATE INDEX IF NOT EXISTS
idx_tickets_conversation_created
ON public.tickets (
    conversation_id,
    created_at DESC
)
WHERE conversation_id IS NOT NULL;

-- Efficient organization ticket queue.
CREATE INDEX IF NOT EXISTS
idx_tickets_organization_queue
ON public.tickets (
    organization_id,
    status,
    priority,
    created_at DESC
);

COMMIT;