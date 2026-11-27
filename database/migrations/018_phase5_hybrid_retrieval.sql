-- ============================================================
-- PHASE 5.7
-- HYBRID KNOWLEDGE RETRIEVAL
-- Semantic Search + PostgreSQL Full-Text Search + RRF
-- ============================================================

BEGIN;


-- ============================================================
-- 1. FULL-TEXT SEARCH INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS
    idx_knowledge_chunks_fulltext

ON public.knowledge_chunks

USING GIN (
    pg_catalog.to_tsvector(
        'pg_catalog.simple'::pg_catalog.regconfig,
        content
    )
);


-- ============================================================
-- 2. ADDITIONAL DOCUMENT LOOKUP INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS
    idx_knowledge_documents_kb_status_id

ON public.knowledge_documents (
    knowledge_base_id,
    status,
    id
);


-- ============================================================
-- 3. REMOVE PREVIOUS VERSION IF PRESENT
-- ============================================================

DROP FUNCTION IF EXISTS
public.search_knowledge_chunks_hybrid(
    UUID,
    UUID,
    extensions.vector,
    TEXT,
    TEXT,
    INTEGER,
    DOUBLE PRECISION,
    INTEGER
);


-- ============================================================
-- 4. CREATE HYBRID RETRIEVAL FUNCTION
-- ============================================================

CREATE FUNCTION public.search_knowledge_chunks_hybrid(

    p_organization_id UUID,

    p_knowledge_base_id UUID,

    p_query_embedding extensions.vector(1024),

    p_embedding_model TEXT,

    p_query_text TEXT,

    p_match_count INTEGER DEFAULT 8,

    p_score_threshold DOUBLE PRECISION DEFAULT 0.15,

    p_candidate_count INTEGER DEFAULT 40

)

RETURNS TABLE (

    chunk_id UUID,

    document_id UUID,

    file_name TEXT,

    chunk_index INTEGER,

    content TEXT,

    metadata JSONB,

    similarity DOUBLE PRECISION,

    semantic_similarity DOUBLE PRECISION,

    lexical_score DOUBLE PRECISION,

    semantic_rank BIGINT,

    lexical_rank BIGINT,

    hybrid_score DOUBLE PRECISION

)

LANGUAGE SQL

STABLE

SECURITY INVOKER

SET search_path = ''

AS $$

WITH

-- ==========================================================
-- 1. NORMALIZE SEARCH QUERY
-- ==========================================================

search_query AS (

    SELECT

        pg_catalog.websearch_to_tsquery(
            'pg_catalog.simple'::pg_catalog.regconfig,
            pg_catalog.btrim(p_query_text)
        ) AS query

),


-- ==========================================================
-- 2. SEMANTIC RETRIEVAL
-- ==========================================================

semantic_candidates AS (

    SELECT

        kc.id AS chunk_id,

        kd.id AS document_id,

        kd.file_name,

        kc.chunk_index,

        kc.content,

        kc.metadata,

        (
            1.0 -

            (
                de.embedding

                OPERATOR(extensions.<=>)

                p_query_embedding
            )

        )::DOUBLE PRECISION AS semantic_similarity

    FROM public.document_embeddings AS de

    INNER JOIN public.knowledge_chunks AS kc

        ON kc.id = de.chunk_id

    INNER JOIN public.knowledge_documents AS kd

        ON kd.id = kc.document_id

    INNER JOIN public.knowledge_bases AS kb

        ON kb.id = kd.knowledge_base_id

    WHERE

        kb.id = p_knowledge_base_id

        AND kb.organization_id = p_organization_id

        AND kb.status = 'active'

        AND kd.status = 'completed'

        AND de.embedding_model = p_embedding_model

        AND (

            1.0 -

            (
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

            COALESCE(p_candidate_count, 40),

            80

        )

    )

),


-- ==========================================================
-- 3. SEMANTIC RANKING
-- ==========================================================

semantic_ranked AS (

    SELECT

        sc.*,

        ROW_NUMBER() OVER (

            ORDER BY sc.semantic_similarity DESC

        ) AS semantic_rank

    FROM semantic_candidates AS sc

),


-- ==========================================================
-- 4. KEYWORD / FULL-TEXT RETRIEVAL
-- ==========================================================

lexical_candidates AS (

    SELECT

        kc.id AS chunk_id,

        kd.id AS document_id,

        kd.file_name,

        kc.chunk_index,

        kc.content,

        kc.metadata,

        pg_catalog.ts_rank_cd(

            pg_catalog.to_tsvector(

                'pg_catalog.simple'::pg_catalog.regconfig,

                kc.content

            ),

            sq.query

        )::DOUBLE PRECISION AS lexical_score

    FROM public.knowledge_chunks AS kc

    INNER JOIN public.knowledge_documents AS kd

        ON kd.id = kc.document_id

    INNER JOIN public.knowledge_bases AS kb

        ON kb.id = kd.knowledge_base_id

    CROSS JOIN search_query AS sq

    WHERE

        kb.id = p_knowledge_base_id

        AND kb.organization_id = p_organization_id

        AND kb.status = 'active'

        AND kd.status = 'completed'

        AND sq.query <> ''::pg_catalog.tsquery

        AND pg_catalog.to_tsvector(

            'pg_catalog.simple'::pg_catalog.regconfig,

            kc.content

        ) @@ sq.query

    ORDER BY

        lexical_score DESC

    LIMIT GREATEST(

        1,

        LEAST(

            COALESCE(p_candidate_count, 40),

            80

        )

    )

),


-- ==========================================================
-- 5. KEYWORD RANKING
-- ==========================================================

lexical_ranked AS (

    SELECT

        lc.*,

        ROW_NUMBER() OVER (

            ORDER BY lc.lexical_score DESC

        ) AS lexical_rank

    FROM lexical_candidates AS lc

),


-- ==========================================================
-- 6. COMBINE BOTH RESULT SETS
-- ==========================================================

combined_candidates AS (

    SELECT

        COALESCE(

            sr.chunk_id,

            lr.chunk_id

        ) AS chunk_id,

        COALESCE(

            sr.document_id,

            lr.document_id

        ) AS document_id,

        COALESCE(

            sr.file_name,

            lr.file_name

        ) AS file_name,

        COALESCE(

            sr.chunk_index,

            lr.chunk_index

        ) AS chunk_index,

        COALESCE(

            sr.content,

            lr.content

        ) AS content,

        COALESCE(

            sr.metadata,

            lr.metadata

        ) AS metadata,

        COALESCE(

            sr.semantic_similarity,

            0.0

        )::DOUBLE PRECISION AS semantic_similarity,

        COALESCE(

            lr.lexical_score,

            0.0

        )::DOUBLE PRECISION AS lexical_score,

        sr.semantic_rank,

        lr.lexical_rank

    FROM semantic_ranked AS sr

    FULL OUTER JOIN lexical_ranked AS lr

        ON sr.chunk_id = lr.chunk_id

),


-- ==========================================================
-- 7. RECIPROCAL RANK FUSION
-- ==========================================================

hybrid_ranked AS (

    SELECT

        cc.*,

        (

            CASE

                WHEN cc.semantic_rank IS NOT NULL

                THEN

                    61.0 /

                    (60.0 + cc.semantic_rank)

                ELSE 0.0

            END

            +

            CASE

                WHEN cc.lexical_rank IS NOT NULL

                THEN

                    61.0 /

                    (60.0 + cc.lexical_rank)

                ELSE 0.0

            END

        )::DOUBLE PRECISION AS hybrid_score

    FROM combined_candidates AS cc

)


-- ==========================================================
-- 8. FINAL HYBRID RESULTS
-- ==========================================================

SELECT

    hr.chunk_id,

    hr.document_id,

    hr.file_name,

    hr.chunk_index,

    hr.content,

    hr.metadata,

    hr.semantic_similarity AS similarity,

    hr.semantic_similarity,

    hr.lexical_score,

    hr.semantic_rank,

    hr.lexical_rank,

    hr.hybrid_score

FROM hybrid_ranked AS hr

ORDER BY

    hr.hybrid_score DESC,

    hr.semantic_similarity DESC,

    hr.lexical_score DESC

LIMIT GREATEST(

    1,

    LEAST(

        COALESCE(p_match_count, 8),

        20

    )

);

$$;


-- ============================================================
-- 9. FUNCTION PERMISSIONS
-- ============================================================

REVOKE ALL ON FUNCTION

public.search_knowledge_chunks_hybrid(

    UUID,

    UUID,

    extensions.vector,

    TEXT,

    TEXT,

    INTEGER,

    DOUBLE PRECISION,

    INTEGER

)

FROM PUBLIC;


GRANT EXECUTE ON FUNCTION

public.search_knowledge_chunks_hybrid(

    UUID,

    UUID,

    extensions.vector,

    TEXT,

    TEXT,

    INTEGER,

    DOUBLE PRECISION,

    INTEGER

)

TO service_role;


COMMIT;