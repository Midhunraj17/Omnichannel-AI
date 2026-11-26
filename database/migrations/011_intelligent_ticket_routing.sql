-- =====================================================
-- MIGRATION 011
-- INTELLIGENT TICKET ROUTING
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- 1. AGENT ROUTING CONFIGURATION
-- -----------------------------------------------------

ALTER TABLE public.support_agents
ADD COLUMN IF NOT EXISTS max_active_tickets INTEGER
NOT NULL DEFAULT 10;

ALTER TABLE public.support_agents
ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

ALTER TABLE public.support_agents
ADD CONSTRAINT support_agents_max_active_tickets_check
CHECK (max_active_tickets BETWEEN 1 AND 100);


-- -----------------------------------------------------
-- 2. TICKET CLASSIFICATION METADATA
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS severity TEXT
CHECK (
    severity IS NULL
    OR severity IN ('critical', 'high', 'medium', 'low')
);

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS priority_score INTEGER
CHECK (
    priority_score IS NULL
    OR priority_score BETWEEN 0 AND 100
);

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;


-- -----------------------------------------------------
-- 3. ASSIGNMENT AUDIT METADATA
-- -----------------------------------------------------

ALTER TABLE public.ticket_assignments
ADD COLUMN IF NOT EXISTS assignment_strategy TEXT
DEFAULT 'automatic';

ALTER TABLE public.ticket_assignments
ADD COLUMN IF NOT EXISTS assignment_reason TEXT;


-- -----------------------------------------------------
-- 4. INDEXES
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS
idx_support_agents_routing
ON public.support_agents (
    availability_status,
    last_assigned_at
);

CREATE INDEX IF NOT EXISTS
idx_tickets_agent_active
ON public.tickets (
    assigned_agent_id,
    status
)
WHERE assigned_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
idx_tickets_org_category
ON public.tickets (
    organization_id,
    category
);

CREATE INDEX IF NOT EXISTS
idx_ticket_assignments_active
ON public.ticket_assignments (
    ticket_id,
    assigned_at DESC
)
WHERE unassigned_at IS NULL;


-- -----------------------------------------------------
-- 5. PREVENT MULTIPLE ACTIVE ASSIGNMENTS
-- -----------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS
uq_ticket_assignments_one_active
ON public.ticket_assignments (ticket_id)
WHERE unassigned_at IS NULL;


COMMIT;