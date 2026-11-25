import { pool } from '../config/database.js';

// Retrieve a conversation with organization and chatbot ownership checks.
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


// Create a new conversation.
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


// Save a message after validating conversation and sender relationships.
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

        // Verify conversation ownership and availability.
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
            throw new Error('Conversation not found or unavailable.');
        }

        // Verify that the session belongs to this conversation.
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

        // Verify that an agent belongs to the organization
        // and is assigned to this conversation.
        if (senderType === 'agent') {
            if (!senderMemberId) {
                throw new Error('Agent sender identity is required.');
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

        // Insert the message.
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

        // Update the conversation's latest message timestamp.
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


// Retrieve trusted conversation history.
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