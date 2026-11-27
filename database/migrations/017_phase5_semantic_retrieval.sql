-- ============================================================
-- PHASE 5.6
-- VECTOR DATABASE INTEGRATION & SEMANTIC RETRIEVAL
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. VERIFY PGVECTOR INSTALLATION
-- ------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n
            ON n.oid = e.extnamespace
        WHERE e.extname = 'vector'
          AND n.nspname = 'extensions'
    ) THEN
        RAISE EXCEPTION
            'pgvector must be installed in the extensions schema';
    END IF;
END;
$$;


-- ------------------------------------------------------------
-- 2. CREATE VECTOR INDEX
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS
    idx_document_embeddings_hnsw_cosine

ON public.document_embeddings

USING hnsw (
    embedding extensions.vector_cosine_ops
);


-- ------------------------------------------------------------
-- 3. CREATE EMBEDDING MODEL LOOKUP INDEX
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS
    idx_document_embeddings_model_chunk

ON public.document_embeddings (
    embedding_model,
    chunk_id
);


-- ------------------------------------------------------------
-- 4. REMOVE PREVIOUS V2 FUNCTION IF PRESENT
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS
public.search_knowledge_chunks_v2(
    UUID,
    UUID,
    extensions.vector,
    TEXT,
    INTEGER,
    DOUBLE PRECISION
);


-- ------------------------------------------------------------
-- 5. CREATE SEMANTIC SEARCH FUNCTION
-- ------------------------------------------------------------

CREATE FUNCTION public.search_knowledge_chunks_v2(

    p_organization_id UUID,

    p_knowledge_base_id UUID,

    p_query_embedding extensions.vector(1024),

    p_embedding_model TEXT,

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

        kc.id AS chunk_id,

        kd.id AS document_id,

        kd.file_name,

        kc.chunk_index,

        kc.content,

        kc.metadata,

        (
            1 - (
                de.embedding
                OPERATOR(extensions.<=>)
                p_query_embedding
            )
        )::DOUBLE PRECISION AS similarity

    FROM public.document_embeddings de

    INNER JOIN public.knowledge_chunks kc
        ON kc.id = de.chunk_id

    INNER JOIN public.knowledge_documents kd
        ON kd.id = kc.document_id

    INNER JOIN public.knowledge_bases kb
        ON kb.id = kd.knowledge_base_id

    WHERE

        kb.organization_id = p_organization_id

        AND kb.id = p_knowledge_base_id

        AND kb.status = 'active'

        AND kd.status = 'completed'

        AND de.embedding_model = p_embedding_model

        AND (
            1 - (
                de.embedding
                OPERATOR(extensions.<=>)
                p_query_embedding
            )
        ) >= GREATEST(
            0.0,
            LEAST(
                COALESCE(p_score_threshold, 0.15),
                1.0
            )
        )

    ORDER BY

        de.embedding
        OPERATOR(extensions.<=>)
        p_query_embedding

    LIMIT GREATEST(
        1,
        LEAST(
            COALESCE(p_match_count, 8),
            20
        )
    );

$$;


-- ------------------------------------------------------------
-- 6. RESTRICT FUNCTION ACCESS
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION
public.search_knowledge_chunks_v2(
    UUID,
    UUID,
    extensions.vector,
    TEXT,
    INTEGER,
    DOUBLE PRECISION
)
FROM PUBLIC;


GRANT EXECUTE ON FUNCTION
public.search_knowledge_chunks_v2(
    UUID,
    UUID,
    extensions.vector,
    TEXT,
    INTEGER,
    DOUBLE PRECISION
)
TO service_role;


COMMIT;