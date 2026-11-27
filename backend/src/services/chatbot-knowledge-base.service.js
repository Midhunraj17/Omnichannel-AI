import { pool } from '../config/database.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const createError = (
    message,
    statusCode = 400
) => {

    const error = new Error(message);

    error.statusCode = statusCode;

    return error;

};


const validateUUID = (
    value,
    label
) => {

    if (
        typeof value !== 'string' ||
        !UUID_REGEX.test(value)
    ) {

        throw createError(
            `Invalid ${label}.`
        );

    }

};


/**
 * Explicit chatbot-to-knowledge-base access service.
 *
 * A chatbot can access a knowledge base only when
 * an explicit association exists.
 */

export const createChatbotKnowledgeBaseService = ({
    database = pool
} = {}) => {


    // =====================================================
    // FIND ACCESSIBLE KNOWLEDGE BASE
    // =====================================================

    const findKnowledgeBaseForChatbot = async ({
        organizationId,
        chatbotId
    }) => {

        validateUUID(
            organizationId,
            'organization ID'
        );

        validateUUID(
            chatbotId,
            'chatbot ID'
        );


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

                WHERE

                    access.organization_id = $1

                    AND access.chatbot_id = $2

                    AND kb.status = 'active'

                    AND cb.status = 'active'

                ORDER BY

                    kb.updated_at DESC,

                    kb.created_at DESC

                LIMIT 2;

            `,

            [
                organizationId,
                chatbotId
            ]

        );


        if (result.rows.length > 1) {

            throw createError(

                'Multiple active knowledge bases are associated with this chatbot. Configure a single primary knowledge base before continuing.',

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

        validateUUID(
            organizationId,
            'organization ID'
        );

        validateUUID(
            knowledgeBaseId,
            'knowledge base ID'
        );

        validateUUID(
            chatbotId,
            'chatbot ID'
        );


        const client = await database.connect();


        try {

            await client.query('BEGIN');


            // ---------------------------------------------
            // VERIFY KNOWLEDGE BASE OWNERSHIP
            // ---------------------------------------------

            const knowledgeBase = await client.query(

                `

                    SELECT id

                    FROM public.knowledge_bases

                    WHERE id = $1

                      AND organization_id = $2

                    FOR UPDATE;

                `,

                [
                    knowledgeBaseId,
                    organizationId
                ]

            );


            if (!knowledgeBase.rowCount) {

                throw createError(

                    'Knowledge base not found in this organization.',

                    404

                );

            }


            // ---------------------------------------------
            // VERIFY CHATBOT OWNERSHIP
            // ---------------------------------------------

            const chatbot = await client.query(

                `

                    SELECT id

                    FROM public.chatbots

                    WHERE id = $1

                      AND organization_id = $2

                    FOR UPDATE;

                `,

                [
                    chatbotId,
                    organizationId
                ]

            );


            if (!chatbot.rowCount) {

                throw createError(

                    'Chatbot not found in this organization.',

                    404

                );

            }


            // ---------------------------------------------
            // CREATE EXPLICIT ASSOCIATION
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

                already_associated:
                    inserted.rowCount === 0,

                association_id:
                    inserted.rows[0]?.id ?? null

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

        validateUUID(
            organizationId,
            'organization ID'
        );

        validateUUID(
            knowledgeBaseId,
            'knowledge base ID'
        );

        validateUUID(
            chatbotId,
            'chatbot ID'
        );


        const result = await database.query(

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


        return {

            success: true,

            revoked: result.rowCount > 0

        };

    };


    // =====================================================
    // LIST CHATBOT KNOWLEDGE BASE ASSOCIATIONS
    // =====================================================

    const listChatbotKnowledgeBases = async ({
        organizationId,
        chatbotId
    }) => {

        validateUUID(
            organizationId,
            'organization ID'
        );

        validateUUID(
            chatbotId,
            'chatbot ID'
        );


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

                WHERE

                    access.organization_id = $1

                    AND access.chatbot_id = $2

                ORDER BY

                    access.created_at DESC;

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


const service = createChatbotKnowledgeBaseService();


export const findKnowledgeBaseForChatbot =
    service.findKnowledgeBaseForChatbot;


export const grantKnowledgeBaseAccess =
    service.grantKnowledgeBaseAccess;


export const revokeKnowledgeBaseAccess =
    service.revokeKnowledgeBaseAccess;


export const listChatbotKnowledgeBases =
    service.listChatbotKnowledgeBases;