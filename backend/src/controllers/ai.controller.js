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
    completeRequest
} from '../services/idempotency.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const DEFAULT_DOMAIN = 'general';


// =====================================================
// CHAT CONTROLLER
// =====================================================

export const chatController = async (req, res, next) => {

    try {

        // -------------------------------------------------
        // 1. VALIDATE IDEMPOTENCY KEY
        // -------------------------------------------------

        const requestId = req.get('Idempotency-Key');

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
        // 2. VALIDATE REQUEST BODY
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
        // 3. VERIFY CHATBOT OWNERSHIP
        // -------------------------------------------------

        const chatbotResult = await pool.query(
            `
                SELECT
                    id,
                    organization_id
                FROM public.chatbots
                WHERE id = $1
                  AND organization_id = $2
                LIMIT 1;
            `,
            [
                chatbot_id,
                req.organization.id
            ]
        );


        if (chatbotResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Chatbot not found.'
            });
        }


        const chatbot = chatbotResult.rows[0];


        // -------------------------------------------------
        // 4. GENERATE REQUEST HASH
        // -------------------------------------------------

        const requestHash = createHash('sha256')
            .update(JSON.stringify({
                message: normalizedMessage,
                chatbotId: chatbot.id,
                conversationId: conversation_id
            }))
            .digest('hex');


        // -------------------------------------------------
        // 5. RESERVE IDEMPOTENCY REQUEST
        // -------------------------------------------------

        const reservation = await reserveRequest({

            organizationId: chatbot.organization_id,

            chatbotId: chatbot.id,

            idempotencyKey: requestId,

            requestHash

        });


        // -------------------------------------------------
        // 6. HANDLE EXISTING REQUESTS
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


        // -------------------------------------------------
        // 7. GET OR CREATE CONVERSATION
        // -------------------------------------------------

        let conversation;


        if (conversation_id) {

            conversation = await getConversation({

                conversationId: conversation_id,

                organizationId: chatbot.organization_id,

                chatbotId: chatbot.id

            });


            if (!conversation) {

                return res.status(404).json({
                    success: false,
                    message:
                        'Conversation not found or does not belong to this chatbot.'
                });

            }

        } else {

            conversation = await createConversation({

                organizationId: chatbot.organization_id,

                chatbotId: chatbot.id

            });

        }


        // -------------------------------------------------
        // 8. LOAD TRUSTED CONVERSATION HISTORY
        // -------------------------------------------------

        const history = await getConversationHistory({

            conversationId: conversation.id,

            organizationId: chatbot.organization_id,

            chatbotId: chatbot.id,

            limit: 100

        });


        // -------------------------------------------------
        // 9. LOAD CHATBOT SETTINGS
        // -------------------------------------------------

        const settingsResult = await pool.query(
            `
                SELECT
                    settings,
                    system_prompt
                FROM public.chatbot_settings
                WHERE chatbot_id = $1
                LIMIT 1;
            `,
            [chatbot.id]
        );


        const chatbotSettings =
            settingsResult.rows[0] ?? {};


        const settings =
            chatbotSettings.settings ?? {};


        const domain =
            settings.domain ?? DEFAULT_DOMAIN;


        const requiredEntities =
            settings.required_entities ?? [];


        // -------------------------------------------------
        // 10. GENERATE AI RESPONSE
        // -------------------------------------------------

        const result = await generateAIResponse({

            message: normalizedMessage,

            history,

            domain,

            requiredEntities

        });


        // -------------------------------------------------
        // 11. PERSIST CUSTOMER + BOT MESSAGES ATOMICALLY
        // -------------------------------------------------

        const botResponse =
            typeof result.response === 'string' &&
            result.response.trim()
                ? result.response.trim()
                : null;


        await saveConversationTurn({

            conversationId: conversation.id,

            organizationId: chatbot.organization_id,

            chatbotId: chatbot.id,

            idempotencyKey: requestId,

            customerMessage: normalizedMessage,

            botResponse

        });


        // -------------------------------------------------
        // 12. LOG COHERE USAGE
        // -------------------------------------------------

        if (
            result.status === 'response_generated' &&
            result.model &&
            result.usage
        ) {

            try {

                const usage = result.usage;


                const pricing = calculateCohereCost({

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


                await logAIUsage({

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
                    'AI Usage Logging Failed:',
                    loggingError.message
                );

            }

        }


        // -------------------------------------------------
        // 13. BUILD RESPONSE
        // -------------------------------------------------

        const responseBody = {

            ...result,

            conversation_id: conversation.id

        };


        // -------------------------------------------------
        // 14. CACHE IDEMPOTENT RESPONSE
        // -------------------------------------------------

        await completeRequest({

            reservationId: reservation.id,

            reservationToken: reservation.reservationToken,

            responseBody,

            responseStatus: 200

        });


        // -------------------------------------------------
        // 15. RETURN RESPONSE
        // -------------------------------------------------

        return res.status(200).json(responseBody);


    } catch (error) {

        next(error);

    }

};