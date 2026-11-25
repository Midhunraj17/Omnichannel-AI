import { createHash } from 'node:crypto';

import { pool } from '../config/database.js';

import {
    generateAIResponse
} from '../services/ai.service.js';

import {
    getConversation,
    createConversation,
    getConversationHistory,
    saveConversationTurn
} from '../services/conversation.service.js';

import {
    logAIUsage
} from '../services/usage-logging.service.js';

import {
    calculateCohereCost
} from '../services/cohere-pricing.service.js';

import {
    reserveRequest,
    completeRequest,
    releaseRequest
} from '../services/idempotency.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_DOMAIN = 'general';


const findChatbot = async ({
    chatbotId,
    organizationId
}) => {

    const result = await pool.query(
        `
            SELECT id, organization_id
            FROM public.chatbots
            WHERE id = $1
              AND organization_id = $2
            LIMIT 1;
        `,
        [chatbotId, organizationId]
    );

    return result.rows[0] ?? null;
};


const getChatbotSettings = async (chatbotId) => {

    const result = await pool.query(
        `
            SELECT settings, system_prompt
            FROM public.chatbot_settings
            WHERE chatbot_id = $1
            LIMIT 1;
        `,
        [chatbotId]
    );

    return result.rows[0] ?? {};
};


// =====================================================
// CHAT CONTROLLER FACTORY
// =====================================================

export const createChatController = ({

    findChatbotFn = findChatbot,

    getChatbotSettingsFn = getChatbotSettings,

    getConversationFn = getConversation,

    createConversationFn = createConversation,

    getConversationHistoryFn = getConversationHistory,

    saveConversationTurnFn = saveConversationTurn,

    generateAIResponseFn = generateAIResponse,

    reserveRequestFn = reserveRequest,

    completeRequestFn = completeRequest,

    releaseRequestFn = releaseRequest,

    logAIUsageFn = logAIUsage,

    calculateCohereCostFn = calculateCohereCost

} = {}) => {

    return async (req, res, next) => {

        let activeReservation = null;


        // -------------------------------------------------
        // RELEASE FAILED RESERVATIONS
        // -------------------------------------------------

        const releaseActiveReservation = async () => {

            if (!activeReservation) {
                return;
            }

            const reservation = activeReservation;

            activeReservation = null;

            try {

                await releaseRequestFn(reservation);

            } catch (error) {

                console.error(
                    'Unable to release idempotency reservation:',
                    error.message
                );

            }

        };


        try {

            // -------------------------------------------------
            // 1. ORGANIZATION CONTEXT
            // -------------------------------------------------

            if (!req.organization?.id) {

                return res.status(500).json({
                    success: false,
                    message: 'Organization context is missing.'
                });

            }


            // -------------------------------------------------
            // 2. IDEMPOTENCY VALIDATION
            // -------------------------------------------------

            const requestId =
                req.get('Idempotency-Key');

            if (
                typeof requestId !== 'string' ||
                !UUID_REGEX.test(requestId)
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'A valid Idempotency-Key UUID is required.'
                });

            }


            // -------------------------------------------------
            // 3. REQUEST VALIDATION
            // -------------------------------------------------

            const {
                message,
                chatbot_id,
                conversation_id = null
            } = req.body ?? {};


            if (
                typeof message !== 'string' ||
                !message.trim() ||
                message.length > 10000
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'A valid message is required.'
                });

            }


            if (
                typeof chatbot_id !== 'string' ||
                !UUID_REGEX.test(chatbot_id)
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'A valid chatbot ID is required.'
                });

            }


            if (
                conversation_id !== null &&
                (
                    typeof conversation_id !== 'string' ||
                    !UUID_REGEX.test(conversation_id)
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message: 'A valid conversation ID is required.'
                });

            }


            const normalizedMessage = message.trim();


            // -------------------------------------------------
            // 4. VERIFY CHATBOT TENANT OWNERSHIP
            // -------------------------------------------------

            const chatbot = await findChatbotFn({

                chatbotId: chatbot_id,

                organizationId: req.organization.id

            });


            if (!chatbot) {

                return res.status(404).json({
                    success: false,
                    message: 'Chatbot not found.'
                });

            }


            // -------------------------------------------------
            // 5. REQUEST HASH
            // -------------------------------------------------

            const requestHash = createHash('sha256')
                .update(JSON.stringify({

                    message: normalizedMessage,

                    chatbotId: chatbot.id,

                    conversationId: conversation_id

                }))
                .digest('hex');


            // -------------------------------------------------
            // 6. RESERVE IDEMPOTENCY KEY
            // -------------------------------------------------

            const reservation = await reserveRequestFn({

                organizationId: chatbot.organization_id,

                chatbotId: chatbot.id,

                idempotencyKey: requestId,

                requestHash

            });


            // -------------------------------------------------
            // 7. HANDLE EXISTING REQUEST
            // -------------------------------------------------

            if (reservation.state === 'completed') {

                return res
                    .status(reservation.responseStatus)
                    .json(reservation.responseBody);

            }


            if (reservation.state === 'conflict') {

                return res.status(409).json({

                    success: false,

                    message:
                        'This Idempotency-Key has already been used with a different request.'

                });

            }


            if (reservation.state === 'processing') {

                res.set('Retry-After', '3');

                return res.status(409).json({

                    success: false,

                    message: 'This request is already being processed.',

                    retryable: true

                });

            }


            if (reservation.state !== 'reserved') {

                throw new Error(
                    'Unexpected idempotency reservation state.'
                );

            }


            activeReservation = {

                reservationId: reservation.id,

                reservationToken: reservation.reservationToken

            };


            // -------------------------------------------------
            // 8. GET OR CREATE CONVERSATION
            // -------------------------------------------------

            let conversation;


            if (conversation_id) {

                conversation = await getConversationFn({

                    conversationId: conversation_id,

                    organizationId: chatbot.organization_id,

                    chatbotId: chatbot.id

                });


                if (!conversation) {

                    await releaseActiveReservation();

                    return res.status(404).json({

                        success: false,

                        message:
                            'Conversation not found or does not belong to this chatbot.'

                    });

                }

            } else {

                conversation = await createConversationFn({

                    organizationId: chatbot.organization_id,

                    chatbotId: chatbot.id

                });

            }


            // -------------------------------------------------
            // 9. LOAD TRUSTED CONVERSATION HISTORY
            // -------------------------------------------------

            const history = await getConversationHistoryFn({

                conversationId: conversation.id,

                organizationId: chatbot.organization_id,

                chatbotId: chatbot.id,

                limit: 100

            });


            // -------------------------------------------------
            // 10. LOAD CHATBOT SETTINGS
            // -------------------------------------------------

            const chatbotSettings =
                await getChatbotSettingsFn(chatbot.id);

            const settings =
                chatbotSettings?.settings ?? {};

            const domain =
                settings.domain ?? DEFAULT_DOMAIN;

            const requiredEntities =
                settings.required_entities ?? [];


            // -------------------------------------------------
            // 11. GENERATE AI RESPONSE
            // -------------------------------------------------

            const result = await generateAIResponseFn({

                message: normalizedMessage,

                history,

                domain,

                requiredEntities

            });


            if (
                !result ||
                typeof result !== 'object' ||
                typeof result.status !== 'string'
            ) {

                throw new Error(
                    'AI service returned an invalid response.'
                );

            }


            // -------------------------------------------------
            // 12. PERSIST CONVERSATION TURN
            // -------------------------------------------------

            const botResponse =
                typeof result.response === 'string' &&
                result.response.trim()
                    ? result.response.trim()
                    : null;


            const persistedTurn =
                await saveConversationTurnFn({

                    conversationId: conversation.id,

                    organizationId: chatbot.organization_id,

                    chatbotId: chatbot.id,

                    idempotencyKey: requestId,

                    customerMessage: normalizedMessage,

                    botResponse

                });


            // -------------------------------------------------
            // 13. LOG AI USAGE
            // -------------------------------------------------

            if (
                result.status === 'response_generated' &&
                result.model &&
                result.usage
            ) {

                try {

                    const usage = result.usage;

                    const pricing = calculateCohereCostFn({

                        modelName: result.model,

                        inputTokens:
                            usage.billed_input_tokens ??
                            usage.input_tokens ??
                            0,

                        outputTokens:
                            usage.billed_output_tokens ??
                            usage.output_tokens ??
                            0

                    });


                    await logAIUsageFn({

                        organizationId: chatbot.organization_id,

                        chatbotId: chatbot.id,

                        requestId,

                        provider: 'cohere',

                        modelName: result.model,

                        inputTokens:
                            usage.input_tokens ?? 0,

                        outputTokens:
                            usage.output_tokens ?? 0,

                        billedInputTokens:
                            usage.billed_input_tokens ?? null,

                        billedOutputTokens:
                            usage.billed_output_tokens ?? null,

                        inputCost: pricing.inputCost,

                        outputCost: pricing.outputCost,

                        costCurrency: pricing.currency,

                        pricingVersion: pricing.pricingVersion

                    });

                } catch (loggingError) {

                    console.error(
                        'AI usage logging failed:',
                        loggingError.message
                    );

                }

            }


            // -------------------------------------------------
            // 14. BUILD RESPONSE
            // -------------------------------------------------

            const persistedBotResponse =
                persistedTurn?.botMessage?.content;

            const responseBody = {

                ...result,

                ...(persistedBotResponse
                    ? { response: persistedBotResponse }
                    : {}),

                conversation_id: conversation.id

            };


            // -------------------------------------------------
            // 15. COMPLETE IDEMPOTENCY REQUEST
            // -------------------------------------------------

            await completeRequestFn({

                reservationId: reservation.id,

                reservationToken: reservation.reservationToken,

                responseBody,

                responseStatus: 200

            });


            activeReservation = null;


            // -------------------------------------------------
            // 16. RETURN RESPONSE
            // -------------------------------------------------

            return res.status(200).json(responseBody);


        } catch (error) {

            await releaseActiveReservation();

            return next(error);

        }

    };

};


// =====================================================
// PRODUCTION CONTROLLER
// =====================================================

export const chatController = createChatController();