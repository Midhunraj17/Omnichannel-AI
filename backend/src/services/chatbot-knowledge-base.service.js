import { pool } from '../config/database.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const createError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};


const validateUUID = (value, label) => {
    if (
        typeof value !== 'string' ||
        !UUID_REGEX.test(value)
    ) {
        throw createError(`Invalid ${label}.`);
    }
};


/**
 * Explicit chatbot-to-knowledge-base access service.
 *
 * Current retrieval architecture:
 * - One knowledge base per chatbot.
 * - One knowledge base may be shared by multiple chatbots.
 * - Both resources must belong to the same organization.
 * - No implicit organization-wide fallback is allowed.
 */

export const createChatbotKnowledgeBaseService = ({
    database = pool
} = {}) => {

    // =====================================================
    // FIND KNOWLEDGE BASE FOR CHATBOT
    // =====================================================

    const findKnowledgeBaseForChatbot = async ({
        organizationId,
        chatbotId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(chatbotId, 'chatbot ID');

        const result = await database.query(
            `
                SELECT
                    kb.id,
                    kb.organization_id,
                    kb.chatbot_id,
                    kb.name,
                    kb.retrieval_config,
                    access.created_at AS access_granted_at

                FROM public.knowledge_base_chatbot_access AS access

                INNER JOIN public.knowledge_bases AS kb
                    ON kb.id = access.knowledge_base_id
                   AND kb.organization_id = access.organization_id

                INNER JOIN public.chatbots AS cb
                    ON cb.id = access.chatbot_id
                   AND cb.organization_id = access.organization_id

                WHERE access.organization_id = $1
                  AND access.chatbot_id = $2
                  AND kb.status = 'active'
                  AND cb.status = 'active'

                LIMIT 2;
            `,
            [
                organizationId,
                chatbotId
            ]
        );

        if (result.rows.length > 1) {
            throw createError(
                'Multiple active knowledge bases are associated with this chatbot. Resolve the associations before continuing.',
                409
            );
        }

        return result.rows[0] ?? null;
    };


    // =====================================================
    // GRANT KNOWLEDGE BASE ACCESS
    // =====================================================

    const grantKnowledgeBaseAccess = async ({
        organizationId,
        knowledgeBaseId,
        chatbotId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');
        validateUUID(chatbotId, 'chatbot ID');

        const client = await database.connect();

        try {
            await client.query('BEGIN');

            // ---------------------------------------------
            // VERIFY KNOWLEDGE BASE OWNERSHIP AND STATUS
            // ---------------------------------------------

            const knowledgeBase = await client.query(
                `
                    SELECT id

                    FROM public.knowledge_bases

                    WHERE id = $1
                      AND organization_id = $2
                      AND status = 'active'

                    FOR UPDATE;
                `,
                [
                    knowledgeBaseId,
                    organizationId
                ]
            );

            if (!knowledgeBase.rowCount) {
                throw createError(
                    'Knowledge base not found, inactive, or not owned by this organization.',
                    404
                );
            }


            // ---------------------------------------------
            // VERIFY CHATBOT OWNERSHIP AND STATUS
            // ---------------------------------------------

            const chatbot = await client.query(
                `
                    SELECT id

                    FROM public.chatbots

                    WHERE id = $1
                      AND organization_id = $2
                      AND status = 'active'

                    FOR UPDATE;
                `,
                [
                    chatbotId,
                    organizationId
                ]
            );

            if (!chatbot.rowCount) {
                throw createError(
                    'Chatbot not found, inactive, or not owned by this organization.',
                    404
                );
            }


            // ---------------------------------------------
            // PREVENT MULTIPLE KNOWLEDGE BASES PER CHATBOT
            // ---------------------------------------------

            const existingAssociation = await client.query(
                `
                    SELECT knowledge_base_id

                    FROM public.knowledge_base_chatbot_access

                    WHERE organization_id = $1
                      AND chatbot_id = $2

                    LIMIT 1

                    FOR UPDATE;
                `,
                [
                    organizationId,
                    chatbotId
                ]
            );

            if (
                existingAssociation.rowCount > 0 &&
                existingAssociation.rows[0].knowledge_base_id !== knowledgeBaseId
            ) {
                throw createError(
                    'This chatbot already has a knowledge base. Revoke the existing association before assigning another.',
                    409
                );
            }


            // ---------------------------------------------
            // CREATE ASSOCIATION
            // ---------------------------------------------

            const inserted = await client.query(
                `
                    INSERT INTO public.knowledge_base_chatbot_access (
                        organization_id,
                        knowledge_base_id,
                        chatbot_id
                    )

                    VALUES ($1, $2, $3)

                    ON CONFLICT (
                        knowledge_base_id,
                        chatbot_id
                    )

                    DO NOTHING

                    RETURNING id;
                `,
                [
                    organizationId,
                    knowledgeBaseId,
                    chatbotId
                ]
            );

            await client.query('COMMIT');

            return {
                success: true,
                already_associated: inserted.rowCount === 0,
                association_id: inserted.rows[0]?.id ?? null
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;

        } finally {
            client.release();
        }
    };


    // =====================================================
    // REVOKE KNOWLEDGE BASE ACCESS
    // =====================================================

    const revokeKnowledgeBaseAccess = async ({
        organizationId,
        knowledgeBaseId,
        chatbotId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');
        validateUUID(chatbotId, 'chatbot ID');

        const client = await database.connect();

        try {
            await client.query('BEGIN');

            const deleted = await client.query(
                `
                    DELETE FROM public.knowledge_base_chatbot_access

                    WHERE organization_id = $1
                      AND knowledge_base_id = $2
                      AND chatbot_id = $3

                    RETURNING id;
                `,
                [
                    organizationId,
                    knowledgeBaseId,
                    chatbotId
                ]
            );


            // Keep the legacy chatbot_id column synchronized.
            // The database trigger also removes the old association.

            if (deleted.rowCount > 0) {
                await client.query(
                    `
                        UPDATE public.knowledge_bases

                        SET chatbot_id = NULL,
                            updated_at = NOW()

                        WHERE id = $1
                          AND organization_id = $2
                          AND chatbot_id = $3;
                    `,
                    [
                        knowledgeBaseId,
                        organizationId,
                        chatbotId
                    ]
                );
            }

            await client.query('COMMIT');

            return {
                success: true,
                revoked: deleted.rowCount > 0
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;

        } finally {
            client.release();
        }
    };


    // =====================================================
    // LIST CHATBOT KNOWLEDGE BASES
    // =====================================================

    const listChatbotKnowledgeBases = async ({
        organizationId,
        chatbotId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(chatbotId, 'chatbot ID');

        const result = await database.query(
            `
                SELECT
                    kb.id,
                    kb.name,
                    kb.description,
                    kb.status,
                    kb.retrieval_config,
                    access.created_at AS access_granted_at

                FROM public.knowledge_base_chatbot_access AS access

                INNER JOIN public.knowledge_bases AS kb
                    ON kb.id = access.knowledge_base_id
                   AND kb.organization_id = access.organization_id

                WHERE access.organization_id = $1
                  AND access.chatbot_id = $2

                ORDER BY access.created_at DESC;
            `,
            [
                organizationId,
                chatbotId
            ]
        );

        return result.rows;
    };


    return {
        findKnowledgeBaseForChatbot,
        grantKnowledgeBaseAccess,
        revokeKnowledgeBaseAccess,
        listChatbotKnowledgeBases
    };
};


// =====================================================
// PRODUCTION EXPORTS
// =====================================================

const service = createChatbotKnowledgeBaseService();

export const findKnowledgeBaseForChatbot =
    service.findKnowledgeBaseForChatbot;

export const grantKnowledgeBaseAccess =
    service.grantKnowledgeBaseAccess;

export const revokeKnowledgeBaseAccess =
    service.revokeKnowledgeBaseAccess;

export const listChatbotKnowledgeBases =
    service.listChatbotKnowledgeBases;