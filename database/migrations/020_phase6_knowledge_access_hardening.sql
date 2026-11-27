-- ============================================================
-- PHASE 6.2
-- KNOWLEDGE ACCESS INTEGRATION HARDENING
-- ============================================================

BEGIN;


-- ============================================================
-- 1. VALIDATE EXISTING ASSOCIATIONS
-- ============================================================

DO $$
DECLARE
    duplicate_chatbots INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO duplicate_chatbots
    FROM (
        SELECT organization_id, chatbot_id
        FROM public.knowledge_base_chatbot_access
        GROUP BY organization_id, chatbot_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_chatbots > 0 THEN
        RAISE EXCEPTION
            'Multiple knowledge bases are associated with one chatbot. Resolve duplicate associations before applying migration 020.';
    END IF;
END $$;


-- ============================================================
-- 2. ENFORCE ONE KNOWLEDGE BASE PER CHATBOT
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
    uq_kb_access_one_kb_per_chatbot

ON public.knowledge_base_chatbot_access (
    organization_id,
    chatbot_id
);


-- ============================================================
-- 3. CREATE SYNCHRONIZATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION
public.sync_knowledge_base_chatbot_access()

RETURNS TRIGGER

LANGUAGE plpgsql

SECURITY INVOKER

SET search_path = ''

AS $$

BEGIN

    -- New knowledge base
    IF TG_OP = 'INSERT' THEN

        IF NEW.chatbot_id IS NOT NULL THEN

            INSERT INTO public.knowledge_base_chatbot_access (
                organization_id,
                knowledge_base_id,
                chatbot_id
            )

            VALUES (
                NEW.organization_id,
                NEW.id,
                NEW.chatbot_id
            )

            ON CONFLICT (
                knowledge_base_id,
                chatbot_id
            )

            DO NOTHING;

        END IF;

        RETURN NEW;

    END IF;


    -- Existing knowledge base:
    -- Synchronize when its chatbot or organization changes.

    IF OLD.chatbot_id IS DISTINCT FROM NEW.chatbot_id
       OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
    THEN

        IF OLD.chatbot_id IS NOT NULL THEN

            DELETE FROM public.knowledge_base_chatbot_access

            WHERE organization_id = OLD.organization_id

              AND knowledge_base_id = OLD.id

              AND chatbot_id = OLD.chatbot_id;

        END IF;


        IF NEW.chatbot_id IS NOT NULL THEN

            INSERT INTO public.knowledge_base_chatbot_access (
                organization_id,
                knowledge_base_id,
                chatbot_id
            )

            VALUES (
                NEW.organization_id,
                NEW.id,
                NEW.chatbot_id
            )

            ON CONFLICT (
                knowledge_base_id,
                chatbot_id
            )

            DO NOTHING;

        END IF;

    END IF;


    RETURN NEW;

END;

$$;


-- ============================================================
-- 4. REPLACE OLD TRIGGER IF PRESENT
-- ============================================================

DROP TRIGGER IF EXISTS
    trg_sync_knowledge_base_chatbot_access

ON public.knowledge_bases;


-- ============================================================
-- 5. CREATE SYNCHRONIZATION TRIGGER
-- ============================================================

CREATE TRIGGER
    trg_sync_knowledge_base_chatbot_access

AFTER INSERT OR UPDATE OF
    chatbot_id,
    organization_id

ON public.knowledge_bases

FOR EACH ROW

EXECUTE FUNCTION
    public.sync_knowledge_base_chatbot_access();


-- ============================================================
-- 6. RESTRICT FUNCTION EXECUTION
-- ============================================================

REVOKE ALL ON FUNCTION
public.sync_knowledge_base_chatbot_access()

FROM PUBLIC;


-- ============================================================
-- 7. FINAL ASSOCIATION VALIDATION
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

    WHERE access.organization_id <> kb.organization_id

       OR access.organization_id <> cb.organization_id;


    IF invalid_associations > 0 THEN

        RAISE EXCEPTION
            'Cross-organization knowledge-base association detected.';

    END IF;

END $$;


COMMIT;