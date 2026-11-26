import { pool } from '../config/database.js';

import {
    autoAssignTicket
} from './ticket-routing.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// PRIORITY CONFIGURATION
// =====================================================

const PRIORITY_CONFIG = {

    urgent: {
        score: 95,
        severity: 'critical',
        slaHours: 1
    },

    high: {
        score: 75,
        severity: 'high',
        slaHours: 4
    },

    medium: {
        score: 50,
        severity: 'medium',
        slaHours: 24
    },

    low: {
        score: 20,
        severity: 'low',
        slaHours: 72
    }

};


// =====================================================
// ERROR FACTORY
// =====================================================

const createError = (message, statusCode) => {

    const error = new Error(message);

    error.statusCode = statusCode;

    return error;

};


// =====================================================
// INPUT NORMALIZATION
// =====================================================

const normalizeTicketInput = ({
    title,
    description,
    category,
    priority,
    severity,
    priorityScore
}) => {

    const normalizedPriority =
        String(priority ?? 'medium').toLowerCase();

    if (!PRIORITY_CONFIG[normalizedPriority]) {

        throw createError(
            'Invalid ticket priority.',
            400
        );

    }

    const config = PRIORITY_CONFIG[normalizedPriority];

    const normalizedCategory =
        String(category ?? 'general')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

    if (!normalizedCategory) {

        throw createError(
            'Ticket category is required.',
            400
        );

    }

    const normalizedSeverity =
        severity ?? config.severity;

    if (
        !['critical', 'high', 'medium', 'low']
            .includes(normalizedSeverity)
    ) {

        throw createError(
            'Invalid ticket severity.',
            400
        );

    }

    const normalizedScore =
        priorityScore ?? config.score;

    if (
        !Number.isInteger(normalizedScore) ||
        normalizedScore < 0 ||
        normalizedScore > 100
    ) {

        throw createError(
            'Priority score must be between 0 and 100.',
            400
        );

    }

    return {

        title: title.trim(),

        description:
            typeof description === 'string'
                ? description.trim()
                : null,

        category: normalizedCategory,

        priority: normalizedPriority,

        severity: normalizedSeverity,

        priorityScore: normalizedScore,

        slaHours: config.slaHours

    };

};


// =====================================================
// CREATE TICKET AND ROUTE
// =====================================================

export const createTicketFromConversation = async ({

    organizationId,

    memberId,

    conversationId,

    intakeRequestId,

    title,

    description = '',

    category = 'general',

    priority = 'medium',

    severity,

    priorityScore,

    autoAssign = true

}) => {

    // -------------------------------------------------
    // 1. VALIDATE IDENTIFIERS
    // -------------------------------------------------

    if (
        !UUID_REGEX.test(organizationId ?? '') ||
        !UUID_REGEX.test(memberId ?? '') ||
        !UUID_REGEX.test(conversationId ?? '') ||
        !UUID_REGEX.test(intakeRequestId ?? '')
    ) {

        throw createError(
            'Invalid ticket intake identifiers.',
            400
        );

    }


    // -------------------------------------------------
    // 2. VALIDATE TICKET CONTENT
    // -------------------------------------------------

    if (
        typeof title !== 'string' ||
        !title.trim() ||
        title.trim().length > 200
    ) {

        throw createError(
            'Ticket title must contain 1–200 characters.',
            400
        );

    }

    if (
        typeof description !== 'string' ||
        description.length > 10000
    ) {

        throw createError(
            'Ticket description cannot exceed 10000 characters.',
            400
        );

    }

    if (typeof autoAssign !== 'boolean') {

        throw createError(
            'autoAssign must be a boolean.',
            400
        );

    }


    const normalized = normalizeTicketInput({

        title,

        description,

        category,

        priority,

        severity,

        priorityScore

    });


    // -------------------------------------------------
    // 3. CREATE TICKET TRANSACTIONALLY
    // -------------------------------------------------

    const client = await pool.connect();

    let ticket;
    let created = false;

    try {

        await client.query('BEGIN');


        // Verify the conversation belongs to this tenant.
        const conversationResult = await client.query(

            `
                SELECT
                    id,
                    organization_id,
                    chatbot_id,
                    status

                FROM public.conversations

                WHERE id = $1
                  AND organization_id = $2

                FOR UPDATE;
            `,

            [
                conversationId,
                organizationId
            ]

        );


        if (conversationResult.rowCount === 0) {

            throw createError(
                'Conversation not found.',
                404
            );

        }


        const conversation = conversationResult.rows[0];


        if (
            ['resolved', 'closed'].includes(conversation.status)
        ) {

            throw createError(
                'Cannot create a ticket from a closed conversation.',
                409
            );

        }


        // Verify the requesting organization member.
        const memberResult = await client.query(

            `
                SELECT id

                FROM public.organization_members

                WHERE id = $1
                  AND organization_id = $2
                  AND status = 'active'

                LIMIT 1;
            `,

            [
                memberId,
                organizationId
            ]

        );


        if (memberResult.rowCount === 0) {

            throw createError(
                'Organization member is not authorized.',
                403
            );

        }


        // Idempotent ticket insertion.
        const insertResult = await client.query(

            `
                INSERT INTO public.tickets (

                    organization_id,

                    conversation_id,

                    created_by_member_id,

                    intake_request_id,

                    title,

                    description,

                    category,

                    priority,

                    severity,

                    priority_score,

                    sla_due_at

                )

                VALUES (

                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    NOW() + ($11 * INTERVAL '1 hour')

                )

                ON CONFLICT (
                    organization_id,
                    intake_request_id
                )
                WHERE intake_request_id IS NOT NULL

                DO NOTHING

                RETURNING *;
            `,

            [

                organizationId,

                conversationId,

                memberId,

                intakeRequestId,

                normalized.title,

                normalized.description,

                normalized.category,

                normalized.priority,

                normalized.severity,

                normalized.priorityScore,

                normalized.slaHours

            ]

        );


        if (insertResult.rowCount > 0) {

            ticket = insertResult.rows[0];

            created = true;

        } else {

            // Retrieve the existing ticket for this request.
            const existingResult = await client.query(

                `
                    SELECT *

                    FROM public.tickets

                    WHERE organization_id = $1
                      AND intake_request_id = $2

                    LIMIT 1;
                `,

                [
                    organizationId,
                    intakeRequestId
                ]

            );


            if (existingResult.rowCount === 0) {

                throw new Error(
                    'Unable to retrieve idempotent ticket.'
                );

            }


            ticket = existingResult.rows[0];


            // Do not allow one idempotency key to be reused
            // for a different conversation.
            if (
                ticket.conversation_id !== conversationId
            ) {

                throw createError(
                    'Idempotency key belongs to another conversation.',
                    409
                );

            }

        }


        await client.query('COMMIT');


    } catch (error) {

        await client.query('ROLLBACK');

        throw error;

    } finally {

        client.release();

    }


    // -------------------------------------------------
    // 4. AUTOMATIC ROUTING
    // -------------------------------------------------

    let routing = {

        assigned: false,

        reason: 'automatic_assignment_disabled'

    };


    if (autoAssign) {

        try {

            routing = await autoAssignTicket({

                ticketId: ticket.id,

                organizationId,

                assignedByMemberId: memberId

            });

        } catch (error) {

            // Ticket creation is already committed.
            // Preserve the ticket even if routing fails.

            routing = {

                assigned: false,

                reason: 'routing_failed',

                error: error.message

            };

        }

    }


    // -------------------------------------------------
    // 5. RETURN RESULT
    // -------------------------------------------------

    return {

        created,

        ticket,

        routing,

        idempotent: !created

    };

};