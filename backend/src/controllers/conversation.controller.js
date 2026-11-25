import {
    getConversation,
    saveMessage
} from '../services/conversation.service.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// Dependency injection makes the controller independently testable.
export const createSendAgentMessageController = ({
    getConversationFn = getConversation,
    saveMessageFn = saveMessage
} = {}) => {

    return async (req, res, next) => {
        try {
            const { conversationId, chatbotId } = req.params;
            const { content } = req.body;

            // Validate conversation ID.
            if (
                typeof conversationId !== 'string' ||
                !UUID_REGEX.test(conversationId)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid conversation ID.'
                });
            }

            // Validate chatbot ID.
            if (
                typeof chatbotId !== 'string' ||
                !UUID_REGEX.test(chatbotId)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid chatbot ID.'
                });
            }

            // Validate message content.
            if (
                typeof content !== 'string' ||
                !content.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Message content cannot be empty.'
                });
            }

            // Use authenticated membership identity.
            const senderMemberId = req.organization.memberId;

            if (!senderMemberId) {
                return res.status(403).json({
                    success: false,
                    message: 'Authenticated member identity is missing.'
                });
            }

            // Retrieve conversation using trusted organization context.
            const conversation = await getConversationFn({
                conversationId,
                organizationId: req.organization.id,
                chatbotId
            });

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found.'
                });
            }

            // Persist the agent message.
            const message = await saveMessageFn({
                conversationId: conversation.id,
                organizationId: req.organization.id,
                chatbotId: conversation.chatbot_id,
                senderType: 'agent',
                senderMemberId,
                content: content.trim()
            });

            return res.status(201).json({
                success: true,
                message: 'Agent message saved successfully.',
                data: message
            });

        } catch (error) {
            return next(error);
        }
    };
};


// Production controller.
export const sendAgentMessageController =
    createSendAgentMessageController();