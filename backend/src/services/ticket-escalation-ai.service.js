import { env } from '../config/env.js';

const AI_TIMEOUT_MS = 15000;

export const evaluateTicketEscalationWithAI = async (
    ticketData
) => {

    if (
        !ticketData ||
        typeof ticketData !== 'object'
    ) {
        throw new TypeError(
            'Valid ticket data is required.'
        );
    }

    let response;

    try {

        response = await fetch(
            `${env.aiServiceUrl}/api/v1/tickets/escalation/evaluate`,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',

                    'Authorization':
                        `Bearer ${env.aiServiceApiKey}`
                },

                body: JSON.stringify(ticketData),

                signal: AbortSignal.timeout(
                    AI_TIMEOUT_MS
                )
            }
        );

    } catch (error) {

        console.error(
            'Ticket escalation AI communication failed:',
            error.message
        );

        throw new Error(
            'Unable to communicate with the escalation AI service.'
        );

    }


    if (!response.ok) {

        const status = response.status;

        console.error(
            `Escalation AI returned HTTP ${status}.`
        );

        throw new Error(
            `Escalation AI request failed with status ${status}.`
        );

    }


    let result;

    try {

        result = await response.json();

    } catch {

        throw new Error(
            'Escalation AI returned invalid JSON.'
        );

    }


    if (
        !result ||
        typeof result !== 'object' ||
        result.success !== true ||
        typeof result.ticket_id !== 'string' ||
        !Number.isInteger(
            result.recommended_escalation_level
        ) ||
        result.recommended_escalation_level < 0 ||
        result.recommended_escalation_level > 3 ||
        !Array.isArray(result.reason_codes) ||
        typeof result.escalation_target !== 'string'
    ) {

        throw new Error(
            'Escalation AI returned an invalid response structure.'
        );

    }


    return result;

};