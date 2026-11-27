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


const createDependencies = ({

    knowledgeBaseExists = true,

    retrievalRows = [],

    fetchStatus = 200,

    embedding = EMBEDDING,

    model = 'embed-v5.0-pro'

} = {}) => {

    const databaseCalls = [];

    const fetchCalls = [];


    const database = {

        async query(sql, params) {

            databaseCalls.push({

                sql,

                params

            });


            if (sql.includes('SELECT') &&

                sql.includes('retrieval_config')) {

                return {

                    rowCount: knowledgeBaseExists ? 1 : 0,

                    rows: knowledgeBaseExists

                        ? [{

                            id: KNOWLEDGE_BASE_ID,

                            retrieval_config: {

                                top_k: 8,

                                score_threshold: 0.15

                            }

                        }]

                        : []

                };

            }


            if (sql.includes('search_knowledge_chunks_hybrid')) {

                return {

                    rowCount: retrievalRows.length,

                    rows: retrievalRows

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


        return {

            ok: fetchStatus >= 200 && fetchStatus < 300,

            status: fetchStatus,

            async json() {

                return {

                    success: true,

                    model,

                    dimension: embedding.length,

                    embedding

                };

            }

        };

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

    scoreThreshold: 0.15

});


// ============================================================
// TEST 1: HYBRID RETRIEVAL
// ============================================================

test(

    'should execute hybrid retrieval successfully',

    async () => {

        const dependencies = createDependencies({

            retrievalRows: [

                {

                    chunk_id: 'chunk-1',

                    content: 'Refund policy',

                    semantic_similarity: 0.91,

                    lexical_score: 0.75,

                    semantic_rank: 1,

                    lexical_rank: 2,

                    hybrid_score: 1.976

                }

            ]

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        const result = await service.searchKnowledgeBase(

            validInput()

        );


        assert.equal(

            result.retrieval_method,

            'hybrid_rrf'

        );


        assert.equal(

            result.result_count,

            1

        );


        assert.equal(

            result.results[0].chunk_id,

            'chunk-1'

        );


        assert.equal(

            dependencies.databaseCalls.length,

            2

        );

    }

);


// ============================================================
// TEST 2: TENANT OWNERSHIP
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
// TEST 3: INVALID ORGANIZATION UUID
// ============================================================

test(

    'should reject invalid organization UUID',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase({

                ...validInput(),

                organizationId: 'invalid'

            }),

            /Invalid organization ID/

        );

    }

);


// ============================================================
// TEST 4: INVALID QUERY
// ============================================================

test(

    'should reject empty search queries',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase({

                ...validInput(),

                query: '   '

            }),

            /Query must contain/

        );

    }

);


// ============================================================
// TEST 5: INVALID TOP K
// ============================================================

test(

    'should reject invalid topK values',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase({

                ...validInput(),

                topK: 100

            }),

            /top_k must be between/

        );

    }

);


// ============================================================
// TEST 6: INVALID SCORE THRESHOLD
// ============================================================

test(

    'should reject invalid score thresholds',

    async () => {

        const dependencies = createDependencies();


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase({

                ...validInput(),

                scoreThreshold: 2

            }),

            /score_threshold must be between/

        );

    }

);


// ============================================================
// TEST 7: COHERE EMBEDDING SERVICE FAILURE
// ============================================================

test(

    'should reject failed query embedding requests',

    async () => {

        const dependencies = createDependencies({

            fetchStatus: 500

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
// TEST 8: EMBEDDING MODEL MISMATCH
// ============================================================

test(

    'should reject mismatched embedding models',

    async () => {

        const dependencies = createDependencies({

            model: 'different-embedding-model'

        });


        const service = createKnowledgeRetrievalService({

            database: dependencies.database,

            fetchImpl: dependencies.fetchImpl

        });


        await assert.rejects(

            service.searchKnowledgeBase(validInput()),

            error => error.statusCode === 503

        );

    }

);


// ============================================================
// TEST 9: HYBRID SQL FUNCTION
// ============================================================

test(

    'should call the hybrid SQL function with tenant-scoped parameters',

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


        assert.ok(hybridCall);


        assert.equal(

            hybridCall.params[0],

            ORGANIZATION_ID

        );


        assert.equal(

            hybridCall.params[1],

            KNOWLEDGE_BASE_ID

        );


        assert.equal(

            hybridCall.params[4],

            'How can I request a refund?'

        );


        assert.equal(

            hybridCall.params[5],

            8

        );


        assert.equal(

            hybridCall.params[6],

            0.15

        );

    }

);