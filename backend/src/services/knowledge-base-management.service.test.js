import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createKnowledgeBaseManagementService
} from './knowledge-base-management.service.js';


const ORGANIZATION_ID =
    '11111111-1111-4111-8111-111111111111';

const KNOWLEDGE_BASE_ID =
    '22222222-2222-4222-8222-222222222222';


const createDatabase = (responses = []) => {

    const calls = [];

    return {

        calls,

        async query(sql, params) {

            calls.push({
                sql,
                params
            });

            const response = responses.shift();

            if (response instanceof Error) {
                throw response;
            }

            return response ?? {
                rowCount: 0,
                rows: []
            };

        }

    };

};


// =====================================================
// GET KNOWLEDGE BASE
// =====================================================

test(
    'getKnowledgeBase returns tenant-owned Knowledge Base details',
    async () => {

        const expected = {
            id: KNOWLEDGE_BASE_ID,
            organization_id: ORGANIZATION_ID,
            name: 'Company Knowledge',
            document_count: 3
        };

        const database = createDatabase([
            {
                rowCount: 1,
                rows: [expected]
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result = await service.getKnowledgeBase({
            organizationId: ORGANIZATION_ID,
            knowledgeBaseId: KNOWLEDGE_BASE_ID
        });

        assert.deepEqual(result, expected);

        assert.equal(database.calls.length, 1);

        assert.deepEqual(
            database.calls[0].params,
            [
                KNOWLEDGE_BASE_ID,
                ORGANIZATION_ID
            ]
        );

    }
);


test(
    'getKnowledgeBase returns null when Knowledge Base is not found',
    async () => {

        const database = createDatabase([
            {
                rowCount: 0,
                rows: []
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result = await service.getKnowledgeBase({
            organizationId: ORGANIZATION_ID,
            knowledgeBaseId: KNOWLEDGE_BASE_ID
        });

        assert.equal(result, null);

    }
);


// =====================================================
// DOCUMENT LISTING
// =====================================================

test(
    'listKnowledgeBaseDocuments verifies ownership before listing',
    async () => {

        const documents = [
            {
                id: 'document-1',
                file_name: 'manual.pdf',
                status: 'completed',
                chunk_count: 5
            }
        ];

        const database = createDatabase([

            {
                rowCount: 1,
                rows: [{ id: KNOWLEDGE_BASE_ID }]
            },

            {
                rowCount: 1,
                rows: documents
            }

        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result =
            await service.listKnowledgeBaseDocuments({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID
            });

        assert.deepEqual(result, documents);

        assert.equal(database.calls.length, 2);

    }
);


test(
    'listKnowledgeBaseDocuments returns null for another tenant',
    async () => {

        const database = createDatabase([
            {
                rowCount: 0,
                rows: []
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result =
            await service.listKnowledgeBaseDocuments({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID
            });

        assert.equal(result, null);

        assert.equal(database.calls.length, 1);

    }
);


// =====================================================
// RETRIEVAL CONFIGURATION
// =====================================================

test(
    'updateRetrievalConfig updates valid configuration',
    async () => {

        const expected = {
            id: KNOWLEDGE_BASE_ID,
            retrieval_config: {
                top_k: 5,
                score_threshold: 0.2
            }
        };

        const database = createDatabase([
            {
                rowCount: 1,
                rows: [expected]
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result =
            await service.updateRetrievalConfig({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                config: {
                    top_k: 5,
                    score_threshold: 0.2
                }
            });

        assert.deepEqual(result, expected);

        assert.equal(
            database.calls[0].params[2],
            JSON.stringify({
                top_k: 5,
                score_threshold: 0.2
            })
        );

    }
);


test(
    'updateRetrievalConfig rejects invalid top_k',
    async () => {

        const database = createDatabase();

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        await assert.rejects(
            () => service.updateRetrievalConfig({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                config: {
                    top_k: 20
                }
            }),
            /top_k must be an integer/
        );

        assert.equal(database.calls.length, 0);

    }
);


test(
    'updateRetrievalConfig rejects unknown settings',
    async () => {

        const database = createDatabase();

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        await assert.rejects(
            () => service.updateRetrievalConfig({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                config: {
                    dangerous_setting: true
                }
            }),
            /Unsupported retrieval setting/
        );

    }
);


// =====================================================
// STATUS MANAGEMENT
// =====================================================

test(
    'updateKnowledgeBaseStatus supports deactivation',
    async () => {

        const expected = {
            id: KNOWLEDGE_BASE_ID,
            status: 'inactive'
        };

        const database = createDatabase([
            {
                rowCount: 1,
                rows: [expected]
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result =
            await service.updateKnowledgeBaseStatus({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                status: 'inactive'
            });

        assert.deepEqual(result, expected);

    }
);


test(
    'updateKnowledgeBaseStatus rejects unsupported states',
    async () => {

        const database = createDatabase();

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        await assert.rejects(
            () => service.updateKnowledgeBaseStatus({
                organizationId: ORGANIZATION_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                status: 'deleted'
            }),
            /Status must be either active or inactive/
        );

        assert.equal(database.calls.length, 0);

    }
);


// =====================================================
// DELETE KNOWLEDGE BASE
// =====================================================

test(
    'deleteKnowledgeBase deletes only within the specified tenant',
    async () => {

        const database = createDatabase([
            {
                rowCount: 1,
                rows: [{
                    id: KNOWLEDGE_BASE_ID
                }]
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result = await service.deleteKnowledgeBase({
            organizationId: ORGANIZATION_ID,
            knowledgeBaseId: KNOWLEDGE_BASE_ID
        });

        assert.equal(result, true);

        assert.deepEqual(
            database.calls[0].params,
            [
                KNOWLEDGE_BASE_ID,
                ORGANIZATION_ID
            ]
        );

    }
);


test(
    'deleteKnowledgeBase returns false when no tenant-owned record exists',
    async () => {

        const database = createDatabase([
            {
                rowCount: 0,
                rows: []
            }
        ]);

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        const result = await service.deleteKnowledgeBase({
            organizationId: ORGANIZATION_ID,
            knowledgeBaseId: KNOWLEDGE_BASE_ID
        });

        assert.equal(result, false);

    }
);


// =====================================================
// INPUT VALIDATION
// =====================================================

test(
    'management operations reject invalid UUIDs',
    async () => {

        const database = createDatabase();

        const service =
            createKnowledgeBaseManagementService({
                database
            });

        await assert.rejects(
            () => service.getKnowledgeBase({
                organizationId: 'invalid',
                knowledgeBaseId: KNOWLEDGE_BASE_ID
            }),
            /Invalid organization ID/
        );

        assert.equal(database.calls.length, 0);

    }
);