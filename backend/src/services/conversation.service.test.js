import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../config/database.js';

import {
    getConversation,
    createConversation,
    saveMessage
} from './conversation.service.js';


describe('Conversation Service', () => {

    afterEach(() => {
        mock.restoreAll();
    });

    describe('getConversation()', () => {
        it('should return null when conversation ownership does not match', async () => {
    mock.method(pool, 'query', async () => ({
        rows: []
    }));

    const result = await getConversation({
        conversationId: 'conversation-123',
        organizationId: 'wrong-org',
        chatbotId: 'chatbot-123'
    });

    assert.equal(result, null);
});

        it('should return a conversation when ownership matches', async () => {

            const mockConversation = {
                id: 'conversation-123',
                organization_id: 'org-123',
                chatbot_id: 'chatbot-123',
                status: 'active'
            };

            mock.method(pool, 'query', async () => ({
                rows: [mockConversation]
            }));

            const result = await getConversation({
                conversationId: 'conversation-123',
                organizationId: 'org-123',
                chatbotId: 'chatbot-123'
            });

            assert.deepEqual(result, mockConversation);
        });

    });

    describe('createConversation()', () => {

    it('should create and return a new conversation', async () => {

        const mockConversation = {
            id: 'new-conversation-123',
            organization_id: 'org-123',
            chatbot_id: 'chatbot-123',
            channel_id: null,
            customer_identifier: 'customer-123',
            status: 'active'
        };

        mock.method(pool, 'query', async () => ({
            rows: [mockConversation]
        }));

        const result = await createConversation({
            organizationId: 'org-123',
            chatbotId: 'chatbot-123',
            customerIdentifier: 'customer-123'
        });

        assert.deepEqual(result, mockConversation);
    });

});
    describe('saveMessage()', () => {

        it('should reject an unassigned agent from saving a message', async () => {

    const queryResponses = [
        { rows: [], rowCount: null }, // BEGIN

        {
            rows: [{
                id: 'conversation-123',
                assigned_agent_id: 'agent-456'
            }],
            rowCount: 1
        }, // Conversation validation

        {
            rows: [],
            rowCount: 0
        }, // Agent assignment validation fails

        { rows: [], rowCount: null } // ROLLBACK
    ];

    const executedQueries = [];

    const mockClient = {
        query: async (sql) => {
            executedQueries.push(sql);

            const response = queryResponses.shift();

            if (!response) {
                throw new Error('Unexpected database query');
            }

            return response;
        },

        release: () => {}
    };

    mock.method(pool, 'connect', async () => mockClient);

    await assert.rejects(
        saveMessage({
            conversationId: 'conversation-123',
            organizationId: 'org-123',
            chatbotId: 'chatbot-123',
            senderType: 'agent',
            senderMemberId: 'member-123',
            content: 'I need to help this customer.'
        }),
        {
            message: 'Agent is not authorized for this conversation.'
        }
    );

    assert.equal(queryResponses.length, 0);

    assert.equal(
        executedQueries.at(-1),
        'ROLLBACK'
    );

    assert.equal(
        executedQueries.some(sql =>
            sql.includes('INSERT INTO public.messages')
        ),
        false
    );
});


        it('should allow an assigned agent to save a message', async () => {

    const mockMessage = {
        id: 'message-agent-123',
        conversation_id: 'conversation-123',
        session_id: null,
        sender_member_id: 'member-123',
        sender_type: 'agent',
        content: 'How can I help you?',
        created_at: new Date()
    };

    const queryResponses = [
        { rows: [], rowCount: null }, // BEGIN

        {
            rows: [{ id: 'conversation-123', assigned_agent_id: 'agent-123' }],
            rowCount: 1
        }, // Conversation validation

        {
            rows: [{ id: 'agent-123' }],
            rowCount: 1
        }, // Agent assignment validation

        {
            rows: [mockMessage],
            rowCount: 1
        }, // INSERT message

        { rows: [], rowCount: 1 }, // UPDATE conversation

        { rows: [], rowCount: null } // COMMIT
    ];

    const mockClient = {
        query: async () => {
            const response = queryResponses.shift();

            if (!response) {
                throw new Error('Unexpected database query');
            }

            return response;
        },

        release: () => {}
    };

    mock.method(pool, 'connect', async () => mockClient);

    const result = await saveMessage({
        conversationId: 'conversation-123',
        organizationId: 'org-123',
        chatbotId: 'chatbot-123',
        senderType: 'agent',
        senderMemberId: 'member-123',
        content: 'How can I help you?'
    });

    assert.deepEqual(result, mockMessage);
    assert.equal(queryResponses.length, 0);
});



        it('should reject an expired conversation session', async () => {

    const queryResponses = [
        { rows: [], rowCount: null }, // BEGIN

        {
            rows: [{ id: 'conversation-123' }],
            rowCount: 1
        }, // Conversation validation

        {
            rows: [],
            rowCount: 0
        }, // Expired session: no valid session returned

        { rows: [], rowCount: null } // ROLLBACK
    ];

    const executedQueries = [];

    const mockClient = {
        query: async (sql) => {
            executedQueries.push(sql);

            const response = queryResponses.shift();

            if (!response) {
                throw new Error('Unexpected database query');
            }

            return response;
        },

        release: () => {}
    };

    mock.method(pool, 'connect', async () => mockClient);

    await assert.rejects(
        saveMessage({
            conversationId: 'conversation-123',
            organizationId: 'org-123',
            chatbotId: 'chatbot-123',
            senderType: 'customer',
            content: 'Hello!',
            sessionId: 'expired-session-123'
        }),
        {
            message: 'Invalid or expired conversation session.'
        }
    );

    assert.equal(queryResponses.length, 0);

    assert.equal(
        executedQueries.at(-1),
        'ROLLBACK'
    );
});

        it('should reject a session belonging to another conversation', async () => {

    const queryResponses = [
        { rows: [], rowCount: null }, // BEGIN

        { 
            rows: [{ id: 'conversation-123' }],
            rowCount: 1
        }, // Conversation validation

        {
            rows: [],
            rowCount: 0
        }, // Session validation fails

        { rows: [], rowCount: null } // ROLLBACK
    ];

    const executedQueries = [];

    const mockClient = {
        query: async (sql) => {
            executedQueries.push(sql);

            const response = queryResponses.shift();

            if (!response) {
                throw new Error('Unexpected database query');
            }

            return response;
        },

        release: () => {}
    };

    mock.method(pool, 'connect', async () => mockClient);

    await assert.rejects(
        saveMessage({
            conversationId: 'conversation-123',
            organizationId: 'org-123',
            chatbotId: 'chatbot-123',
            senderType: 'customer',
            content: 'Hello!',
            sessionId: 'session-from-another-conversation'
        }),
        {
            message: 'Invalid or expired conversation session.'
        }
    );

    assert.equal(queryResponses.length, 0);

    assert.equal(
        executedQueries.at(-1),
        'ROLLBACK'
    );
});

    it('should save a valid customer message', async () => {

        const mockMessage = {
            id: 'message-123',
            conversation_id: 'conversation-123',
            session_id: null,
            sender_member_id: null,
            sender_type: 'customer',
            content: 'Hello!',
            created_at: new Date()
        };

        const queryResponses = [
            { rows: [], rowCount: null }, 
            { rows: [{ id: 'conversation-123' }], rowCount: 1 },
            { rows: [mockMessage], rowCount: 1 },
            { rows: [], rowCount: 1 },
            { rows: [], rowCount: null }
        ];

        const mockClient = {
            query: async () => {
                const response = queryResponses.shift();

                if (!response) {
                    throw new Error('Unexpected database query');
                }

                return response;
            },

            release: () => {}
        };

        mock.method(pool, 'connect', async () => mockClient);

        const result = await saveMessage({
            conversationId: 'conversation-123',
            organizationId: 'org-123',
            chatbotId: 'chatbot-123',
            senderType: 'customer',
            content: 'Hello!'
        });

        assert.deepEqual(result, mockMessage);

        assert.equal(queryResponses.length, 0);
    });

});

});