import { env } from '../config/env.js';

const MAX_HISTORY_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 10000;

const VALID_DOMAINS = [
    'general',
    'ecommerce',
    'product',
    'saas',
    'service'
];

const VALID_SENDER_TYPES = [
    'customer',
    'bot',
    'agent',
    'system'
];

const normalizeHistory = (history = []) => {
    if (!Array.isArray(history)) {
        throw new TypeError('Conversation history must be an array.');
    }

    return history
        .slice(-MAX_HISTORY_MESSAGES)
        .map((item) => {
            if (
                !item ||
                !VALID_SENDER_TYPES.includes(item.sender_type) ||
                typeof item.content !== 'string' ||
                !item.content.trim()
            ) {
                throw new TypeError(
                    'Invalid conversation history message.'
                );
            }

            return {
                sender_type: item.sender_type,
                content: item.content.trim().slice(
                    0,
                    MAX_MESSAGE_LENGTH
                )
            };
        });
};

export const generateAIResponse = async ({
    message,
    history = [],
    domain = 'general',
    requiredEntities = [],
    conversationSummary = null
}) => {
    if (
        typeof message !== 'string' ||
        !message.trim() ||
        message.length > MAX_MESSAGE_LENGTH
    ) {
        throw new TypeError('A valid message is required.');
    }

    if (!VALID_DOMAINS.includes(domain)) {
        throw new TypeError('Unsupported chatbot domain.');
    }

    if (
        !Array.isArray(requiredEntities) ||
        requiredEntities.length > 30 ||
        !requiredEntities.every(
            (item) =>
                typeof item === 'string' &&
                item.trim().length > 0
        )
    ) {
        throw new TypeError('Invalid required entities.');
    }

    if (
        conversationSummary !== null &&
        (
            typeof conversationSummary !== 'string' ||
            conversationSummary.length > 3000
        )
    ) {
        throw new TypeError('Invalid conversation summary.');
    }

    const payload = {
        message: message.trim(),
        history: normalizeHistory(history),
        domain,
        required_entities: requiredEntities,
        conversation_summary: conversationSummary
    };

    let response;

    try {
        response = await fetch(
            `${env.aiServiceUrl}/api/v1/orchestrator/run`,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.aiServiceApiKey}`
                },

                body: JSON.stringify(payload),

                signal: AbortSignal.timeout(30000)
            }
        );
    } catch (error) {
        console.error(
            'AI Service Communication Error:',
            error.message
        );

        throw new Error(
            'Unable to communicate with the AI service.'
        );
    }

    if (!response.ok) {
        console.error(
            `AI Service returned HTTP ${response.status}.`
        );

        throw new Error(
            'The AI service could not process the request.'
        );
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error(
            'The AI service returned an invalid response.'
        );
    }

    if (
        !result ||
        typeof result !== 'object' ||
        typeof result.status !== 'string'
    ) {
        throw new Error(
            'The AI service returned an unexpected response structure.'
        );
    }

    return result;
};