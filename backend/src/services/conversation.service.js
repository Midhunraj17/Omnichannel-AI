import { pool } from '../config/database.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// GET CONVERSATION
// =====================================================

export const getConversation = async ({
    conversationId,
    organizationId,
    chatbotId
}) => {
    const result = await pool.query(
        `
            SELECT
                id,
                organization_id,
                chatbot_id,
                status,
                assigned_agent_id,
                customer_identifier,
                started_at,
                last_message_at,
                closed_at
            FROM public.conversations
            WHERE id = $1
              AND organization_id = $2
              AND chatbot_id = $3
            LIMIT 1;
        `,
        [conversationId, organizationId, chatbotId]
    );

    return result.rows[0] ?? null;
};


// =====================================================
// CREATE CONVERSATION
// =====================================================

export const createConversation = async ({
    organizationId,
    chatbotId,
    channelId = null,
    customerIdentifier = null
}) => {
    const result = await pool.query(
        `
            INSERT INTO public.conversations (
                organization_id,
                chatbot_id,
                channel_id,
                customer_identifier
            )
            VALUES ($1, $2, $3, $4)
            RETURNING
                id,
                organization_id,
                chatbot_id,
                channel_id,
                customer_identifier,
                status,
                started_at;
        `,
        [
            organizationId,
            chatbotId,
            channelId,
            customerIdentifier
        ]
    );

    return result.rows[0];
};


// =====================================================
// SAVE SINGLE MESSAGE
// =====================================================

export const saveMessage = async ({
    conversationId,
    organizationId,
    chatbotId,
    senderType,
    content,
    sessionId = null,
    senderMemberId = null
}) => {
    const allowedSenders = [
        'customer',
        'bot',
        'agent',
        'system'
    ];

    if (!allowedSenders.includes(senderType)) {
        throw new Error('Invalid message sender type.');
    }

    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Message content cannot be empty.');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const conversation = await client.query(
            `
                SELECT id, assigned_agent_id
                FROM public.conversations
                WHERE id = $1
                  AND organization_id = $2
                  AND chatbot_id = $3
                  AND status IN ('active', 'pending')
                FOR UPDATE;
            `,
            [conversationId, organizationId, chatbotId]
        );

        if (conversation.rowCount === 0) {
            throw new Error(
                'Conversation not found or unavailable.'
            );
        }

        if (sessionId) {
            const session = await client.query(
                `
                    SELECT id
                    FROM public.conversation_sessions
                    WHERE id = $1
                      AND conversation_id = $2
                      AND (
                          expires_at IS NULL
                          OR expires_at > NOW()
                      )
                    LIMIT 1;
                `,
                [sessionId, conversationId]
            );

            if (session.rowCount === 0) {
                throw new Error(
                    'Invalid or expired conversation session.'
                );
            }
        }

        if (senderType === 'agent') {
            if (!senderMemberId) {
                throw new Error(
                    'Agent sender identity is required.'
                );
            }

            const agent = await client.query(
                `
                    SELECT sa.id
                    FROM public.support_agents sa
                    INNER JOIN public.organization_members om
                        ON om.id = sa.organization_member_id
                    WHERE om.id = $1
                      AND om.organization_id = $2
                      AND om.status = 'active'
                      AND sa.id = $3
                    LIMIT 1;
                `,
                [
                    senderMemberId,
                    organizationId,
                    conversation.rows[0].assigned_agent_id
                ]
            );

            if (agent.rowCount === 0) {
                throw new Error(
                    'Agent is not authorized for this conversation.'
                );
            }
        } else if (senderMemberId !== null) {
            throw new Error(
                'Only agent messages can have a sender member ID.'
            );
        }

        const result = await client.query(
            `
                INSERT INTO public.messages (
                    conversation_id,
                    session_id,
                    sender_member_id,
                    sender_type,
                    content
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING
                    id,
                    conversation_id,
                    session_id,
                    sender_member_id,
                    sender_type,
                    content,
                    created_at;
            `,
            [
                conversationId,
                sessionId,
                senderMemberId,
                senderType,
                content.trim()
            ]
        );

        await client.query(
            `
                UPDATE public.conversations
                SET last_message_at = NOW()
                WHERE id = $1
                  AND organization_id = $2
                  AND chatbot_id = $3;
            `,
            [conversationId, organizationId, chatbotId]
        );

        await client.query('COMMIT');

        return result.rows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};


// =====================================================
// SAVE CONVERSATION TURN ATOMICALLY
// =====================================================

export const saveConversationTurn = async ({
    conversationId,
    organizationId,
    chatbotId,
    idempotencyKey,
    customerMessage,
    botResponse = null
}) => {
    if (!UUID_REGEX.test(idempotencyKey ?? '')) {
        throw new Error('A valid idempotency key is required.');
    }

    if (
        typeof customerMessage !== 'string' ||
        !customerMessage.trim()
    ) {
        throw new Error('Customer message cannot be empty.');
    }

    if (
        botResponse !== null &&
        (
            typeof botResponse !== 'string' ||
            !botResponse.trim()
        )
    ) {
        throw new Error('Invalid bot response.');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verify conversation ownership and lock the row.
        const conversation = await client.query(
            `
                SELECT id
                FROM public.conversations
                WHERE id = $1
                  AND organization_id = $2
                  AND chatbot_id = $3
                  AND status IN ('active', 'pending')
                FOR UPDATE;
            `,
            [
                conversationId,
                organizationId,
                chatbotId
            ]
        );

        if (conversation.rowCount === 0) {
            throw new Error(
                'Conversation not found or unavailable.'
            );
        }

        // Insert customer message.
        const customerInsert = await client.query(
            `
                INSERT INTO public.messages (
                    conversation_id,
                    idempotency_key,
                    sender_type,
                    content
                )
                VALUES ($1, $2, 'customer', $3)
                ON CONFLICT (
                    conversation_id,
                    idempotency_key,
                    sender_type
                )
                WHERE idempotency_key IS NOT NULL
                DO NOTHING
                RETURNING
                    id,
                    conversation_id,
                    idempotency_key,
                    sender_type,
                    content,
                    created_at;
            `,
            [
                conversationId,
                idempotencyKey,
                customerMessage.trim()
            ]
        );

        let customerRecord = customerInsert.rows[0];

        // Retrieve the existing message if this request
        // has already been persisted.
        if (!customerRecord) {
            const existingCustomer = await client.query(
                `
                    SELECT
                        id,
                        conversation_id,
                        idempotency_key,
                        sender_type,
                        content,
                        created_at
                    FROM public.messages
                    WHERE conversation_id = $1
                      AND idempotency_key = $2
                      AND sender_type = 'customer'
                    LIMIT 1;
                `,
                [conversationId, idempotencyKey]
            );

            if (existingCustomer.rowCount === 0) {
                throw new Error(
                    'Unable to retrieve persisted customer message.'
                );
            }

            customerRecord = existingCustomer.rows[0];
        }

        let botRecord = null;

        // Insert bot response when available.
        if (botResponse !== null) {
            const botInsert = await client.query(
                `
                    INSERT INTO public.messages (
                        conversation_id,
                        idempotency_key,
                        sender_type,
                        content
                    )
                    VALUES ($1, $2, 'bot', $3)
                    ON CONFLICT (
                        conversation_id,
                        idempotency_key,
                        sender_type
                    )
                    WHERE idempotency_key IS NOT NULL
                    DO NOTHING
                    RETURNING
                        id,
                        conversation_id,
                        idempotency_key,
                        sender_type,
                        content,
                        created_at;
                `,
                [
                    conversationId,
                    idempotencyKey,
                    botResponse.trim()
                ]
            );

            botRecord = botInsert.rows[0] ?? null;

            if (!botRecord) {
                const existingBot = await client.query(
                    `
                        SELECT
                            id,
                            conversation_id,
                            idempotency_key,
                            sender_type,
                            content,
                            created_at
                        FROM public.messages
                        WHERE conversation_id = $1
                          AND idempotency_key = $2
                          AND sender_type = 'bot'
                        LIMIT 1;
                    `,
                    [conversationId, idempotencyKey]
                );

                if (existingBot.rowCount === 0) {
                    throw new Error(
                        'Unable to retrieve persisted bot response.'
                    );
                }

                botRecord = existingBot.rows[0];
            }
        }

        // Update conversation activity.
        await client.query(
            `
                UPDATE public.conversations
                SET last_message_at = NOW()
                WHERE id = $1
                  AND organization_id = $2
                  AND chatbot_id = $3;
            `,
            [
                conversationId,
                organizationId,
                chatbotId
            ]
        );

        await client.query('COMMIT');

        return {
            customerMessage: customerRecord,
            botMessage: botRecord
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;

    } finally {
        client.release();
    }
};


// =====================================================
// GET TRUSTED CONVERSATION HISTORY
// =====================================================

export const getConversationHistory = async ({
    conversationId,
    organizationId,
    chatbotId,
    limit = 100
}) => {
    const safeLimit = Math.min(
        Math.max(Number.parseInt(limit, 10) || 100, 1),
        100
    );

    const result = await pool.query(
        `
            SELECT
                m.id,
                m.sender_type,
                m.content,
                m.created_at
            FROM public.messages m
            INNER JOIN public.conversations c
                ON c.id = m.conversation_id
            WHERE c.id = $1
              AND c.organization_id = $2
              AND c.chatbot_id = $3
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $4;
        `,
        [
            conversationId,
            organizationId,
            chatbotId,
            safeLimit
        ]
    );

    return result.rows.reverse().map((message) => ({
        sender_type: message.sender_type,
        content: message.content
    }));
};