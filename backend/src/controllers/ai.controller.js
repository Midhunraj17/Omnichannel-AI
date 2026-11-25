import { createHash } from 'node:crypto';

import { pool } from '../config/database.js';

import {
    generateAIResponse
} from '../services/ai.service.js';

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


export const chatController = async (req, res, next) => {

    try {

        // 1. Validate idempotency key

        const requestId = req.get('Idempotency-Key');

        if (
            typeof requestId !== 'string' ||
            !UUID_REGEX.test(requestId)
        ) {
            return res.status(400).json({
                success: false,
                message: 'A valid Idempotency-Key UUID is required'
            });
        }


        const { message, chatbot_id } = req.body;


        // 2. Validate customer message

        if (
            typeof message !== 'string' ||
            !message.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: 'A valid message is required'
            });
        }


        // 3. Validate chatbot ID

        if (
            typeof chatbot_id !== 'string' ||
            !UUID_REGEX.test(chatbot_id)
        ) {
            return res.status(400).json({
                success: false,
                message: 'A valid chatbot ID is required'
            });
        }


        // 4. Verify chatbot ownership

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
                message: 'Chatbot not found'
            });
        }


        const chatbot = chatbotResult.rows[0];

        const normalizedMessage = message.trim();


        // 5. Generate deterministic request hash

        const requestHash = createHash('sha256')
            .update(JSON.stringify({
                message: normalizedMessage,
                chatbotId: chatbot.id
            }))
            .digest('hex');


        // 6. Reserve or retrieve idempotency request

        const reservation = await reserveRequest({

            organizationId: chatbot.organization_id,

            chatbotId: chatbot.id,

            idempotencyKey: requestId,

            requestHash

        });


        // 7. Handle existing requests

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


        // 8. Generate AI response

        const result = await generateAIResponse(
            normalizedMessage
        );


        // 9. Log Cohere usage

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


        // 10. Cache the original AI response

        await completeRequest({

            reservationId: reservation.id,

            reservationToken: reservation.reservationToken,

            responseBody: result,

            responseStatus: 200

        });


        // 11. Return AI response

        return res.status(200).json(result);


    } catch (error) {

        next(error);

    }

};