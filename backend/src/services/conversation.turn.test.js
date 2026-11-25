import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../config/database.js';

import {
    saveConversationTurn,
    getConversationHistory
} from './conversation.service.js';

const IDS = {
    conversation: '33333333-3333-4333-8333-333333333333',
    organization: '11111111-1111-4111-8111-111111111111',
    chatbot: '22222222-2222-4222-8222-222222222222',
    request: '55555555-5555-4555-8555-555555555555'
};

const customerRecord = {
    id: '66666666-6666-4666-8666-666666666666',
    conversation_id: IDS.conversation,
    idempotency_key: IDS.request,
    sender_type: 'customer',
    content: 'Hello!',
    created_at: new Date('2026-01-01T10:00:00Z')
};

const botRecord = {
    id: '77777777-7777-4777-8777-777777777777',
    conversation_id: IDS.conversation,
    idempotency_key: IDS.request,
    sender_type: 'bot',
    content: 'Hello! How can I help?',
    created_at: new Date('2026-01-01T10:00:01Z')
};

const createClient = (handler) => {
    const queries = [];

    return {
        queries,

        async query(sql, params) {
            queries.push({ sql, params });
            return handler(sql, params, queries.length);
        },

        release() {
            this.released = true;
        }
    };
};

const turnInput = {
    conversationId: IDS.conversation,
    organizationId: IDS.organization,
    chatbotId: IDS.chatbot,
    idempotencyKey: IDS.request,
    customerMessage: 'Hello!',
    botResponse: 'Hello! How can I help?'
};

describe('Conversation Turn Persistence', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('persists customer and bot messages in one transaction', async () => {
        const client = createClient((sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT') {
                return { rows: [], rowCount: null };
            }

            if (sql.includes('SELECT id') && sql.includes('FOR UPDATE')) {
                return {
                    rows: [{ id: IDS.conversation }],
                    rowCount: 1
                };
            }

            if (sql.includes("VALUES ($1, $2, 'customer', $3)")) {
                return { rows: [customerRecord], rowCount: 1 };
            }

            if (sql.includes("VALUES ($1, $2, 'bot', $3)")) {
                return { rows: [botRecord], rowCount: 1 };
            }

            if (sql.includes('UPDATE public.conversations')) {
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected query: ${sql}`);
        });

        mock.method(pool, 'connect', async () => client);

        const result = await saveConversationTurn(turnInput);

        assert.deepEqual(result.customerMessage, customerRecord);
        assert.deepEqual(result.botMessage, botRecord);

        assert.equal(client.queries[0].sql, 'BEGIN');
        assert.equal(client.queries.at(-1).sql, 'COMMIT');

        assert.equal(
            client.queries.filter(({ sql }) =>
                sql.includes('INSERT INTO public.messages')
            ).length,
            2
        );

        assert.equal(client.released, true);
    });

    it('does not duplicate messages when the same idempotency key is retried', async () => {
        const client = createClient((sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT') {
                return { rows: [], rowCount: null };
            }

            if (sql.includes('FOR UPDATE')) {
                return {
                    rows: [{ id: IDS.conversation }],
                    rowCount: 1
                };
            }

            if (sql.includes("VALUES ($1, $2, 'customer', $3)")) {
                return { rows: [], rowCount: 0 };
            }

            if (
                sql.includes("sender_type = 'customer'")
            ) {
                return { rows: [customerRecord], rowCount: 1 };
            }

            if (sql.includes("VALUES ($1, $2, 'bot', $3)")) {
                return { rows: [], rowCount: 0 };
            }

            if (sql.includes("sender_type = 'bot'")) {
                return { rows: [botRecord], rowCount: 1 };
            }

            if (sql.includes('UPDATE public.conversations')) {
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected query: ${sql}`);
        });

        mock.method(pool, 'connect', async () => client);

        const result = await saveConversationTurn(turnInput);

        assert.deepEqual(result.customerMessage, customerRecord);
        assert.deepEqual(result.botMessage, botRecord);

        assert.equal(
            client.queries.filter(({ sql }) =>
                sql.includes('INSERT INTO public.messages')
            ).length,
            2
        );

        assert.equal(
            client.queries.filter(({ sql }) =>
                sql.includes('sender_type =')
            ).length,
            2
        );

        assert.equal(client.queries.at(-1).sql, 'COMMIT');
    });

    it('rejects a conversation belonging to another chatbot', async () => {
        const client = createClient((sql) => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') {
                return { rows: [], rowCount: null };
            }

            if (sql.includes('FOR UPDATE')) {
                return { rows: [], rowCount: 0 };
            }

            throw new Error(`Unexpected query: ${sql}`);
        });

        mock.method(pool, 'connect', async () => client);

        await assert.rejects(
            saveConversationTurn(turnInput),
            {
                message: 'Conversation not found or unavailable.'
            }
        );

        assert.equal(client.queries.at(-1).sql, 'ROLLBACK');

        assert.equal(
            client.queries.some(({ sql }) =>
                sql.includes('INSERT INTO public.messages')
            ),
            false
        );

        assert.equal(client.released, true);
    });

    it('rolls back the complete turn when bot message persistence fails', async () => {
        const client = createClient((sql) => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') {
                return { rows: [], rowCount: null };
            }

            if (sql.includes('FOR UPDATE')) {
                return {
                    rows: [{ id: IDS.conversation }],
                    rowCount: 1
                };
            }

            if (sql.includes("VALUES ($1, $2, 'customer', $3)")) {
                return { rows: [customerRecord], rowCount: 1 };
            }

            if (sql.includes("VALUES ($1, $2, 'bot', $3)")) {
                throw new Error('Bot message insert failed');
            }

            throw new Error(`Unexpected query: ${sql}`);
        });

        mock.method(pool, 'connect', async () => client);

        await assert.rejects(
            saveConversationTurn(turnInput),
            {
                message: 'Bot message insert failed'
            }
        );

        assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
        assert.equal(client.released, true);
    });

    it('rejects an invalid idempotency key before opening a transaction', async () => {
        let connectionRequested = false;

        mock.method(pool, 'connect', async () => {
            connectionRequested = true;
            throw new Error('Connection should not be requested');
        });

        await assert.rejects(
            saveConversationTurn({
                ...turnInput,
                idempotencyKey: 'invalid-key'
            }),
            {
                message: 'A valid idempotency key is required.'
            }
        );

        assert.equal(connectionRequested, false);
    });
});

describe('Trusted Conversation History', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('returns conversation messages in chronological order', async () => {
        const newestFirst = [
            {
                id: 'message-2',
                sender_type: 'bot',
                content: 'Hello!',
                created_at: new Date('2026-01-01T10:00:02Z')
            },
            {
                id: 'message-1',
                sender_type: 'customer',
                content: 'Hi!',
                created_at: new Date('2026-01-01T10:00:01Z')
            }
        ];

        mock.method(pool, 'query', async (sql, params) => {
            assert.match(sql, /INNER JOIN public\.conversations/);
            assert.match(sql, /c\.organization_id = \$2/);
            assert.match(sql, /c\.chatbot_id = \$3/);
            assert.equal(params[0], IDS.conversation);
            assert.equal(params[1], IDS.organization);
            assert.equal(params[2], IDS.chatbot);

            return {
                rows: newestFirst,
                rowCount: newestFirst.length
            };
        });

        const history = await getConversationHistory({
            conversationId: IDS.conversation,
            organizationId: IDS.organization,
            chatbotId: IDS.chatbot
        });

        assert.deepEqual(history, [
            {
                sender_type: 'customer',
                content: 'Hi!'
            },
            {
                sender_type: 'bot',
                content: 'Hello!'
            }
        ]);
    });

    it('caps the requested history limit at 100 messages', async () => {
        mock.method(pool, 'query', async (sql, params) => {
            assert.equal(params[3], 100);
            return { rows: [], rowCount: 0 };
        });

        const history = await getConversationHistory({
            conversationId: IDS.conversation,
            organizationId: IDS.organization,
            chatbotId: IDS.chatbot,
            limit: 5000
        });

        assert.deepEqual(history, []);
    });
});