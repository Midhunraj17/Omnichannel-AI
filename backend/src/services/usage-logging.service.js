import { randomUUID } from 'node:crypto';
import { pool } from '../config/database.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const RETRYABLE_ERRORS = new Set([
    '40001', // Serialization failure
    '40P01', // Deadlock
    '53300', // Too many connections
    '57P01', // Database shutting down
    '08000', // Connection exception
    '08003', // Connection does not exist
    '08006', // Connection failure
]);

const delay = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

export const logAIUsage = async ({
    organizationId,
    chatbotId = null,
    conversationId = null,
    messageId = null,
    aiConfigurationId = null,

    provider = 'cohere',
    modelName = 'unknown',

    inputTokens = 0,
    outputTokens = 0,

    billedInputTokens = null,
    billedOutputTokens = null,

    inputCost = 0,
    outputCost = 0,
    costCurrency = 'USD',
    pricingVersion = null,

    requestId = randomUUID()
}) => {

    if (!organizationId) {
        throw new Error('Organization ID is required');
    }

    const promptTokens = billedInputTokens ?? inputTokens;
    const completionTokens = billedOutputTokens ?? outputTokens;

    const numericValues = [
        promptTokens,
        completionTokens,
        inputCost,
        outputCost
    ];

    if (
        numericValues.some(
            value =>
                !Number.isFinite(Number(value)) ||
                Number(value) < 0
        )
    ) {
        throw new Error('Invalid AI usage values');
    }

    const totalTokens =
        Number(promptTokens) + Number(completionTokens);

    const estimatedCost =
        Number(inputCost) + Number(outputCost);

    const query = `
        INSERT INTO public.ai_usage_logs (
            organization_id,
            chatbot_id,
            conversation_id,
            message_id,
            ai_configuration_id,
            provider,
            model_name,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            input_cost,
            output_cost,
            estimated_cost,
            cost_currency,
            pricing_version,
            request_id
        )
        VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16
        )
        ON CONFLICT (request_id)
        WHERE request_id IS NOT NULL
        DO NOTHING
        RETURNING id, request_id, total_tokens, estimated_cost;
    `;

    const values = [
        organizationId,
        chatbotId,
        conversationId,
        messageId,
        aiConfigurationId,
        provider,
        modelName,
        promptTokens,
        completionTokens,
        totalTokens,
        inputCost,
        outputCost,
        estimatedCost,
        costCurrency,
        pricingVersion,
        requestId
    ];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {

        try {
            const result = await pool.query(query, values);

            return {
                logged: result.rowCount > 0,
                requestId,
                usage: result.rows[0] ?? null
            };

        } catch (error) {

            const shouldRetry =
                RETRYABLE_ERRORS.has(error.code);

            if (!shouldRetry || attempt === MAX_RETRIES) {
                throw error;
            }

            const waitTime =
                RETRY_DELAY_MS * (2 ** attempt);

            console.warn(
                `AI usage logging retry ${attempt + 1}/${MAX_RETRIES}`
            );

            await delay(waitTime);
        }
    }
};
