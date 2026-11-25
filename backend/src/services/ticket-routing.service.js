import { pool } from '../config/database.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// CATEGORY → AGENT SKILL MAPPING
// =====================================================

const CATEGORY_SKILLS = {
    technical: ['technical', 'technology', 'software', 'bug'],
    billing: ['billing', 'payment', 'invoice', 'refund'],
    delivery: ['delivery', 'shipping', 'logistics'],
    order: ['order', 'orders', 'order_management'],
    account: ['account', 'authentication', 'login'],
    product: ['product', 'product_support'],
    general: ['general', 'customer_support']
};


const normalizeCategory = (category) => {
    if (typeof category !== 'string') {
        return null;
    }

    return category
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
};


const getRequiredSkills = (category) => {
    const normalized = normalizeCategory(category);

    if (!normalized) {
        return [];
    }

    return [
        ...new Set([
            normalized,
            ...(CATEGORY_SKILLS[normalized] ?? [])
        ])
    ];
};


// =====================================================
// PRIORITY RANKING
// =====================================================

const PRIORITY_RANK = {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4
};


// =====================================================
// ERROR FACTORY
// =====================================================

const createRoutingError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;

    return error;
};


// =====================================================
// AUTOMATIC TICKET ASSIGNMENT
// =====================================================

export const autoAssignTicket = async ({
    ticketId,
    organizationId,
    assignedByMemberId
}) => {

    if (
        !UUID_REGEX.test(ticketId ?? '') ||
        !UUID_REGEX.test(organizationId ?? '') ||
        !UUID_REGEX.test(assignedByMemberId ?? '')
    ) {
        throw createRoutingError(
            'Invalid routing identifiers.',
            400
        );
    }

    const client = await pool.connect();

    try {

        await client.query('BEGIN');


        // -------------------------------------------------
        // 1. LOCK AND VALIDATE TICKET
        // -------------------------------------------------

        const ticketResult = await client.query(
            `
                SELECT
                    id,
                    organization_id,
                    conversation_id,
                    assigned_agent_id,
                    status,
                    priority,
                    category,
                    severity,
                    priority_score

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


        if (ticketResult.rowCount === 0) {

            throw createRoutingError(
                'Ticket not found.',
                404
            );

        }


        const ticket = ticketResult.rows[0];


        // -------------------------------------------------
        // 2. CHECK EXISTING ASSIGNMENT
        // -------------------------------------------------

        if (ticket.assigned_agent_id) {

            await client.query('COMMIT');

            return {
                assigned: false,
                reason: 'already_assigned',
                ticketId: ticket.id,
                assignedAgentId: ticket.assigned_agent_id
            };

        }


        if (
            ['resolved', 'closed'].includes(ticket.status)
        ) {

            throw createRoutingError(
                'Resolved or closed tickets cannot be assigned.',
                409
            );

        }


        // -------------------------------------------------
        // 3. DETERMINE REQUIRED SKILLS
        // -------------------------------------------------

        const requiredSkills = getRequiredSkills(
            ticket.category
        );


        // -------------------------------------------------
        // 4. FIND BEST AVAILABLE AGENT
        // -------------------------------------------------

        const candidateResult = await client.query(
            `
                SELECT

                    sa.id AS support_agent_id,

                    sa.organization_member_id,

                    sa.skills,

                    sa.max_active_tickets,

                    sa.last_assigned_at,

                    (
                        SELECT COUNT(*)
                        FROM public.tickets active_ticket

                        WHERE active_ticket.assigned_agent_id = sa.id

                          AND active_ticket.organization_id = $1

                          AND active_ticket.status IN (
                              'open',
                              'in_progress',
                              'pending'
                          )

                    )::INTEGER AS active_ticket_count

                FROM public.support_agents sa

                INNER JOIN public.organization_members om
                    ON om.id = sa.organization_member_id

                WHERE om.organization_id = $1

                  AND om.status = 'active'

                  AND om.role = 'support_agent'

                  AND sa.availability_status = 'available'

                  AND (
                      cardinality($2::TEXT[]) = 0

                      OR EXISTS (
                          SELECT 1
                          FROM unnest(sa.skills) AS skill

                          WHERE LOWER(TRIM(skill))
                              = ANY($2::TEXT[])
                      )
                  )

                  AND (
                      SELECT COUNT(*)
                      FROM public.tickets active_ticket

                      WHERE active_ticket.assigned_agent_id = sa.id

                        AND active_ticket.organization_id = $1

                        AND active_ticket.status IN (
                            'open',
                            'in_progress',
                            'pending'
                        )

                  ) < sa.max_active_tickets

                ORDER BY

                    active_ticket_count ASC,

                    sa.last_assigned_at ASC NULLS FIRST,

                    sa.created_at ASC,

                    sa.id ASC

                LIMIT 1

                FOR UPDATE OF sa SKIP LOCKED;
            `,
            [
                organizationId,
                requiredSkills
            ]
        );


        // -------------------------------------------------
        // 5. FALLBACK: NO ELIGIBLE AGENT
        // -------------------------------------------------

        if (candidateResult.rowCount === 0) {

            await client.query('COMMIT');

            return {
                assigned: false,
                reason: 'no_eligible_agent',
                ticketId: ticket.id,
                requiredSkills
            };

        }


        const agent = candidateResult.rows[0];


        // -------------------------------------------------
        // 6. VERIFY AGENT MEMBERSHIP AGAIN
        // -------------------------------------------------

        if (
            agent.organization_member_id ===
            assignedByMemberId
        ) {

            // Self-assignment is not prohibited here.
            // The assignedByMemberId is the requesting
            // manager, not the selected agent.
        }


        // -------------------------------------------------
        // 7. UPDATE TICKET
        // -------------------------------------------------

        await client.query(
            `
                UPDATE public.tickets

                SET

                    assigned_agent_id = $1,

                    status = CASE
                        WHEN status = 'open'
                        THEN 'in_progress'
                        ELSE status
                    END,

                    updated_at = NOW()

                WHERE id = $2
                  AND organization_id = $3;
            `,
            [
                agent.support_agent_id,
                ticket.id,
                organizationId
            ]
        );


        // -------------------------------------------------
        // 8. CLOSE PREVIOUS ACTIVE HISTORY
        // -------------------------------------------------

        await client.query(
            `
                UPDATE public.ticket_assignments

                SET unassigned_at = NOW()

                WHERE ticket_id = $1
                  AND unassigned_at IS NULL;
            `,
            [ticket.id]
        );


        // -------------------------------------------------
        // 9. INSERT ASSIGNMENT HISTORY
        // -------------------------------------------------

        const assignmentResult = await client.query(
            `
                INSERT INTO public.ticket_assignments (

                    ticket_id,

                    support_agent_id,

                    assigned_by_member_id,

                    assignment_strategy,

                    assignment_reason

                )

                VALUES ($1, $2, $3, $4, $5)

                RETURNING
                    id,
                    ticket_id,
                    support_agent_id,
                    assigned_at;
            `,
            [
                ticket.id,
                agent.support_agent_id,
                assignedByMemberId,
                'automatic',
                `Category: ${ticket.category ?? 'general'}; ` +
                `Active workload before assignment: ${agent.active_ticket_count}`
            ]
        );


        // -------------------------------------------------
        // 10. UPDATE AGENT FAIRNESS TIMESTAMP
        // -------------------------------------------------

        await client.query(
            `
                UPDATE public.support_agents

                SET last_assigned_at = NOW()

                WHERE id = $1;
            `,
            [agent.support_agent_id]
        );


        // -------------------------------------------------
        // 11. SYNCHRONIZE CONVERSATION ASSIGNMENT
        // -------------------------------------------------

        if (ticket.conversation_id) {

            await client.query(
                `
                    UPDATE public.conversations

                    SET assigned_agent_id = $1

                    WHERE id = $2
                      AND organization_id = $3;
                `,
                [
                    agent.support_agent_id,
                    ticket.conversation_id,
                    organizationId
                ]
            );

        }


        // -------------------------------------------------
        // 12. COMMIT TRANSACTION
        // -------------------------------------------------

        await client.query('COMMIT');


        return {

            assigned: true,

            ticketId: ticket.id,

            assignedAgent: {

                id: agent.support_agent_id,

                memberId: agent.organization_member_id,

                activeTicketsBeforeAssignment:
                    agent.active_ticket_count,

                maxActiveTickets:
                    agent.max_active_tickets

            },

            assignment: assignmentResult.rows[0],

            routing: {

                strategy: 'skill_workload_round_robin',

                requiredSkills,

                priority: ticket.priority,

                priorityRank:
                    PRIORITY_RANK[ticket.priority] ?? 3

            }

        };


    } catch (error) {

        await client.query('ROLLBACK');

        throw error;

    } finally {

        client.release();

    }

};