-- =====================================================
-- MIGRATION 010
-- TENANT DATA INTEGRITY
-- Project: Omnichannel AI Customer Support
-- Database: Supabase PostgreSQL
-- =====================================================

BEGIN;


-- =====================================================
-- 1. VERIFY EXISTING TENANT RELATIONSHIPS
-- =====================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM public.conversations c

        LEFT JOIN public.chatbots cb
            ON cb.id = c.chatbot_id
           AND cb.organization_id = c.organization_id

        WHERE cb.id IS NULL
    ) THEN

        RAISE EXCEPTION
            'Tenant integrity violation: conversations reference chatbots from another organization.';

    END IF;

END;
$$;


-- =====================================================
-- 2. CREATE COMPOSITE UNIQUE KEY
-- =====================================================

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
            'uq_chatbots_id_organization'
          AND conrelid =
            'public.chatbots'::regclass
    ) THEN

        ALTER TABLE public.chatbots

        ADD CONSTRAINT
            uq_chatbots_id_organization

        UNIQUE (
            id,
            organization_id
        );

    END IF;

END;
$$;


-- =====================================================
-- 3. ENFORCE CONVERSATION TENANT OWNERSHIP
-- =====================================================

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
            'fk_conversations_chatbot_tenant'
          AND conrelid =
            'public.conversations'::regclass
    ) THEN

        ALTER TABLE public.conversations

        ADD CONSTRAINT
            fk_conversations_chatbot_tenant

        FOREIGN KEY (
            chatbot_id,
            organization_id
        )

        REFERENCES public.chatbots (
            id,
            organization_id
        )

        ON DELETE CASCADE

        NOT VALID;

    END IF;

END;
$$;


-- =====================================================
-- 4. VALIDATE TENANT RELATIONSHIP
-- =====================================================

ALTER TABLE public.conversations

VALIDATE CONSTRAINT
    fk_conversations_chatbot_tenant;


-- =====================================================
-- 5. VERIFICATION
-- =====================================================

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
            'fk_conversations_chatbot_tenant'
          AND convalidated = TRUE
    ) THEN

        RAISE EXCEPTION
            'Conversation tenant integrity constraint was not validated.';

    END IF;

END;
$$;


COMMIT;


-- =====================================================
-- MIGRATION 010 COMPLETED
-- =====================================================