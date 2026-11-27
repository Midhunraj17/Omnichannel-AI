-- Phase 5.1–5.5: knowledge-base metadata, document lifecycle and indexes.
-- Safe to re-run. Existing Phase 1 knowledge tables are reused.

BEGIN;

ALTER TABLE public.knowledge_documents
    ADD COLUMN IF NOT EXISTS content_hash TEXT,
    ADD COLUMN IF NOT EXISTS error_message TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mime_type TEXT;

ALTER TABLE public.knowledge_bases
    ADD COLUMN IF NOT EXISTS retrieval_config JSONB NOT NULL
        DEFAULT '{"top_k":8,"score_threshold":0.15}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_org_status
    ON public.knowledge_bases (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb_status
    ON public.knowledge_documents (knowledge_base_id, status);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_index
    ON public.knowledge_chunks (document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_model
    ON public.document_embeddings (embedding_model);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_content_hash
    ON public.knowledge_documents (knowledge_base_id, content_hash)
    WHERE content_hash IS NOT NULL;

-- A scoped search function is included for the upcoming retrieval tasks.
-- The OPERATOR(schema.operator) form is required when pgvector is installed
-- in the Supabase "extensions" schema rather than the default search_path.
DROP FUNCTION IF EXISTS public.search_knowledge_chunks(
    UUID, UUID, extensions.vector, INTEGER, DOUBLE PRECISION
);
DROP FUNCTION IF EXISTS public.search_knowledge_chunks(
    UUID, UUID, vector, INTEGER, DOUBLE PRECISION
);

CREATE OR REPLACE FUNCTION public.search_knowledge_chunks(
    p_organization_id UUID,
    p_knowledge_base_id UUID,
    p_query_embedding extensions.vector(1024),
    p_match_count INTEGER DEFAULT 8,
    p_score_threshold DOUBLE PRECISION DEFAULT 0.15
)
RETURNS TABLE (
    chunk_id UUID,
    document_id UUID,
    file_name TEXT,
    chunk_index INTEGER,
    content TEXT,
    metadata JSONB,
    similarity DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        kc.id,
        kd.id,
        kd.file_name,
        kc.chunk_index,
        kc.content,
        kc.metadata,
        (1 - (de.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
    FROM public.document_embeddings AS de
    JOIN public.knowledge_chunks AS kc ON kc.id = de.chunk_id
    JOIN public.knowledge_documents AS kd ON kd.id = kc.document_id
    JOIN public.knowledge_bases AS kb ON kb.id = kd.knowledge_base_id
    WHERE kb.organization_id = p_organization_id
      AND kb.id = p_knowledge_base_id
      AND kb.status = 'active'
      AND kd.status = 'completed'
      AND de.embedding_model = current_setting('app.embedding_model', true)
      AND (1 - (de.embedding OPERATOR(extensions.<=>) p_query_embedding))
            >= p_score_threshold
    ORDER BY de.embedding OPERATOR(extensions.<=>) p_query_embedding
    LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 8), 20));
$$;

REVOKE ALL ON FUNCTION public.search_knowledge_chunks(
    UUID, UUID, extensions.vector, INTEGER, DOUBLE PRECISION
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.search_knowledge_chunks(
    UUID, UUID, extensions.vector, INTEGER, DOUBLE PRECISION
) TO authenticated, service_role;

COMMIT;
