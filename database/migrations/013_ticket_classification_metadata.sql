-- =====================================================
-- MIGRATION 013
-- ADVANCED TICKET CLASSIFICATION METADATA
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- 1. SUBCATEGORY
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS subcategory TEXT;


-- -----------------------------------------------------
-- 2. CLASSIFICATION CONFIDENCE
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC(4,3);

DO $$
BEGIN

    IF NOT EXISTS (

        SELECT 1

        FROM pg_constraint

        WHERE conname = 'tickets_classification_confidence_check'

    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_classification_confidence_check

        CHECK (
            classification_confidence IS NULL
            OR classification_confidence BETWEEN 0 AND 1
        );

    END IF;

END $$;


-- -----------------------------------------------------
-- 3. CLASSIFICATION LABELS
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS classification_labels JSONB
DEFAULT '[]'::JSONB;


-- -----------------------------------------------------
-- 4. CLASSIFICATION METHOD
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS classification_method TEXT;

DO $$
BEGIN

    IF NOT EXISTS (

        SELECT 1

        FROM pg_constraint

        WHERE conname = 'tickets_classification_method_check'

    ) THEN

        ALTER TABLE public.tickets

        ADD CONSTRAINT tickets_classification_method_check

        CHECK (
            classification_method IS NULL
            OR classification_method IN ('rules', 'hybrid')
        );

    END IF;

END $$;


-- -----------------------------------------------------
-- 5. HUMAN REVIEW FLAG
-- -----------------------------------------------------

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS requires_human_review BOOLEAN
NOT NULL DEFAULT FALSE;


-- -----------------------------------------------------
-- 6. INDEXES
-- -----------------------------------------------------

CREATE INDEX IF NOT EXISTS
idx_tickets_org_subcategory

ON public.tickets (
    organization_id,
    subcategory
);


CREATE INDEX IF NOT EXISTS
idx_tickets_human_review

ON public.tickets (
    organization_id,
    requires_human_review,
    created_at DESC
)

WHERE requires_human_review = TRUE;


COMMIT;