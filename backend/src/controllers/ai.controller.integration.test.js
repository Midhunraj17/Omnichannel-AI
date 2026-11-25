import express from 'express';

import {
    describe,
    it
} from 'node:test';

import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';

import {
    createAuthenticateUser
} from '../middleware/auth.middleware.js';

import {
    createRequireOrganization
} from '../middleware/organization.middleware.js';

import {
    createRequireChatbotTenantAccess
} from '../middleware/resource-authorization.middleware.js';

import {
    createChatController
} from './ai.controller.js';

import {
    createAiRouter
} from '../routes/ai.routes.js';


const IDS = {

    user: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',

    organization: '11111111-1111-4111-8111-111111111111',

    otherOrganization: '99999999-9999-4999-8999-999999999999',

    member: '44444444-4444-4444-8444-444444444444',

    chatbot: '22222222-2222-4222-8222-222222222222',

    otherChatbot: '88888888-8888-4888-8888-888888888888'

};


const createHarness = async () => {

    const state = {

        conversations: new Map(),

        histories: new Map(),

        savedTurns: new Map(),

        idempotency: new Map(),

        aiCalls: [],

        releasedReservations: 0,

        failGeneration: false

    };


    // -------------------------------------------------
    // AUTHENTICATION
    // -------------------------------------------------

    const authClient = {

        auth: {

            getUser: async (token) => {

                if (token === 'valid-test-token') {

                    return {

                        data: {

                            user: {
                                id: IDS.user
                            }

                        },

                        error: null

                    };

                }


                return {

                    data: {
                        user: null
                    },

                    error: new Error('Invalid token')

                };

            }

        }

    };


    const authenticateUserMiddleware =
        createAuthenticateUser(authClient);


    // -------------------------------------------------
    // ORGANIZATION MEMBERSHIP
    // -------------------------------------------------

    const requireOrganizationMiddleware =
        createRequireOrganization(
            async (userId, organizationId) => {

                if (
                    userId !== IDS.user ||
                    organizationId !== IDS.organization
                ) {
                    return null;
                }

                return {

                    id: IDS.member,

                    organization_id: IDS.organization,

                    user_id: IDS.user,

                    role: 'owner',

                    status: 'active'

                };

            }
        );


    // -------------------------------------------------
    // CHATBOT TENANT AUTHORIZATION
    // -------------------------------------------------

    const requireChatbotTenantAccessMiddleware =
        createRequireChatbotTenantAccess({

            queryFn: async (sql, params) => {

                const [chatbotId, organizationId] = params;

                if (
                    chatbotId === IDS.chatbot &&
                    organizationId === IDS.organization
                ) {

                    return {

                        rows: [{

                            id: IDS.chatbot,

                            organization_id: IDS.organization,

                            status: 'active'

                        }],

                        rowCount: 1

                    };

                }


                return {

                    rows: [],

                    rowCount: 0

                };

            }

        });


    // -------------------------------------------------
    // CHATBOT LOOKUP
    // -------------------------------------------------

    const findChatbotFn = async ({
        chatbotId,
        organizationId
    }) => {

        if (
            chatbotId === IDS.chatbot &&
            organizationId === IDS.organization
        ) {

            return {

                id: IDS.chatbot,

                organization_id: IDS.organization

            };

        }

        return null;

    };


    // -------------------------------------------------
    // CONVERSATION SERVICES
    // -------------------------------------------------

    const createConversationFn = async ({
        organizationId,
        chatbotId
    }) => {

        const id = randomUUID();

        const conversation = {

            id,

            organization_id: organizationId,

            chatbot_id: chatbotId,

            status: 'active'

        };

        state.conversations.set(id, conversation);

        state.histories.set(id, []);

        return conversation;

    };


    const getConversationFn = async ({
        conversationId,
        organizationId,
        chatbotId
    }) => {

        const conversation =
            state.conversations.get(conversationId);

        if (
            !conversation ||
            conversation.organization_id !== organizationId ||
            conversation.chatbot_id !== chatbotId
        ) {
            return null;
        }

        return conversation;

    };


    const getConversationHistoryFn = async ({
        conversationId,
        organizationId,
        chatbotId
    }) => {

        const conversation =
            state.conversations.get(conversationId);

        if (
            !conversation ||
            conversation.organization_id !== organizationId ||
            conversation.chatbot_id !== chatbotId
        ) {
            return [];
        }

        return structuredClone(
            state.histories.get(conversationId) ?? []
        );

    };


    const saveConversationTurnFn = async ({
        conversationId,
        idempotencyKey,
        customerMessage,
        botResponse
    }) => {

        const savedKey =
            `${conversationId}:${idempotencyKey}`;

        if (state.savedTurns.has(savedKey)) {

            return state.savedTurns.get(savedKey);

        }


        const customerRecord = {

            sender_type: 'customer',

            content: customerMessage

        };


        const botRecord = botResponse
            ? {

                sender_type: 'bot',

                content: botResponse

            }
            : null;


        const history =
            state.histories.get(conversationId);


        history.push(customerRecord);


        if (botRecord) {
            history.push(botRecord);
        }


        const result = {

            customerMessage: customerRecord,

            botMessage: botRecord

        };


        state.savedTurns.set(savedKey, result);

        return result;

    };


    // -------------------------------------------------
    // AI SERVICE
    // -------------------------------------------------

    const generateAIResponseFn = async (input) => {

        state.aiCalls.push(
            structuredClone(input)
        );


        if (state.failGeneration) {

            throw new Error(
                'AI service unavailable'
            );

        }


        const response = input.history.length > 0

            ? `I received ${input.history.length} previous messages.`

            : `Received: ${input.message}`;


        return {

            success: true,

            status: 'response_generated',

            destination: 'GENERAL_AI',

            response,

            model: 'test-model',

            usage: null

        };

    };


    // -------------------------------------------------
    // IDEMPOTENCY
    // -------------------------------------------------

    const reserveRequestFn = async ({
        idempotencyKey,
        requestHash
    }) => {

        const existing =
            state.idempotency.get(idempotencyKey);


        if (existing) {

            if (existing.requestHash !== requestHash) {

                return {
                    state: 'conflict'
                };

            }


            if (existing.state === 'completed') {

                return {

                    state: 'completed',

                    responseBody: existing.responseBody,

                    responseStatus: existing.responseStatus

                };

            }


            return {
                state: 'processing'
            };

        }


        const reservation = {

            id: randomUUID(),

            reservationToken: randomUUID(),

            requestHash,

            state: 'processing'

        };


        state.idempotency.set(
            idempotencyKey,
            reservation
        );


        return {

            state: 'reserved',

            id: reservation.id,

            reservationToken: reservation.reservationToken

        };

    };


    const completeRequestFn = async ({
        reservationId,
        reservationToken,
        responseBody,
        responseStatus
    }) => {

        const reservation = [
            ...state.idempotency.values()
        ].find(
            item =>
                item.id === reservationId &&
                item.reservationToken === reservationToken
        );


        if (!reservation) {

            throw new Error(
                'Reservation ownership lost.'
            );

        }


        reservation.state = 'completed';

        reservation.responseBody = responseBody;

        reservation.responseStatus = responseStatus;

    };


    const releaseRequestFn = async ({
        reservationId,
        reservationToken
    }) => {

        for (const [key, reservation] of state.idempotency) {

            if (
                reservation.id === reservationId &&
                reservation.reservationToken === reservationToken &&
                reservation.state === 'processing'
            ) {

                state.idempotency.delete(key);

                state.releasedReservations++;

                return {
                    released: true
                };

            }

        }


        return {
            released: false
        };

    };


    // -------------------------------------------------
    // CONTROLLER
    // -------------------------------------------------

    const controller = createChatController({

        findChatbotFn,

        getChatbotSettingsFn: async () => ({

            settings: {

                domain: 'general',

                required_entities: []

            }

        }),

        getConversationFn,

        createConversationFn,

        getConversationHistoryFn,

        saveConversationTurnFn,

        generateAIResponseFn,

        reserveRequestFn,

        completeRequestFn,

        releaseRequestFn,

        logAIUsageFn: async () => {},

        calculateCohereCostFn: () => ({

            inputCost: 0,

            outputCost: 0,

            currency: 'USD',

            pricingVersion: 'test'

        })

    });


    // -------------------------------------------------
    // EXPRESS ROUTER
    // -------------------------------------------------

    const router = createAiRouter({

        authenticateUserMiddleware,

        requireOrganizationMiddleware,

        requireChatbotTenantAccessMiddleware,

        chatControllerFn: controller

    });


    const app = express();

    app.use(express.json());

    app.use('/api/v1/ai', router);


    app.use((error, req, res, next) => {

        res.status(error.statusCode || 500).json({

            success: false,

            message: error.statusCode
                ? error.message
                : 'Internal Server Error'

        });

    });


    const server = app.listen(0);

    await new Promise((resolve, reject) => {

        server.once('listening', resolve);

        server.once('error', reject);

    });


    const address = server.address();

    const baseUrl =
        `http://127.0.0.1:${address.port}/api/v1/ai/chat`;


    const send = async ({
        body = {},
        key = randomUUID(),
        token = 'valid-test-token',
        organizationId = IDS.organization
    } = {}) => {

        const headers = {

            'Content-Type': 'application/json',

            'x-organization-id': organizationId,

            'Idempotency-Key': key

        };


        if (token) {

            headers.Authorization =
                `Bearer ${token}`;

        }


        return fetch(baseUrl, {

            method: 'POST',

            headers,

            body: JSON.stringify({

                chatbot_id: IDS.chatbot,

                message: 'Hello',

                ...body

            })

        });

    };


    return {

        state,

        send,

        close: () => new Promise(resolve => {
            server.close(resolve);
        })

    };

};


// =====================================================
// INTEGRATION TESTS
// =====================================================

describe('Complete Customer-to-AI Integration', () => {


    it('processes a customer message through the complete backend pipeline', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const response = await harness.send({

            body: {
                message: 'Hello Jarvis'
            }

        });


        const body = await response.json();


        assert.equal(response.status, 200);

        assert.equal(
            body.status,
            'response_generated'
        );

        assert.equal(
            body.response,
            'Received: Hello Jarvis'
        );

        assert.ok(body.conversation_id);


        assert.equal(
            harness.state.aiCalls.length,
            1
        );


        const history =
            harness.state.histories.get(body.conversation_id);


        assert.equal(history.length, 2);

        assert.equal(history[0].sender_type, 'customer');

        assert.equal(history[1].sender_type, 'bot');

    });


    it('preserves conversation context between customer messages', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const firstResponse = await harness.send({

            body: {
                message: 'My name is Midhun'
            }

        });


        const firstBody = await firstResponse.json();


        const secondResponse = await harness.send({

            key: randomUUID(),

            body: {

                message: 'Do you remember my previous message?',

                conversation_id: firstBody.conversation_id

            }

        });


        const secondBody = await secondResponse.json();


        assert.equal(secondResponse.status, 200);

        assert.equal(
            harness.state.aiCalls.length,
            2
        );


        const secondAIInput =
            harness.state.aiCalls[1];


        assert.equal(
            secondAIInput.history.length,
            2
        );


        assert.equal(
            secondAIInput.history[0].content,
            'My name is Midhun'
        );


        assert.equal(
            secondBody.response,
            'I received 2 previous messages.'
        );

    });


    it('returns cached responses for duplicate idempotency requests', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const key = randomUUID();

        const first = await harness.send({

            key,

            body: {
                message: 'Hello'
            }

        });


        const firstBody = await first.json();


        const second = await harness.send({

            key,

            body: {
                message: 'Hello'
            }

        });


        const secondBody = await second.json();


        assert.equal(first.status, 200);

        assert.equal(second.status, 200);

        assert.deepEqual(secondBody, firstBody);


        assert.equal(
            harness.state.aiCalls.length,
            1
        );


        assert.equal(
            harness.state.savedTurns.size,
            1
        );

    });


    it('rejects reuse of an idempotency key with different content', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const key = randomUUID();


        await harness.send({

            key,

            body: {
                message: 'Hello'
            }

        });


        const response = await harness.send({

            key,

            body: {
                message: 'Different message'
            }

        });


        assert.equal(response.status, 409);

        assert.equal(
            harness.state.aiCalls.length,
            1
        );

    });


    it('rejects unauthenticated requests', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const response = await harness.send({

            token: null

        });


        assert.equal(response.status, 401);

        assert.equal(
            harness.state.aiCalls.length,
            0
        );

    });


    it('rejects users who are not members of the requested organization', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const response = await harness.send({

            organizationId: IDS.otherOrganization

        });


        assert.equal(response.status, 403);

        assert.equal(
            harness.state.aiCalls.length,
            0
        );

    });


    it('rejects chatbots belonging to another tenant', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const response = await harness.send({

            body: {
                chatbot_id: IDS.otherChatbot
            }

        });


        assert.equal(response.status, 404);

        assert.equal(
            harness.state.aiCalls.length,
            0
        );

        assert.equal(
            harness.state.idempotency.size,
            0
        );

    });


    it('rejects invalid idempotency keys', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const response = await harness.send({

            key: 'invalid-key'

        });


        assert.equal(response.status, 400);

        assert.equal(
            harness.state.aiCalls.length,
            0
        );

    });


    it('does not persist messages when AI generation fails and permits retry', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const key = randomUUID();

        harness.state.failGeneration = true;


        const failedResponse = await harness.send({

            key,

            body: {
                message: 'Hello'
            }

        });


        assert.equal(failedResponse.status, 500);

        assert.equal(
            harness.state.savedTurns.size,
            0
        );

        assert.equal(
            harness.state.releasedReservations,
            1
        );


        harness.state.failGeneration = false;


        const retryResponse = await harness.send({

            key,

            body: {
                message: 'Hello'
            }

        });


        assert.equal(retryResponse.status, 200);

        assert.equal(
            harness.state.savedTurns.size,
            1
        );

    });


    it('releases reservations when a conversation does not belong to the chatbot', async (t) => {

        const harness = await createHarness();

        t.after(harness.close);


        const response = await harness.send({

            body: {

                message: 'Hello',

                conversation_id: randomUUID()

            }

        });


        assert.equal(response.status, 404);

        assert.equal(
            harness.state.releasedReservations,
            1
        );

        assert.equal(
            harness.state.aiCalls.length,
            0
        );

    });

});