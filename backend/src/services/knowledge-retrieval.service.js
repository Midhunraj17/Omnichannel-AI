import { pool } from '../config/database.js';

import { env } from '../config/env.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const EMBEDDING_MODEL =
    process.env.COHERE_EMBED_MODEL || 'embed-v5.0-pro';


const EMBEDDING_DIMENSION =
    Number(process.env.COHERE_EMBED_DIMENSION || 1024);


const DEFAULT_TOP_K = 8;

const DEFAULT_SCORE_THRESHOLD = 0.15;

const DEFAULT_CANDIDATE_MULTIPLIER = 4;

const MAX_CANDIDATES = 80;


const createError = (
    message,
    statusCode = 400
) => {

    const error = new Error(message);

    error.statusCode = statusCode;

    return error;

};


const validateUUID = (
    value,
    label
) => {

    if (
        typeof value !== 'string'
        || !UUID_REGEX.test(value)
    ) {

        throw createError(
            `Invalid ${label}.`
        );

    }

};


const generateQueryEmbedding = async (
    query,
    fetchImpl = fetch
) => {

    const response = await fetchImpl(

        `${env.aiServiceUrl}/api/v1/knowledge/embed-query`,

        {

            method: 'POST',

            headers: {

                'Content-Type': 'application/json',

                Authorization:
                    `Bearer ${env.aiServiceApiKey}`

            },

            body: JSON.stringify({

                query

            }),

            signal: AbortSignal.timeout(30000)

        }

    );


    if (!response.ok) {

        throw createError(
            'Query embedding service failed.',
            502
        );

    }


    const result = await response.json();


    if (

        !result.success

        || !Array.isArray(result.embedding)

        || result.embedding.length !== EMBEDDING_DIMENSION

        || result.embedding.some(

            value =>

                typeof value !== 'number'

                || !Number.isFinite(value)

        )

    ) {

        throw createError(
            'Invalid query embedding returned by AI service.',
            502
        );

    }


    if (result.model !== EMBEDDING_MODEL) {

        throw createError(
            'Query and document embedding models do not match.',
            503
        );

    }


    return result.embedding;

};


// ============================================================
// HYBRID RETRIEVAL SERVICE FACTORY
// ============================================================

export const createKnowledgeRetrievalService = ({

    database = pool,

    fetchImpl = fetch

} = {}) => {


    const searchKnowledgeBase = async ({

        organizationId,

        knowledgeBaseId,

        query,

        topK = DEFAULT_TOP_K,

        scoreThreshold = DEFAULT_SCORE_THRESHOLD

    }) => {


        // ----------------------------------------------------
        // 1. VALIDATE IDENTIFIERS
        // ----------------------------------------------------

        validateUUID(
            organizationId,
            'organization ID'
        );


        validateUUID(
            knowledgeBaseId,
            'knowledge base ID'
        );


        // ----------------------------------------------------
        // 2. VALIDATE QUERY
        // ----------------------------------------------------

        if (

            typeof query !== 'string'

            || !query.trim()

            || query.length > 5000

        ) {

            throw createError(
                'Query must contain 1–5000 characters.'
            );

        }


        const normalizedQuery = query.trim();


        // ----------------------------------------------------
        // 3. VALIDATE TOP K
        // ----------------------------------------------------

        if (

            !Number.isInteger(topK)

            || topK < 1

            || topK > 20

        ) {

            throw createError(
                'top_k must be between 1 and 20.'
            );

        }


        // ----------------------------------------------------
        // 4. VALIDATE SEMANTIC THRESHOLD
        // ----------------------------------------------------

        if (

            typeof scoreThreshold !== 'number'

            || !Number.isFinite(scoreThreshold)

            || scoreThreshold < 0

            || scoreThreshold > 1

        ) {

            throw createError(
                'score_threshold must be between 0 and 1.'
            );

        }


        // ----------------------------------------------------
        // 5. VERIFY KNOWLEDGE BASE OWNERSHIP
        // ----------------------------------------------------

        const knowledgeBaseResult = await database.query(

            `

                SELECT

                    id,

                    retrieval_config

                FROM public.knowledge_bases

                WHERE id = $1

                AND organization_id = $2

                AND status = 'active'

                LIMIT 1

            `,

            [

                knowledgeBaseId,

                organizationId

            ]

        );


        if (!knowledgeBaseResult.rowCount) {

            throw createError(
                'Knowledge base not found or inactive.',
                404
            );

        }


        // ----------------------------------------------------
        // 6. GENERATE QUERY EMBEDDING
        // ----------------------------------------------------

        const embedding = await generateQueryEmbedding(

            normalizedQuery,

            fetchImpl

        );


        const vectorLiteral =

            `[${embedding.join(',')}]`;


        // ----------------------------------------------------
        // 7. CALCULATE CANDIDATE COUNT
        // ----------------------------------------------------

        const candidateCount = Math.min(

            MAX_CANDIDATES,

            Math.max(

                topK,

                topK * DEFAULT_CANDIDATE_MULTIPLIER

            )

        );


        // ----------------------------------------------------
        // 8. EXECUTE HYBRID RETRIEVAL
        // ----------------------------------------------------

        const result = await database.query(

            `

                SELECT

                    chunk_id,

                    document_id,

                    file_name,

                    chunk_index,

                    content,

                    metadata,

                    similarity,

                    semantic_similarity,

                    lexical_score,

                    semantic_rank,

                    lexical_rank,

                    hybrid_score

                FROM public.search_knowledge_chunks_hybrid(

                    $1::uuid,

                    $2::uuid,

                    $3::extensions.vector,

                    $4::text,

                    $5::text,

                    $6::integer,

                    $7::double precision,

                    $8::integer

                )

            `,

            [

                organizationId,

                knowledgeBaseId,

                vectorLiteral,

                EMBEDDING_MODEL,

                normalizedQuery,

                topK,

                scoreThreshold,

                candidateCount

            ]

        );


        // ----------------------------------------------------
        // 9. RETURN HYBRID RESULTS
        // ----------------------------------------------------

        return {

            knowledge_base_id: knowledgeBaseId,

            query: normalizedQuery,

            retrieval_method: 'hybrid_rrf',

            embedding_model: EMBEDDING_MODEL,

            result_count: result.rowCount,

            candidate_count: candidateCount,

            results: result.rows

        };

    };


    return {

        searchKnowledgeBase

    };

};


// ============================================================
// PRODUCTION EXPORT
// ============================================================

const productionService = createKnowledgeRetrievalService();


export const searchKnowledgeBase =

    productionService.searchKnowledgeBase;