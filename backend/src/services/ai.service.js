import { env } from '../config/env.js';


const MAX_HISTORY_MESSAGES = 100;

const MAX_MESSAGE_LENGTH = 10000;

const MAX_KNOWLEDGE_CONTEXT_LENGTH = 8000;


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

        throw new TypeError(
            'Conversation history must be an array.'
        );

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


// =====================================================
// AI RESPONSE GENERATION
// =====================================================

export const generateAIResponse = async ({

    message,

    history = [],

    domain = 'general',

    requiredEntities = [],

    conversationSummary = null,

    knowledgeBaseEnabled = false,

    knowledgeContext = null

}) => {

    // -------------------------------------------------
    // 1. MESSAGE VALIDATION
    // -------------------------------------------------

    if (
        typeof message !== 'string' ||
        !message.trim() ||
        message.length > MAX_MESSAGE_LENGTH
    ) {

        throw new TypeError(
            'A valid message is required.'
        );

    }


    // -------------------------------------------------
    // 2. DOMAIN VALIDATION
    // -------------------------------------------------

    if (!VALID_DOMAINS.includes(domain)) {

        throw new TypeError(
            'Unsupported chatbot domain.'
        );

    }


    // -------------------------------------------------
    // 3. REQUIRED ENTITY VALIDATION
    // -------------------------------------------------

    if (
        !Array.isArray(requiredEntities) ||
        requiredEntities.length > 30 ||
        !requiredEntities.every(
            (item) =>
                typeof item === 'string' &&
                item.trim().length > 0
        )
    ) {

        throw new TypeError(
            'Invalid required entities.'
        );

    }


    // -------------------------------------------------
    // 4. CONVERSATION SUMMARY VALIDATION
    // -------------------------------------------------

    if (
        conversationSummary !== null &&
        (
            typeof conversationSummary !== 'string' ||
            conversationSummary.length > 3000
        )
    ) {

        throw new TypeError(
            'Invalid conversation summary.'
        );

    }


    // -------------------------------------------------
    // 5. KNOWLEDGE BASE VALIDATION
    // -------------------------------------------------

    if (typeof knowledgeBaseEnabled !== 'boolean') {

        throw new TypeError(
            'knowledgeBaseEnabled must be a boolean.'
        );

    }


    if (
        knowledgeContext !== null &&
        (
            typeof knowledgeContext !== 'string' ||
            knowledgeContext.length > MAX_KNOWLEDGE_CONTEXT_LENGTH
        )
    ) {

        throw new TypeError(
            'Invalid knowledge context.'
        );

    }


    if (
        !knowledgeBaseEnabled &&
        knowledgeContext !== null
    ) {

        throw new TypeError(
            'Knowledge context cannot be supplied when the Knowledge Base is disabled.'
        );

    }


    // -------------------------------------------------
    // 6. BUILD ORCHESTRATOR PAYLOAD
    // -------------------------------------------------

    const payload = {

        message: message.trim(),

        history: normalizeHistory(history),

        domain,

        required_entities: requiredEntities,

        conversation_summary: conversationSummary,

        knowledge_base_enabled: knowledgeBaseEnabled,

        knowledge_context: knowledgeContext

    };


    // -------------------------------------------------
    // 7. CALL AI ORCHESTRATOR
    // -------------------------------------------------

    let response;

    try {

        response = await fetch(
            `${env.aiServiceUrl}/api/v1/orchestrator/run`,
            {

                method: 'POST',

                headers: {

                    'Content-Type': 'application/json',

                    'Authorization':
                        `Bearer ${env.aiServiceApiKey}`

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


    // -------------------------------------------------
    // 8. HANDLE HTTP ERRORS
    // -------------------------------------------------

    if (!response.ok) {

        console.error(
            `AI Service returned HTTP ${response.status}.`
        );

        throw new Error(
            'The AI service could not process the request.'
        );

    }


    // -------------------------------------------------
    // 9. PARSE RESPONSE
    // -------------------------------------------------

    let result;

    try {

        result = await response.json();

    } catch {

        throw new Error(
            'The AI service returned an invalid response.'
        );

    }


    // -------------------------------------------------
    // 10. VALIDATE RESPONSE
    // -------------------------------------------------

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