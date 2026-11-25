import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    createSendAgentMessageController
} from './conversation.controller.js';


const ORGANIZATION_ID =
    '11111111-1111-4111-8111-111111111111';

const CHATBOT_ID =
    '22222222-2222-4222-8222-222222222222';

const CONVERSATION_ID =
    '33333333-3333-4333-8333-333333333333';

const MEMBER_ID =
    '44444444-4444-4444-8444-444444444444';


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


const createRequest = (overrides = {}) => ({
    params: {
        chatbotId: CHATBOT_ID,
        conversationId: CONVERSATION_ID
    },

    body: {
        content: 'Hello! How can I help you?'
    },

    organization: {
        id: ORGANIZATION_ID,
        memberId: MEMBER_ID,
        role: 'support_agent'
    },

    ...overrides
});


describe('sendAgentMessageController', () => {

    it('should reject an invalid conversation ID', async () => {

        let databaseCalled = false;

        const controller = createSendAgentMessageController({
            getConversationFn: async () => {
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

        await controller(req, res, () => {});

        assert.equal(res.statusCode, 400);
        assert.equal(databaseCalled, false);
    });


    it('should reject empty message content', async () => {

        let databaseCalled = false;

        const controller = createSendAgentMessageController({
            getConversationFn: async () => {
                databaseCalled = true;
            }
        });

        const req = createRequest({
            body: {
                content: '   '
            }
        });

        const res = createResponse();

        await controller(req, res, () => {});

        assert.equal(res.statusCode, 400);
        assert.equal(databaseCalled, false);
    });


    it('should reject requests without authenticated member identity', async () => {

        const controller = createSendAgentMessageController();

        const req = createRequest({
            organization: {
                id: ORGANIZATION_ID,
                memberId: null,
                role: 'support_agent'
            }
        });

        const res = createResponse();

        await controller(req, res, () => {});

        assert.equal(res.statusCode, 403);
    });


    it('should return 404 when conversation does not exist', async () => {

        const controller = createSendAgentMessageController({
            getConversationFn: async () => null
        });

        const req = createRequest();
        const res = createResponse();

        await controller(req, res, () => {});

        assert.equal(res.statusCode, 404);
    });


    it('should use authenticated identity instead of client-supplied identity', async () => {

        let savedMessage;

        const controller = createSendAgentMessageController({

            getConversationFn: async () => ({
                id: CONVERSATION_ID,
                chatbot_id: CHATBOT_ID
            }),

            saveMessageFn: async (data) => {
                savedMessage = data;

                return {
                    id: '55555555-5555-4555-8555-555555555555',
                    ...data
                };
            }
        });

        const req = createRequest({
            body: {
                content: 'Hello!',
                senderMemberId: '99999999-9999-4999-8999-999999999999',
                senderType: 'admin'
            }
        });

        const res = createResponse();

        await controller(req, res, () => {});

        assert.equal(res.statusCode, 201);

        assert.equal(
            savedMessage.senderMemberId,
            MEMBER_ID
        );

        assert.equal(
            savedMessage.senderType,
            'agent'
        );

        assert.equal(
            savedMessage.organizationId,
            ORGANIZATION_ID
        );

        assert.equal(
            savedMessage.conversationId,
            CONVERSATION_ID
        );

        assert.equal(savedMessage.content, 'Hello!');
    });


    it('should forward unexpected errors to next middleware', async () => {

        const expectedError = new Error('Database unavailable');

        const controller = createSendAgentMessageController({
            getConversationFn: async () => {
                throw expectedError;
            }
        });

        const req = createRequest();
        const res = createResponse();

        let forwardedError;

        await controller(req, res, (error) => {
            forwardedError = error;
        });

        assert.equal(forwardedError, expectedError);
    });

});