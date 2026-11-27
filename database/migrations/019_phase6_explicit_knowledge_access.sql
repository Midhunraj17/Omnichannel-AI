-- ============================================================
-- PHASE 6.2.1
-- EXPLICIT CHATBOT-KNOWLEDGE BASE ASSOCIATION
--
-- Purpose:
-- 1. Introduce explicit chatbot-to-KB relationships.
-- 2. Prevent implicit organization-wide KB fallback.
-- 3. Enforce organization ownership at database level.
-- 4. Preserve existing chatbot-specific assignments.
-- 5. Restrict direct table access.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. ENSURE COMPOSITE REFERENCED KEYS EXIST
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
    idx_knowledge_bases_id_organization_unique

ON public.knowledge_bases (
    id,
    organization_id
);


CREATE UNIQUE INDEX IF NOT EXISTS
    idx_chatbots_id_organization_unique

ON public.chatbots (
    id,
    organization_id
);


-- ============================================================
-- 2. CREATE EXPLICIT ASSOCIATION TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS
    public.knowledge_base_chatbot_access (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL,

    knowledge_base_id UUID NOT NULL,

    chatbot_id UUID NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_knowledge_base_chatbot_access
        UNIQUE (
            knowledge_base_id,
            chatbot_id
        ),

    CONSTRAINT fk_kb_access_knowledge_base
        FOREIGN KEY (
            knowledge_base_id,
            organization_id
        )
        REFERENCES public.knowledge_bases (
            id,
            organization_id
        )
        ON DELETE CASCADE,

    CONSTRAINT fk_kb_access_chatbot
        FOREIGN KEY (
            chatbot_id,
            organization_id
        )
        REFERENCES public.chatbots (
            id,
            organization_id
        )
        ON DELETE CASCADE

);


-- ============================================================
-- 3. CREATE LOOKUP INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS
    idx_kb_chatbot_access_chatbot

ON public.knowledge_base_chatbot_access (
    organization_id,
    chatbot_id
);


CREATE INDEX IF NOT EXISTS
    idx_kb_chatbot_access_knowledge_base

ON public.knowledge_base_chatbot_access (
    organization_id,
    knowledge_base_id
);


-- ============================================================
-- 4. MIGRATE EXISTING EXPLICIT CHATBOT ASSIGNMENTS
-- ============================================================

INSERT INTO public.knowledge_base_chatbot_access (
    organization_id,
    knowledge_base_id,
    chatbot_id
)

SELECT
    kb.organization_id,
    kb.id,
    kb.chatbot_id

FROM public.knowledge_bases AS kb

INNER JOIN public.chatbots AS cb

    ON cb.id = kb.chatbot_id

   AND cb.organization_id = kb.organization_id

WHERE kb.chatbot_id IS NOT NULL

ON CONFLICT (
    knowledge_base_id,
    chatbot_id
)

DO NOTHING;


-- ============================================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE
    public.knowledge_base_chatbot_access

ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 6. RESTRICT DIRECT ACCESS
-- ============================================================

REVOKE ALL ON TABLE
    public.knowledge_base_chatbot_access

FROM PUBLIC;


REVOKE ALL ON TABLE
    public.knowledge_base_chatbot_access

FROM anon;


REVOKE ALL ON TABLE
    public.knowledge_base_chatbot_access

FROM authenticated;


GRANT SELECT, INSERT, UPDATE, DELETE

ON TABLE public.knowledge_base_chatbot_access

TO service_role;


-- ============================================================
-- 7. VALIDATION
-- ============================================================

DO $$

DECLARE

    invalid_associations INTEGER;

BEGIN

    SELECT COUNT(*)

    INTO invalid_associations

    FROM public.knowledge_base_chatbot_access AS access

    INNER JOIN public.knowledge_bases AS kb

        ON kb.id = access.knowledge_base_id

    INNER JOIN public.chatbots AS cb

        ON cb.id = access.chatbot_id

    WHERE
        access.organization_id <> kb.organization_id

        OR access.organization_id <> cb.organization_id;


    IF invalid_associations > 0 THEN

        RAISE EXCEPTION
            'Invalid cross-organization knowledge-base associations detected.';

    END IF;

END $$;


COMMIT;