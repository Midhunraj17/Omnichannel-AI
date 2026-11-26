-- =====================================================
-- MIGRATION 014
-- TICKET PRIORITY AND SEVERITY ENGINE
-- =====================================================

BEGIN;


-- -----------------------------------------------------
-- 1. IMPACT LEVEL
-- -----------------------------------------------------

ALTER TABLE public.tickets

ADD COLUMN IF NOT EXISTS impact_level SMALLINT;


-- -----------------------------------------------------
-- 2. URGENCY LEVEL
-- -----------------------------------------------------

ALTER TABLE public.tickets

ADD COLUMN IF NOT EXISTS urgency_level SMALLINT;


-- -----------------------------------------------------
-- 3. FIRST RESPONSE SLA
-- -----------------------------------------------------

ALTER TABLE public.tickets

ADD COLUMN IF NOT EXISTS first_response_sla_hours INTEGER;


-- -----------------------------------------------------
-- 4. RESOLUTION SLA
-- -----------------------------------------------------

ALTER TABLE public.tickets

ADD COLUMN IF NOT EXISTS resolution_sla_hours INTEGER;


-- -----------------------------------------------------
-- 5. ESCALATION FLAG
-- -----------------------------------------------------

ALTER TABLE public.tickets

ADD COLUMN IF NOT EXISTS escalation_required BOOLEAN

NOT NULL DEFAULT FALSE;


-- -----------------------------------------------------
-- 6. PRIORITY REASON CODES
-- -----------------------------------------------------

ALTER TABLE public.tickets

ADD COLUMN IF NOT EXISTS priority_reason_codes JSONB

NOT NULL DEFAULT '[]'::JSONB;


-- -----------------------------------------------------
-- 7. VALIDATION CONSTRAINTS
-- -----------------------------------------------------

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_impact_level_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_impact_level_check

        CHECK (
            impact_level IS NULL
            OR impact_level BETWEEN 1 AND 5
        );

    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_urgency_level_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_urgency_level_check

        CHECK (
            urgency_level IS NULL
            OR urgency_level BETWEEN 1 AND 5
        );

    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_first_response_sla_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_first_response_sla_check

        CHECK (
            first_response_sla_hours IS NULL
            OR first_response_sla_hours BETWEEN 1 AND 720
        );

    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_resolution_sla_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_resolution_sla_check

        CHECK (
            resolution_sla_hours IS NULL
            OR resolution_sla_hours BETWEEN 1 AND 720
        );

    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_priority_reason_codes_check'
          AND conrelid = 'public.tickets'::regclass
    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_priority_reason_codes_check

        CHECK (
            jsonb_typeof(priority_reason_codes) = 'array'
        );

    END IF;

END $$;


-- -----------------------------------------------------
-- 8. PRIORITY QUEUE INDEX
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS

idx_tickets_priority_queue

ON public.tickets (
    organization_id,
    priority_score DESC,
    created_at ASC
);


-- -----------------------------------------------------
-- 9. ESCALATION QUEUE INDEX
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS

idx_tickets_escalation_queue

ON public.tickets (
    organization_id,
    created_at ASC
)

WHERE escalation_required = TRUE;


COMMIT;