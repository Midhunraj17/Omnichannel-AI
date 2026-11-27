import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createChatbotKnowledgeBaseService
} from '../src/services/chatbot-knowledge-base.service.js';


const ORGANIZATION_ID =
    '11111111-1111-4111-8111-111111111111';

const CHATBOT_ID =
    '22222222-2222-4222-8222-222222222222';

const KNOWLEDGE_BASE_ID =
    '33333333-3333-4333-8333-333333333333';


const createMockDatabase = ({
    queryResult = {
        rows: [],
        rowCount: 0
    },
    queryHandler = null
} = {}) => {

    const calls = [];

    const database = {

        calls,

        query: async (sql, params = []) => {

            calls.push({
                sql,
                params
            });

            if (queryHandler) {

                return queryHandler(
                    sql,
                    params
                );

            }

            return queryResult;

        },

        connect: async () => {

            const client = {

                calls,

                query: async (sql, params = []) => {

                    calls.push({
                        sql,
                        params
                    });

                    if (queryHandler) {

                        return queryHandler(
                            sql,
                            params
                        );

                    }

                    return queryResult;

                },

                release: () => {}

            };

            return client;

        }

    };

    return database;

};


// =====================================================
// FIND KNOWLEDGE BASE
// =====================================================

test(

    'findKnowledgeBaseForChatbot uses explicit association',

    async () => {

        const database = createMockDatabase({

            queryResult: {

                rows: [

                    {

                        id: KNOWLEDGE_BASE_ID,

                        organization_id: ORGANIZATION_ID,

                        chatbot_id: CHATBOT_ID,

                        name: 'Support Knowledge',

                        retrieval_config: {}

                    }

                ],

                rowCount: 1

            }

        });


        const service =
            createChatbotKnowledgeBaseService({
                database
            });


        const result =
            await service.findKnowledgeBaseForChatbot({

                organizationId: ORGANIZATION_ID,

                chatbotId: CHATBOT_ID

            });


        assert.equal(
            result.id,
            KNOWLEDGE_BASE_ID
        );


        assert.match(

            database.calls[0].sql,

            /knowledge_base_chatbot_access/

        );

    }

);


// =====================================================
// NO IMPLICIT FALLBACK
// =====================================================

test(

    'findKnowledgeBaseForChatbot returns null without association',

    async () => {

        const database = createMockDatabase({

            queryResult: {

                rows: [],

                rowCount: 0

            }

        });


        const service =
            createChatbotKnowledgeBaseService({
                database
            });


        const result =
            await service.findKnowledgeBaseForChatbot({

                organizationId: ORGANIZATION_ID,

                chatbotId: CHATBOT_ID

            });


        assert.equal(
            result,
            null
        );

    }

);


// =====================================================
// MULTIPLE ACTIVE KNOWLEDGE BASES
// =====================================================

test(

    'findKnowledgeBaseForChatbot rejects ambiguous multiple associations',

    async () => {

        const database = createMockDatabase({

            queryResult: {

                rows: [

                    { id: KNOWLEDGE_BASE_ID },

                    { id: '44444444-4444-4444-8444-444444444444' }

                ],

                rowCount: 2

            }

        });


        const service =
            createChatbotKnowledgeBaseService({
                database
            });


        await assert.rejects(

            () => service.findKnowledgeBaseForChatbot({

                organizationId: ORGANIZATION_ID,

                chatbotId: CHATBOT_ID

            }),

            {

                statusCode: 409

            }

        );

    }

);


// =====================================================
// UUID VALIDATION
// =====================================================

test(

    'findKnowledgeBaseForChatbot rejects invalid organization ID',

    async () => {

        const database = createMockDatabase();


        const service =
            createChatbotKnowledgeBaseService({
                database
            });


        await assert.rejects(

            () => service.findKnowledgeBaseForChatbot({

                organizationId: 'invalid',

                chatbotId: CHATBOT_ID

            }),

            {

                statusCode: 400

            }

        );


        assert.equal(
            database.calls.length,
            0
        );

    }

);


// =====================================================
// GRANT ACCESS
// =====================================================

test(

    'grantKnowledgeBaseAccess verifies both resources and inserts association',

    async () => {

        const database = createMockDatabase({

            queryHandler: async (sql) => {

                if (sql.includes('SELECT id')) {

                    return {

                        rows: [{ id: KNOWLEDGE_BASE_ID }],

                        rowCount: 1

                    };

                }

                if (sql.includes('INSERT INTO')) {

                    return {

                        rows: [{ id: '55555555-5555-4555-8555-555555555555' }],

                        rowCount: 1

                    };

                }

                return {

                    rows: [],

                    rowCount: 0

                };

            }

        });


        const service =
            createChatbotKnowledgeBaseService({
                database
            });


        const result =
            await service.grantKnowledgeBaseAccess({

                organizationId: ORGANIZATION_ID,

                knowledgeBaseId: KNOWLEDGE_BASE_ID,

                chatbotId: CHATBOT_ID

            });


        assert.equal(
            result.success,
            true
        );


        assert.equal(
            result.already_associated,
            false
        );


        assert.ok(

            database.calls.some(

                call => call.sql.includes(
                    'INSERT INTO public.knowledge_base_chatbot_access'
                )

            )

        );

    }

);


// =====================================================
// CROSS-ORGANIZATION ACCESS
// =====================================================

test(

    'grantKnowledgeBaseAccess rejects missing knowledge base ownership',

    async () => {

        const database = createMockDatabase({

            queryHandler: async () => ({

                rows: [],

                rowCount: 0

            })

        });


        const service =
            createChatbotKnowledgeBaseService({
                database
            });


        await assert.rejects(

            () => service.grantKnowledgeBaseAccess({

                organizationId: ORGANIZATION_ID,

                knowledgeBaseId: KNOWLEDGE_BASE_ID,

                chatbotId: CHATBOT_ID

            }),

            {

                statusCode: 404

            }

        );

    }

);


// =====================================================
// REVOKE ACCESS
// =====================================================

test(
    'revokeKnowledgeBaseAccess removes only matching association',
    async () => {

        const database = createMockDatabase({

            queryResult: {
                rows: [{ id: KNOWLEDGE_BASE_ID }],
                rowCount: 1
            }

        });

        const service =
            createChatbotKnowledgeBaseService({
                database
            });

        const result =
            await service.revokeKnowledgeBaseAccess({

                organizationId: ORGANIZATION_ID,

                knowledgeBaseId: KNOWLEDGE_BASE_ID,

                chatbotId: CHATBOT_ID

            });

        assert.equal(
            result.revoked,
            true
        );

        // Verify transaction started.
        assert.equal(
            database.calls[0].sql,
            'BEGIN'
        );

        // Verify the exact association DELETE was executed.
        assert.ok(

            database.calls.some(

                call => /DELETE FROM public\.knowledge_base_chatbot_access/i
                    .test(call.sql)

            )

        );

        // Verify transaction committed.
        assert.ok(

            database.calls.some(

                call => call.sql === 'COMMIT'

            )

        );

    }
);