import { pool } from '../config/database.js';

import { env } from '../config/env.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const EMBEDDING_MODEL =
    process.env.COHERE_EMBED_MODEL || 'embed-v5.0-pro';


const EMBEDDING_DIMENSION =
    Number(process.env.COHERE_EMBED_DIMENSION || 1024);


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
    query
) => {

    const response = await fetch(

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
            value => !Number.isFinite(Number(value))
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


    return result.embedding.map(Number);

};


// ============================================================
// SEMANTIC SEARCH
// ============================================================

export const searchKnowledgeBase = async ({

    organizationId,

    knowledgeBaseId,

    query,

    topK = 8,

    scoreThreshold = 0.15

}) => {


    // --------------------------------------------------------
    // 1. VALIDATE IDENTIFIERS
    // --------------------------------------------------------

    validateUUID(
        organizationId,
        'organization ID'
    );

    validateUUID(
        knowledgeBaseId,
        'knowledge base ID'
    );


    // --------------------------------------------------------
    // 2. VALIDATE QUERY
    // --------------------------------------------------------

    if (
        typeof query !== 'string'
        || !query.trim()
        || query.length > 5000
    ) {

        throw createError(
            'Query must contain 1–5000 characters.'
        );

    }


    // --------------------------------------------------------
    // 3. VALIDATE TOP K
    // --------------------------------------------------------

    if (
        !Number.isInteger(topK)
        || topK < 1
        || topK > 20
    ) {

        throw createError(
            'top_k must be between 1 and 20.'
        );

    }


    // --------------------------------------------------------
    // 4. VALIDATE SCORE THRESHOLD
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // 5. VERIFY KNOWLEDGE BASE OWNERSHIP
    // --------------------------------------------------------

    const knowledgeBaseResult = await pool.query(

        `SELECT id

         FROM public.knowledge_bases

         WHERE id = $1

         AND organization_id = $2

         AND status = 'active'

         LIMIT 1`,

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


    // --------------------------------------------------------
    // 6. GENERATE QUERY EMBEDDING
    // --------------------------------------------------------

    const embedding = await generateQueryEmbedding(
        query.trim()
    );


    const vectorLiteral =
        `[${embedding.join(',')}]`;


    // --------------------------------------------------------
    // 7. PERFORM VECTOR SIMILARITY SEARCH
    // --------------------------------------------------------

    const result = await pool.query(

        `SELECT

            chunk_id,

            document_id,

            file_name,

            chunk_index,

            content,

            metadata,

            similarity

         FROM public.search_knowledge_chunks_v2(

            $1::uuid,

            $2::uuid,

            $3::extensions.vector,

            $4::text,

            $5::integer,

            $6::double precision

         )`,

        [

            organizationId,

            knowledgeBaseId,

            vectorLiteral,

            EMBEDDING_MODEL,

            topK,

            scoreThreshold

        ]

    );


    // --------------------------------------------------------
    // 8. RETURN RESULTS
    // --------------------------------------------------------

    return {

        knowledge_base_id: knowledgeBaseId,

        query: query.trim(),

        embedding_model: EMBEDDING_MODEL,

        result_count: result.rowCount,

        results: result.rows

    };

};