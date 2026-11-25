import { pool } from '../config/database.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// CHATBOT TENANT AUTHORIZATION
// =====================================================

export const createRequireChatbotTenantAccess = ({
    queryFn = (...args) => pool.query(...args)
} = {}) => {

    return async (req, res, next) => {

        try {

            if (!req.organization?.id) {
                return res.status(500).json({
                    success: false,
                    message: 'Organization context is missing.'
                });
            }

            const chatbotId =
            req.params?.chatbotId ??
            req.params?.chatbot_id ??
            req.body?.chatbot_id;

            if (
                typeof chatbotId !== 'string' ||
                !UUID_REGEX.test(chatbotId)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'A valid chatbot ID is required.'
                });
            }

            const result = await queryFn(
                `
                    SELECT
                        id,
                        organization_id,
                        status
                    FROM public.chatbots
                    WHERE id = $1
                      AND organization_id = $2
                    LIMIT 1;
                `,
                [
                    chatbotId,
                    req.organization.id
                ]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Chatbot not found.'
                });
            }

            req.chatbot = result.rows[0];

            return next();

        } catch (error) {

            return next(error);

        }

    };

};


// =====================================================
// ASSIGNED CONVERSATION AUTHORIZATION
// =====================================================

export const createRequireAssignedConversationAccess = ({
    queryFn = (...args) => pool.query(...args)
} = {}) => {

    return async (req, res, next) => {

        try {

            if (!req.organization?.id) {
                return res.status(500).json({
                    success: false,
                    message: 'Organization context is missing.'
                });
            }

            const {
                chatbotId,
                conversationId
            } = req.params;

            if (
                typeof chatbotId !== 'string' ||
                !UUID_REGEX.test(chatbotId) ||
                typeof conversationId !== 'string' ||
                !UUID_REGEX.test(conversationId)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid chatbot or conversation ID.'
                });
            }

            if (!req.organization.memberId) {
                return res.status(403).json({
                    success: false,
                    message: 'Authenticated member identity is missing.'
                });
            }

            const result = await queryFn(
                `
                    SELECT
                        c.id,
                        c.organization_id,
                        c.chatbot_id,
                        c.assigned_agent_id,
                        c.status
                    FROM public.conversations c

                    INNER JOIN public.support_agents sa
                        ON sa.id = c.assigned_agent_id

                    INNER JOIN public.organization_members om
                        ON om.id = sa.organization_member_id

                    WHERE c.id = $1
                      AND c.chatbot_id = $2
                      AND c.organization_id = $3

                      AND om.id = $4
                      AND om.organization_id = $3
                      AND om.role = 'support_agent'
                      AND om.status = 'active'

                      AND c.status IN ('active', 'pending')

                    LIMIT 1;
                `,
                [
                    conversationId,
                    chatbotId,
                    req.organization.id,
                    req.organization.memberId
                ]
            );

            if (result.rowCount === 0) {

                // Deliberately avoid revealing whether a
                // conversation exists in another tenant.

                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found.'
                });

            }

            req.conversation = result.rows[0];

            return next();

        } catch (error) {

            return next(error);

        }

    };

};


// =====================================================
// PRODUCTION MIDDLEWARE
// =====================================================

export const requireChatbotTenantAccess =
    createRequireChatbotTenantAccess();


export const requireAssignedConversationAccess =
    createRequireAssignedConversationAccess();