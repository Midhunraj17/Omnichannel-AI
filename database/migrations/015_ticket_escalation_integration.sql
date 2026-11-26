-- =====================================================
-- MIGRATION 015
-- BACKEND TICKET ESCALATION INTEGRATION
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- 1. FIRST RESPONSE TIMESTAMP
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;


-- -----------------------------------------------------
-- 2. CURRENT ESCALATION LEVEL
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS escalation_level SMALLINT
NOT NULL DEFAULT 0;


-- -----------------------------------------------------
-- 3. ESCALATION REASON CODES
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS escalation_reason_codes JSONB
NOT NULL DEFAULT '[]'::JSONB;


-- -----------------------------------------------------
-- 4. ESCALATION TARGET
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS escalation_target TEXT
NOT NULL DEFAULT 'NONE';


-- -----------------------------------------------------
-- 5. LAST ESCALATION EVALUATION
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS escalation_evaluated_at TIMESTAMPTZ;


-- -----------------------------------------------------
-- 6. VALIDATION CONSTRAINTS
-- -----------------------------------------------------

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_escalation_level_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_escalation_level_check

        CHECK (
            escalation_level BETWEEN 0 AND 3
        );

    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_escalation_reason_codes_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_escalation_reason_codes_check

        CHECK (
            jsonb_typeof(escalation_reason_codes) = 'array'
        );

    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_escalation_target_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_escalation_target_check

        CHECK (
            escalation_target IN (
                'NONE',
                'TEAM_SUPERVISOR',
                'SUPPORT_MANAGER',
                'CRITICAL_RESPONSE_TEAM'
            )
        );

    END IF;

END $$;


-- -----------------------------------------------------
-- 7. ESCALATION QUEUE INDEX
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS
idx_tickets_escalation_level

ON public.tickets (
    organization_id,
    escalation_level DESC,
    escalation_evaluated_at DESC
)

WHERE escalation_level > 0;


-- -----------------------------------------------------
-- 8. FIRST RESPONSE SLA INDEX
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS
idx_tickets_first_response_sla

ON public.tickets (
    organization_id,
    first_response_at,
    created_at
)

WHERE first_response_at IS NULL;


COMMIT;