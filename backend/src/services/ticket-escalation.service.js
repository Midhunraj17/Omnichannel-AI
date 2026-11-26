import { pool } from '../config/database.js';

import {
    evaluateTicketEscalationWithAI
} from './ticket-escalation-ai.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const SEVERITY_FALLBACK = {

    urgent: 'critical',

    high: 'high',

    medium: 'medium',

    low: 'low'

};


const createError = (
    message,
    statusCode
) => {

    const error = new Error(message);

    error.statusCode = statusCode;

    return error;

};


// =====================================================
// FETCH TICKET
// =====================================================

const fetchTicket = async ({
    ticketId,
    organizationId
}) => {

    const result = await pool.query(

        `
            SELECT

                id,
                organization_id,
                title,
                description,
                status,
                priority,
                severity,
                created_at,
                first_response_at,
                sla_due_at,
                first_response_sla_hours,
                resolution_sla_hours,
                escalation_required,
                escalation_level,
                assigned_agent_id

            FROM public.tickets

            WHERE id = $1
              AND organization_id = $2

            LIMIT 1;
        `,

        [
            ticketId,
            organizationId
        ]

    );

    return result.rows[0] ?? null;

};


// =====================================================
// BUILD AI REQUEST
// =====================================================

const buildEscalationPayload = (ticket) => {

    const priority =
        String(ticket.priority).toLowerCase();

    return {

        ticket_id: ticket.id,

        status: ticket.status,

        priority,

        severity:
            ticket.severity ??
            SEVERITY_FALLBACK[priority] ??
            'medium',

        created_at:
            new Date(ticket.created_at).toISOString(),

        first_response_at:
            ticket.first_response_at
                ? new Date(
                    ticket.first_response_at
                ).toISOString()
                : null,

        sla_due_at:
            ticket.sla_due_at
                ? new Date(
                    ticket.sla_due_at
                ).toISOString()
                : null,

        first_response_sla_hours:
            ticket.first_response_sla_hours ?? null,

        resolution_sla_hours:
            ticket.resolution_sla_hours ?? null,

        escalation_required:
            Boolean(ticket.escalation_required),

        current_escalation_level:
            Number(ticket.escalation_level ?? 0)

    };

};


// =====================================================
// PERSIST ESCALATION RESULT
// =====================================================

const persistEscalationResult = async ({
    ticketId,
    organizationId,
    result
}) => {

    const client = await pool.connect();

    try {

        await client.query('BEGIN');


        // ---------------------------------------------
        // 1. LOCK CURRENT TICKET
        // ---------------------------------------------

        const lockedResult = await client.query(

            `
                SELECT

                    id,
                    status,
                    escalation_level,
                    escalation_required

                FROM public.tickets

                WHERE id = $1
                  AND organization_id = $2

                FOR UPDATE;
            `,

            [
                ticketId,
                organizationId
            ]

        );


        if (lockedResult.rowCount === 0) {

            throw createError(
                'Ticket not found.',
                404
            );

        }


        const currentTicket =
            lockedResult.rows[0];


        // ---------------------------------------------
        // 2. PREVENT ESCALATION OF TERMINAL TICKETS
        // ---------------------------------------------

        if (
            ['resolved', 'closed'].includes(
                currentTicket.status
            )
        ) {

            await client.query('ROLLBACK');

            return {

                applied: false,

                reason: 'ticket_terminal_state',

                ticketId

            };

        }


        const currentLevel = Number(
            currentTicket.escalation_level ?? 0
        );


        const recommendedLevel = Number(
            result.recommended_escalation_level
        );


        // ---------------------------------------------
        // 3. MONOTONIC ESCALATION
        // ---------------------------------------------

        const finalLevel = Math.max(
            currentLevel,
            recommendedLevel
        );


        const escalationIncreased =
            finalLevel > currentLevel;


        // ---------------------------------------------
        // 4. UPDATE TICKET
        // ---------------------------------------------

        await client.query(

            `
                UPDATE public.tickets

                SET

                    escalation_level = $1,

                    escalation_required = (
                        escalation_required OR $2
                    ),

                    escalation_reason_codes = $3::JSONB,

                    escalation_target = $4,

                    escalation_evaluated_at = NOW(),

                    updated_at = NOW()

                WHERE id = $5
                  AND organization_id = $6;
            `,

            [

                finalLevel,

                Boolean(
                    result.escalation_required
                ),

                JSON.stringify(
                    result.reason_codes
                ),

                result.escalation_target,

                ticketId,

                organizationId

            ]

        );


        // ---------------------------------------------
        // 5. CREATE AUDIT COMMENT
        // ---------------------------------------------

        if (escalationIncreased) {

            const auditData = {

                escalation_level: finalLevel,

                escalation_target:
                    result.escalation_target,

                escalation_reason:
                    result.escalation_reason,

                reason_codes:
                    result.reason_codes,

                evaluation_timestamp:
                    result.evaluation_timestamp

            };


            await client.query(

                `
                    INSERT INTO public.ticket_comments (

                        ticket_id,

                        author_member_id,

                        author_type,

                        body

                    )

                    VALUES (

                        $1,

                        NULL,

                        'system',

                        $2

                    );
                `,

                [

                    ticketId,

                    JSON.stringify({

                        event: 'TICKET_ESCALATED',

                        ...auditData

                    })

                ]

            );

        }


        await client.query('COMMIT');


        return {

            applied: true,

            escalationIncreased,

            previousEscalationLevel: currentLevel,

            escalationLevel: finalLevel,

            escalationTarget:
                result.escalation_target,

            notificationRecommended:
                Boolean(
                    result.notification_recommended
                ),

            notificationDispatched: false,

            reassignmentRecommended:
                Boolean(
                    result.reassignment_recommended
                ),

            reassignmentExecuted: false

        };


    } catch (error) {

        await client.query('ROLLBACK');

        throw error;

    } finally {

        client.release();

    }

};


// =====================================================
// SERVICE FACTORY
// =====================================================

export const createTicketEscalationService = ({

    fetchTicketFn = fetchTicket,

    evaluateFn =
        evaluateTicketEscalationWithAI,

    persistFn = persistEscalationResult

} = {}) => {

    return async ({
        ticketId,
        organizationId
    }) => {

        // ---------------------------------------------
        // 1. VALIDATE IDENTIFIERS
        // ---------------------------------------------

        if (
            !UUID_REGEX.test(ticketId ?? '') ||
            !UUID_REGEX.test(organizationId ?? '')
        ) {

            throw createError(
                'Invalid ticket or organization ID.',
                400
            );

        }


        // ---------------------------------------------
        // 2. LOAD TICKET
        // ---------------------------------------------

        const ticket = await fetchTicketFn({

            ticketId,

            organizationId

        });


        if (!ticket) {

            throw createError(
                'Ticket not found.',
                404
            );

        }


        // ---------------------------------------------
        // 3. TERMINAL STATE CHECK
        // ---------------------------------------------

        if (
            ['resolved', 'closed'].includes(
                ticket.status
            )
        ) {

            return {

                success: true,

                ticketId,

                applied: false,

                reason: 'ticket_terminal_state'

            };

        }


        // ---------------------------------------------
        // 4. CALL AI ENGINE
        // ---------------------------------------------

        const payload =
            buildEscalationPayload(ticket);


        const evaluation = await evaluateFn(
            payload
        );


        if (
            evaluation.ticket_id !== ticketId
        ) {

            throw new Error(
                'Escalation AI returned a mismatched ticket ID.'
            );

        }


        // ---------------------------------------------
        // 5. PERSIST RESULT
        // ---------------------------------------------

        const persistence = await persistFn({

            ticketId,

            organizationId,

            result: evaluation

        });


        // ---------------------------------------------
        // 6. FINAL RESPONSE
        // ---------------------------------------------

        return {

            success: true,

            ticketId,

            evaluation,

            persistence

        };

    };

};


// =====================================================
// PRODUCTION SERVICE
// =====================================================

export const evaluateAndApplyTicketEscalation =
    createTicketEscalationService();