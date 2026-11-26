import { env } from '../config/env.js';

const AI_TIMEOUT_MS = 20000;

const VALID_STATUSES = new Set([
    'response_generated',
    'clarification_required',
    'handoff_required',
    'agent_routing_required',
    'generation_failed'
]);

export const runTicketOrchestration = async ({
    message,
    history = [],
    domain = 'general'
}) => {

    if (
        typeof message !== 'string' ||
        !message.trim()
    ) {
        throw new TypeError(
            'A valid customer message is required.'
        );
    }

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

                body: JSON.stringify({
                    message: message.trim(),
                    history,
                    domain
                }),

                signal: AbortSignal.timeout(
                    AI_TIMEOUT_MS
                )
            }
        );

    } catch (error) {

        console.error(
            'Ticket orchestration communication failed:',
            error.message
        );

        throw new Error(
            'Unable to communicate with the AI orchestration service.'
        );

    }


    if (!response.ok) {

        console.error(
            `AI orchestrator returned HTTP ${response.status}.`
        );

        const error = new Error(
            'AI orchestration request failed.'
        );

        error.statusCode = response.status === 422
            ? 422
            : 503;

        throw error;

    }


    let result;

    try {

        result = await response.json();

    } catch {

        throw new Error(
            'AI orchestrator returned invalid JSON.'
        );

    }


    if (
        !result ||
        typeof result !== 'object' ||
        !VALID_STATUSES.has(result.status) ||
        !result.intent ||
        !result.routing ||
        !result.hybrid_decision
    ) {

        throw new Error(
            'AI orchestrator returned an invalid response structure.'
        );

    }


    if (
        result.ticket_triage !== null &&
        result.ticket_triage !== undefined
    ) {

        const triage = result.ticket_triage;

        if (
            typeof triage !== 'object' ||
            typeof triage.category !== 'string' ||
            typeof triage.priority !== 'string' ||
            typeof triage.severity !== 'string' ||
            !Number.isInteger(triage.priority_score) ||
            !Number.isInteger(
                triage.first_response_sla_hours
            ) ||
            !Number.isInteger(
                triage.resolution_sla_hours
            )
        ) {

            throw new Error(
                'AI orchestrator returned invalid ticket triage data.'
            );

        }

    }


    return result;

};