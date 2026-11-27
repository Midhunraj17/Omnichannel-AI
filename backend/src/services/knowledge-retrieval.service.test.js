import test from 'node:test';

import assert from 'node:assert/strict';


import {

    createKnowledgeRetrievalService

} from './knowledge-retrieval.service.js';


const ORGANIZATION_ID =

    '11111111-1111-4111-8111-111111111111';


const KNOWLEDGE_BASE_ID =

    '22222222-2222-4222-8222-222222222222';


const EMBEDDING = Array(1024).fill(0.25);


const HYBRID_ROWS = [

    {

        chunk_id: 'chunk-1',

        document_id: 'doc-1',

        file_name: 'refunds.pdf',

        chunk_index: 0,

        content: 'Customers can request refunds within 7 days.',

        metadata: {},

        similarity: 0.91,

        semantic_similarity: 0.91,

        lexical_score: 0.75,

        semantic_rank: 1,

        lexical_rank: 2,

        hybrid_score: 1.976

    }

];


const RERANKING_RESPONSE = {

    success: true,

    query: 'How can I request a refund?',

    reranking_model: 'rerank-v5.0-fast',

    candidate_count: 1,

    result_count: 1,

    results: [

        {

            ...HYBRID_ROWS[0],

            rerank_score: 0.95,

            rerank_rank: 1

        }

    ],

    context: '[RETRIEVED KNOWLEDGE CONTEXT]\nRefund policy',

    context_character_count: 47,

    context_document_count: 1,

    sources: [

        {

            chunk_id: 'chunk-1',

            document_id: 'doc-1',

            file_name: 'refunds.pdf',

            rerank_score: 0.95,

            source_number: 1

        }

    ],

    context_truncated: false

};


const createDependencies = ({

    knowledgeBaseExists = true,

    hybridRows = HYBRID_ROWS,

    rerankingResponse = RERANKING_RESPONSE,

    embedding = EMBEDDING,

    model = 'embed-v5.0-pro',

    failEmbedding = false,

    failReranking = false

} = {}) => {


    const databaseCalls = [];

    const fetchCalls = [];


    const database = {

        async query(sql, params) {

            databaseCalls.push({

                sql,

                params

            });


            if (sql.includes('retrieval_config')) {

                return {

                    rowCount: knowledgeBaseExists ? 1 : 0,

                    rows: knowledgeBaseExists

                        ? [

                            {

                                id: KNOWLEDGE_BASE_ID,

                                retrieval_config: {}

                            }

                        ]

                        : []

                };

            }


            if (sql.includes('search_knowledge_chunks_hybrid')) {

                return {

                    rowCount: hybridRows.length,

                    rows: hybridRows

                };

            }


            throw new Error(

                'Unexpected database query.'

            );

        }

    };


    const fetchImpl = async (url, options) => {

        fetchCalls.push({

            url,

            options

        });


        if (

            failEmbedding

            && url.includes('embed-query')

        ) {

            return {

                ok: false,

                status: 502,

                async json() {

                    return {};

                }

            };

        }


        if (

            failReranking

            && url.includes('rerank-context')

        ) {

            return {

                ok: false,

                status: 502,

                async json() {

                    return {};

                }

            };

        }


        if (url.includes('embed-query')) {

            return {

                ok: true,

                async json() {

                    return {

                        success: true,

                        model,

                        dimension: embedding.length,

                        embedding

                    };

                }

            };

        }


        if (url.includes('rerank-context')) {

            return {

                ok: true,

                async json() {

                    return rerankingResponse;

                }

            };

        }


        throw new Error(

            'Unexpected AI service endpoint.'

        );

    };


    return {

        database,

        fetchImpl,

        databaseCalls,

        fetchCalls

    };

};


const validInput = () => ({

    organizationId: ORGANIZATION_ID,

    knowledgeBaseId: KNOWLEDGE_BASE_ID,

    query: 'How can I request a refund?',

    topK: 8,

    scoreThreshold: 0.15,

    minRerankScore: 0.0

});


// ============================================================
// 1. COMPLETE RETRIEVAL PIPELINE
// ============================================================

test(

    'should execute hybrid retrieval, reranking and context construction',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        const result = await service.searchKnowledgeBase(

            validInput()

        );


        assert.equal(result.success, true);

        assert.equal(result.retrieval_method, 'hybrid_rrf');

        assert.equal(result.reranking_method, 'cohere_rerank');

        assert.equal(result.result_count, 1);

        assert.equal(result.context_document_count, 1);

        assert.ok(result.context.includes('Refund policy'));


        assert.equal(

            dependencies.databaseCalls.length,

            2

        );


        assert.equal(

            dependencies.fetchCalls.length,

            2

        );

    }

);


// ============================================================
// 2. VERIFY CANDIDATE COUNT
// ============================================================

test(

    'should request more candidates than final topK',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await service.searchKnowledgeBase(validInput());


        const hybridCall = dependencies.databaseCalls.find(

            call => call.sql.includes(

                'search_knowledge_chunks_hybrid'

            )

        );


        assert.equal(

            hybridCall.params[5],

            20

        );

    }

);


// ============================================================
// 3. TENANT OWNERSHIP
// ============================================================

test(

    'should reject knowledge bases outside the organization',

    async () => {

        const dependencies = createDependencies({

            knowledgeBaseExists: false

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase(validInput()),

            error => error.statusCode === 404

        );


        assert.equal(

            dependencies.fetchCalls.length,

            0

        );

    }

);


// ============================================================
// 4. INVALID QUERY
// ============================================================

test(

    'should reject empty queries',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase({

                ...validInput(),

                query: ' '

            }),

            /Query must contain/

        );

    }

);


// ============================================================
// 5. INVALID TOP K
// ============================================================

test(

    'should reject topK above eight',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase({

                ...validInput(),

                topK: 10

            }),

            /top_k must be between/

        );

    }

);


// ============================================================
// 6. EMBEDDING SERVICE FAILURE
// ============================================================

test(

    'should handle query embedding service failure',

    async () => {

        const dependencies = createDependencies({

            failEmbedding: true

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase(validInput()),

            error => error.statusCode === 502

        );

    }

);


// ============================================================
// 7. RERANKING SERVICE FAILURE
// ============================================================

test(

    'should handle reranking service failure',

    async () => {

        const dependencies = createDependencies({

            failReranking: true

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase(validInput()),

            error => error.statusCode === 502

        );

    }

);


// ============================================================
// 8. EMPTY HYBRID RESULTS
// ============================================================

test(

    'should return an empty context when hybrid retrieval finds nothing',

    async () => {

        const dependencies = createDependencies({

            hybridRows: []

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        const result = await service.searchKnowledgeBase(

            validInput()

        );


        assert.equal(result.result_count, 0);

        assert.equal(result.context, '');

        assert.equal(result.context_document_count, 0);

        assert.equal(

            dependencies.fetchCalls.length,

            1

        );

    }

);


// ============================================================
// 9. INVALID RERANKING RESPONSE
// ============================================================

test(

    'should reject malformed reranking responses',

    async () => {

        const dependencies = createDependencies({

            rerankingResponse: {

                success: true,

                results: [],

                context: null,

                sources: []

            }

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase(validInput()),

            error => error.statusCode === 502

        );

    }

);