import {
    describe,
    it
} from 'node:test';

import assert from 'node:assert/strict';

import {
    createRequireChatbotTenantAccess,
    createRequireAssignedConversationAccess
} from './resource-authorization.middleware.js';


const ORGANIZATION_ID =
    '11111111-1111-4111-8111-111111111111';

const OTHER_ORGANIZATION_ID =
    '99999999-9999-4999-8999-999999999999';

const CHATBOT_ID =
    '22222222-2222-4222-8222-222222222222';

const CONVERSATION_ID =
    '33333333-3333-4333-8333-333333333333';

const MEMBER_ID =
    '44444444-4444-4444-8444-444444444444';


const createRequest = (overrides = {}) => ({
    params: {
        chatbotId: CHATBOT_ID,
        conversationId: CONVERSATION_ID
    },

    body: {
        chatbot_id: CHATBOT_ID
    },

    organization: {
        id: ORGANIZATION_ID,
        memberId: MEMBER_ID,
        role: 'support_agent'
    },

    ...overrides
});


const createResponse = () => {

    const res = {
        statusCode: null,
        body: null,

        status(code) {
            this.statusCode = code;
            return this;
        },

        json(data) {
            this.body = data;
            return this;
        }
    };

    return res;

};


describe('Chatbot Tenant Authorization', () => {

    it('allows access to a chatbot belonging to the active organization', async () => {

        const chatbot = {
            id: CHATBOT_ID,
            organization_id: ORGANIZATION_ID,
            status: 'active'
        };

        const middleware =
            createRequireChatbotTenantAccess({
                queryFn: async () => ({
                    rows: [chatbot],
                    rowCount: 1
                })
            });

        const req = createRequest();
        const res = createResponse();

        let nextCalled = false;

        await middleware(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
        assert.equal(req.chatbot.id, CHATBOT_ID);
    });


    it('rejects a chatbot belonging to another organization', async () => {

        const middleware =
            createRequireChatbotTenantAccess({
                queryFn: async () => ({
                    rows: [],
                    rowCount: 0
                })
            });

        const req = createRequest();
        const res = createResponse();

        let nextCalled = false;

        await middleware(req, res, () => {
            nextCalled = true;
        });

        assert.equal(res.statusCode, 404);
        assert.equal(nextCalled, false);
    });


    it('rejects an invalid chatbot ID', async () => {

    let databaseCalled = false;

    const middleware =
        createRequireChatbotTenantAccess({
            queryFn: async () => {
                databaseCalled = true;
            }
        });

    const req = createRequest({
        params: {
            chatbotId: 'invalid'
        }
    });

    const res = createResponse();

    await middleware(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(databaseCalled, false);
});


    it('rejects requests without organization context', async () => {

        let databaseCalled = false;

        const middleware =
            createRequireChatbotTenantAccess({
                queryFn: async () => {
                    databaseCalled = true;
                }
            });

        const req = createRequest({
            organization: null
        });

        const res = createResponse();

        await middleware(req, res, () => {});

        assert.equal(res.statusCode, 500);
        assert.equal(databaseCalled, false);
    });


    it('uses trusted organization context rather than client-supplied organization ID', async () => {

        let queryParams;

        const middleware =
            createRequireChatbotTenantAccess({
                queryFn: async (sql, params) => {

                    queryParams = params;

                    return {
                        rows: [{
                            id: CHATBOT_ID,
                            organization_id: ORGANIZATION_ID
                        }],
                        rowCount: 1
                    };

                }
            });

        const req = createRequest({
            body: {
                chatbot_id: CHATBOT_ID,
                organization_id: OTHER_ORGANIZATION_ID
            }
        });

        const res = createResponse();

        await middleware(req, res, () => {});

        assert.equal(queryParams[1], ORGANIZATION_ID);
    });


    it('forwards unexpected database errors', async () => {

        const expectedError =
            new Error('Database unavailable');

        const middleware =
            createRequireChatbotTenantAccess({
                queryFn: async () => {
                    throw expectedError;
                }
            });

        const req = createRequest();
        const res = createResponse();

        let forwardedError;

        await middleware(req, res, (error) => {
            forwardedError = error;
        });

        assert.equal(forwardedError, expectedError);
    });

});


describe('Assigned Conversation Authorization', () => {

    it('allows an assigned active support agent', async () => {

        const conversation = {
            id: CONVERSATION_ID,
            chatbot_id: CHATBOT_ID,
            organization_id: ORGANIZATION_ID,
            assigned_agent_id: 'agent-123',
            status: 'active'
        };

        const middleware =
            createRequireAssignedConversationAccess({
                queryFn: async () => ({
                    rows: [conversation],
                    rowCount: 1
                })
            });

        const req = createRequest();
        const res = createResponse();

        let nextCalled = false;

        await middleware(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
        assert.equal(req.conversation.id, CONVERSATION_ID);
    });


    it('rejects an unassigned support agent', async () => {

        const middleware =
            createRequireAssignedConversationAccess({
                queryFn: async () => ({
                    rows: [],
                    rowCount: 0
                })
            });

        const req = createRequest();
        const res = createResponse();

        let nextCalled = false;

        await middleware(req, res, () => {
            nextCalled = true;
        });

        assert.equal(res.statusCode, 404);
        assert.equal(nextCalled, false);
    });


    it('rejects requests without authenticated member identity', async () => {

        let databaseCalled = false;

        const middleware =
            createRequireAssignedConversationAccess({
                queryFn: async () => {
                    databaseCalled = true;
                }
            });

        const req = createRequest({
            organization: {
                id: ORGANIZATION_ID,
                memberId: null,
                role: 'support_agent'
            }
        });

        const res = createResponse();

        await middleware(req, res, () => {});

        assert.equal(res.statusCode, 403);
        assert.equal(databaseCalled, false);
    });


    it('rejects invalid conversation IDs', async () => {

        let databaseCalled = false;

        const middleware =
            createRequireAssignedConversationAccess({
                queryFn: async () => {
                    databaseCalled = true;
                }
            });

        const req = createRequest({
            params: {
                chatbotId: CHATBOT_ID,
                conversationId: 'invalid-id'
            }
        });

        const res = createResponse();

        await middleware(req, res, () => {});

        assert.equal(res.statusCode, 400);
        assert.equal(databaseCalled, false);
    });


    it('uses authenticated organization and member IDs in the database query', async () => {

        let queryParams;

        const middleware =
            createRequireAssignedConversationAccess({
                queryFn: async (sql, params) => {

                    queryParams = params;

                    return {
                        rows: [{
                            id: CONVERSATION_ID,
                            chatbot_id: CHATBOT_ID,
                            organization_id: ORGANIZATION_ID
                        }],
                        rowCount: 1
                    };

                }
            });

        const req = createRequest({
            body: {
                organization_id: OTHER_ORGANIZATION_ID,
                member_id: 'untrusted-member'
            }
        });

        const res = createResponse();

        await middleware(req, res, () => {});

        assert.deepEqual(queryParams, [
            CONVERSATION_ID,
            CHATBOT_ID,
            ORGANIZATION_ID,
            MEMBER_ID
        ]);
    });


    it('forwards unexpected database errors', async () => {

        const expectedError =
            new Error('Database unavailable');

        const middleware =
            createRequireAssignedConversationAccess({
                queryFn: async () => {
                    throw expectedError;
                }
            });

        const req = createRequest();
        const res = createResponse();

        let forwardedError;

        await middleware(req, res, (error) => {
            forwardedError = error;
        });

        assert.equal(forwardedError, expectedError);
    });

});