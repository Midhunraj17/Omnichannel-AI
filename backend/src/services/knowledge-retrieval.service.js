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

const MAX_HYBRID_CANDIDATES = 20;

const DEFAULT_MIN_RERANK_SCORE = 0.0;

const DEFAULT_MAX_CONTEXT_CHARACTERS = 8000;


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


const callAIService = async (

    endpoint,

    payload,

    fetchImpl

) => {

    let response;

    try {

        response = await fetchImpl(

            `${env.aiServiceUrl}${endpoint}`,

            {

                method: 'POST',

                headers: {

                    'Content-Type': 'application/json',

                    Authorization:

                        `Bearer ${env.aiServiceApiKey}`

                },

                body: JSON.stringify(payload),

                signal: AbortSignal.timeout(45000)

            }

        );

    } catch (error) {

        throw createError(

            'AI service is temporarily unavailable.',

            502

        );

    }


    if (!response.ok) {

        throw createError(

            `AI service request failed (${response.status}).`,

            502

        );

    }


    try {

        return await response.json();

    } catch {

        throw createError(

            'AI service returned an invalid response.',

            502

        );

    }

};


// ============================================================
// QUERY EMBEDDING
// ============================================================

const generateQueryEmbedding = async (

    query,

    fetchImpl

) => {

    const result = await callAIService(

        '/api/v1/knowledge/embed-query',

        {

            query

        },

        fetchImpl

    );


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
// VALIDATE RERANKING RESPONSE
// ============================================================

const validateRerankingResponse = (

    response,

    topK

) => {

    if (

        !response

        || response.success !== true

        || !Array.isArray(response.results)

        || !Array.isArray(response.sources)

        || typeof response.context !== 'string'

        || response.context.length > DEFAULT_MAX_CONTEXT_CHARACTERS

    ) {

        throw createError(

            'Invalid reranking response returned by AI service.',

            502

        );

    }


    if (response.results.length > topK) {

        throw createError(

            'AI service returned too many reranked documents.',

            502

        );

    }


    if (

        !Number.isInteger(response.context_document_count)

        || response.context_document_count < 0

        || response.context_document_count > topK

    ) {

        throw createError(

            'Invalid context document count.',

            502

        );

    }


    return response;

};


// ============================================================
// HYBRID + RERANKING SERVICE FACTORY
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

        scoreThreshold = DEFAULT_SCORE_THRESHOLD,

        minRerankScore = DEFAULT_MIN_RERANK_SCORE

    }) => {


        // ----------------------------------------------------
        // 1. VALIDATE ORGANIZATION AND KNOWLEDGE BASE
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

            || topK > 8

        ) {

            throw createError(

                'top_k must be between 1 and 8.'

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
        // 5. VALIDATE RERANKING THRESHOLD
        // ----------------------------------------------------

        if (

            typeof minRerankScore !== 'number'

            || !Number.isFinite(minRerankScore)

            || minRerankScore < 0

            || minRerankScore > 1

        ) {

            throw createError(

                'min_rerank_score must be between 0 and 1.'

            );

        }


        // ----------------------------------------------------
        // 6. VERIFY KNOWLEDGE BASE OWNERSHIP
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
        // 7. GENERATE QUERY EMBEDDING
        // ----------------------------------------------------

        const embedding = await generateQueryEmbedding(

            normalizedQuery,

            fetchImpl

        );


        const vectorLiteral =

            `[${embedding.join(',')}]`;


        // ----------------------------------------------------
        // 8. HYBRID RETRIEVAL
        // ----------------------------------------------------

        const candidateCount = Math.min(

            MAX_HYBRID_CANDIDATES,

            topK * 4

        );


        const hybridResult = await database.query(

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

                candidateCount,

                scoreThreshold,

                candidateCount

            ]

        );


        // ----------------------------------------------------
        // 9. HANDLE EMPTY RETRIEVAL
        // ----------------------------------------------------

        if (!hybridResult.rowCount) {

            return {

                success: true,

                knowledge_base_id: knowledgeBaseId,

                query: normalizedQuery,

                retrieval_method: 'hybrid_rrf',

                reranking_method: 'cohere_rerank',

                candidate_count: 0,

                result_count: 0,

                results: [],

                context: '',

                context_character_count: 0,

                context_document_count: 0,

                sources: [],

                context_truncated: false

            };

        }


        // ----------------------------------------------------
        // 10. RERANK HYBRID CANDIDATES
        // ----------------------------------------------------

        const rerankingResult = await callAIService(

            '/api/v1/knowledge/rerank-context',

            {

                query: normalizedQuery,

                documents: hybridResult.rows,

                top_n: topK,

                min_relevance_score: minRerankScore,

                max_context_characters:

                    DEFAULT_MAX_CONTEXT_CHARACTERS

            },

            fetchImpl

        );


        // ----------------------------------------------------
        // 11. VALIDATE RERANKING RESPONSE
        // ----------------------------------------------------

        const validatedResult = validateRerankingResponse(

            rerankingResult,

            topK

        );


        // ----------------------------------------------------
        // 12. RETURN COMPLETE RETRIEVAL RESULT
        // ----------------------------------------------------

        return {

            success: true,

            knowledge_base_id: knowledgeBaseId,

            query: normalizedQuery,

            retrieval_method: 'hybrid_rrf',

            reranking_method: 'cohere_rerank',

            embedding_model: EMBEDDING_MODEL,

            candidate_count: hybridResult.rowCount,

            result_count: validatedResult.results.length,

            results: validatedResult.results,

            context: validatedResult.context,

            context_character_count:

                validatedResult.context_character_count,

            context_document_count:

                validatedResult.context_document_count,

            sources: validatedResult.sources,

            context_truncated:

                validatedResult.context_truncated

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