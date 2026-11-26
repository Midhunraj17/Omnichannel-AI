import { pool } from '../config/database.js';

// =====================================================
// CONSTANTS
// =====================================================

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVE_TICKET_STATUSES = [
    'open',
    'in_progress',
    'pending'
];

const ASSIGNABLE_TICKET_STATUSES = [
    'open',
    'in_progress',
    'pending'
];

const PRIORITY_FALLBACK_SCORES = {
    urgent: 95,
    high: 75,
    medium: 50,
    low: 20
};

const PRIORITY_RANK = {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4
};

// =====================================================
// CATEGORY → AGENT SKILL MAPPING
// =====================================================

const CATEGORY_SKILLS = {

    // Order-related tickets
    order: [
        'order',
        'orders',
        'order_management',
        'tracking'
    ],

    order_tracking: [
        'order',
        'orders',
        'tracking',
        'delivery',
        'shipping'
    ],

    // Payment and financial tickets
    payment: [
        'payment',
        'billing',
        'invoice',
        'finance'
    ],

    payment_issue: [
        'payment',
        'billing',
        'invoice',
        'finance'
    ],

    billing: [
        'billing',
        'payment',
        'invoice',
        'refund'
    ],

    refund: [
        'refund',
        'billing',
        'payment'
    ],

    return: [
        'returns',
        'return',
        'refund',
        'product'
    ],

    // Account-related tickets
    account: [
        'account',
        'authentication',
        'login',
        'security'
    ],

    account_access: [
        'account',
        'authentication',
        'login',
        'security'
    ],

    // Technical tickets
    technical: [
        'technical',
        'technology',
        'software',
        'bug',
        'development'
    ],

    technical_issue: [
        'technical',
        'technology',
        'software',
        'bug',
        'development'
    ],

    // Product-related tickets
    product: [
        'product',
        'product_support',
        'returns'
    ],

    product_issue: [
        'product',
        'product_support',
        'returns'
    ],

    // Service-related tickets
    service: [
        'service',
        'customer_support',
        'operations'
    ],

    service_issue: [
        'service',
        'customer_support',
        'operations'
    ],

    // Complaints
    complaint: [
        'complaint',
        'customer_support',
        'service'
    ],

    // General support
    general: [
        'general',
        'customer_support'
    ],

    other: [
        'general',
        'customer_support'
    ]

};

// =====================================================
// NORMALIZATION
// =====================================================

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


const normalizePriority = (priority) => {

    if (typeof priority !== 'string') {
        return 'medium';
    }

    const normalized = priority
        .trim()
        .toLowerCase();

    if (normalized.startsWith('p1')) {
        return 'urgent';
    }

    if (normalized.startsWith('p2')) {
        return 'high';
    }

    if (normalized.startsWith('p3')) {
        return 'medium';
    }

    if (normalized.startsWith('p4')) {
        return 'low';
    }

    return Object.hasOwn(
        PRIORITY_RANK,
        normalized
    )
        ? normalized
        : 'medium';

};


// =====================================================
// REQUIRED SKILLS
// =====================================================

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
// PRIORITY SCORE
// =====================================================

const getTicketPriorityScore = (ticket) => {

    const priority = normalizePriority(
        ticket.priority
    );

    const fallbackScore =
        PRIORITY_FALLBACK_SCORES[priority];

    const storedScore = Number(
        ticket.priority_score
    );

    if (
        !Number.isInteger(storedScore) ||
        storedScore < 0 ||
        storedScore > 100
    ) {
        return fallbackScore;
    }

    return Math.max(
        storedScore,
        fallbackScore
    );

};


// =====================================================
// ERROR FACTORY
// =====================================================

const createRoutingError = (
    message,
    statusCode
) => {

    const error = new Error(message);

    error.statusCode = statusCode;

    return error;

};


// =====================================================
// SQL: FETCH AND LOCK TICKET
// =====================================================

const FETCH_TICKET_QUERY = `

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

`;


// =====================================================
// SQL: SELECT BEST AVAILABLE AGENT
// =====================================================

const FIND_BEST_AGENT_QUERY = `

    SELECT

        sa.id AS support_agent_id,

        sa.organization_member_id,

        sa.skills,

        sa.max_active_tickets,

        sa.last_assigned_at,

        sa.created_at,

        workload.active_ticket_count,

        skill_match.matched_skills,

        (
            workload.active_ticket_count::NUMERIC
            /
            NULLIF(sa.max_active_tickets, 0)
        ) AS workload_ratio

    FROM public.support_agents sa

    INNER JOIN public.organization_members om

        ON om.id = sa.organization_member_id

    CROSS JOIN LATERAL (

        SELECT

            COUNT(*)::INTEGER AS active_ticket_count

        FROM public.tickets active_ticket

        WHERE active_ticket.assigned_agent_id = sa.id

          AND active_ticket.organization_id = $1

          AND active_ticket.status = ANY($4::TEXT[])

    ) workload

    CROSS JOIN LATERAL (

        SELECT

            COALESCE(

                ARRAY(

                    SELECT DISTINCT required.skill

                    FROM unnest($2::TEXT[])
                        AS required(skill)

                    WHERE EXISTS (

                        SELECT 1

                        FROM unnest(sa.skills)
                            AS agent_skill(skill)

                        WHERE LOWER(
                            BTRIM(agent_skill.skill)
                        ) = required.skill

                    )

                ),

                ARRAY[]::TEXT[]

            ) AS matched_skills

    ) skill_match

    WHERE om.organization_id = $1

      AND om.status = 'active'

      AND om.role = 'support_agent'

      AND sa.availability_status = 'available'

      AND workload.active_ticket_count
            < sa.max_active_tickets

      AND (

          cardinality($2::TEXT[]) = 0

          OR cardinality(skill_match.matched_skills) > 0

      )

    ORDER BY

        CASE

            WHEN $3::INTEGER >= 80

             AND (

                workload.active_ticket_count::NUMERIC
                /
                NULLIF(sa.max_active_tickets, 0)

             ) < 0.80

            THEN 0

            WHEN $3::INTEGER >= 80

            THEN 1

            ELSE 0

        END ASC,

        cardinality(skill_match.matched_skills) DESC,

        workload.active_ticket_count::NUMERIC
            / NULLIF(sa.max_active_tickets, 0) ASC,

        sa.last_assigned_at ASC NULLS FIRST,

        sa.created_at ASC,

        sa.id ASC

    LIMIT 1

    FOR UPDATE OF sa SKIP LOCKED;

`;


// =====================================================
// SQL: UPDATE TICKET ASSIGNMENT
// =====================================================

const UPDATE_TICKET_QUERY = `

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

      AND organization_id = $3

      AND assigned_agent_id IS NULL

      AND status = ANY($4::TEXT[]);

`;


// =====================================================
// SQL: CLOSE PREVIOUS ASSIGNMENT HISTORY
// =====================================================

const CLOSE_ASSIGNMENT_HISTORY_QUERY = `

    UPDATE public.ticket_assignments

    SET unassigned_at = NOW()

    WHERE ticket_id = $1

      AND unassigned_at IS NULL;

`;


// =====================================================
// SQL: INSERT ASSIGNMENT HISTORY
// =====================================================

const INSERT_ASSIGNMENT_QUERY = `

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

        assigned_by_member_id,

        assigned_at;

`;


// =====================================================
// SQL: UPDATE AGENT FAIRNESS TIMESTAMP
// =====================================================

const UPDATE_AGENT_TIMESTAMP_QUERY = `

    UPDATE public.support_agents

    SET last_assigned_at = NOW()

    WHERE id = $1;

`;


// =====================================================
// SQL: SYNCHRONIZE CONVERSATION ASSIGNMENT
// =====================================================

const UPDATE_CONVERSATION_QUERY = `

    UPDATE public.conversations

    SET assigned_agent_id = $1

    WHERE id = $2

      AND organization_id = $3;

`;


// =====================================================
// ROUTING SERVICE FACTORY
// =====================================================

export const createTicketRoutingService = ({

    dbPool = pool

} = {}) => {

    // -------------------------------------------------
    // AUTOMATIC ASSIGNMENT
    // -------------------------------------------------

    const autoAssignTicket = async ({

        ticketId,

        organizationId,

        assignedByMemberId

    }) => {

        // ---------------------------------------------
        // 1. VALIDATE IDENTIFIERS
        // ---------------------------------------------

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


        // ---------------------------------------------
        // 2. CONNECT TO DATABASE
        // ---------------------------------------------

        const client = await dbPool.connect();

        let transactionStarted = false;


        try {

            // -----------------------------------------
            // 3. START TRANSACTION
            // -----------------------------------------

            await client.query('BEGIN');

            transactionStarted = true;


            // -----------------------------------------
            // 4. FETCH AND LOCK TICKET
            // -----------------------------------------

            const ticketResult = await client.query(

                FETCH_TICKET_QUERY,

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


            // -----------------------------------------
            // 5. CHECK EXISTING ASSIGNMENT
            // -----------------------------------------

            if (ticket.assigned_agent_id) {

                await client.query('COMMIT');

                transactionStarted = false;

                return {

                    assigned: false,

                    reason: 'already_assigned',

                    ticketId: ticket.id,

                    assignedAgentId:
                        ticket.assigned_agent_id

                };

            }


            // -----------------------------------------
            // 6. VALIDATE TICKET STATUS
            // -----------------------------------------

            if (

                !ASSIGNABLE_TICKET_STATUSES.includes(
                    ticket.status
                )

            ) {

                throw createRoutingError(

                    'Resolved or closed tickets cannot be assigned.',

                    409

                );

            }


            // -----------------------------------------
            // 7. DETERMINE REQUIRED SKILLS
            // -----------------------------------------

            const requiredSkills = getRequiredSkills(
                ticket.category
            );


            // -----------------------------------------
            // 8. DETERMINE PRIORITY
            // -----------------------------------------

            const priority = normalizePriority(
                ticket.priority
            );

            const priorityScore = getTicketPriorityScore(
                ticket
            );


            // -----------------------------------------
            // 9. FIND BEST AVAILABLE AGENT
            // -----------------------------------------

            const candidateResult = await client.query(

                FIND_BEST_AGENT_QUERY,

                [

                    organizationId,

                    requiredSkills,

                    priorityScore,

                    ACTIVE_TICKET_STATUSES

                ]

            );


            // -----------------------------------------
            // 10. HANDLE NO ELIGIBLE AGENT
            // -----------------------------------------

            if (candidateResult.rowCount === 0) {

                await client.query('COMMIT');

                transactionStarted = false;

                return {

                    assigned: false,

                    reason: 'no_eligible_agent',

                    ticketId: ticket.id,

                    requiredSkills,

                    priority,

                    priorityScore

                };

            }


            const agent = candidateResult.rows[0];


            // -----------------------------------------
            // 11. UPDATE TICKET
            // -----------------------------------------

            const updateResult = await client.query(

                UPDATE_TICKET_QUERY,

                [

                    agent.support_agent_id,

                    ticket.id,

                    organizationId,

                    ASSIGNABLE_TICKET_STATUSES

                ]

            );


            if (updateResult.rowCount !== 1) {

                throw createRoutingError(

                    'Ticket assignment could not be completed.',

                    409

                );

            }


            // -----------------------------------------
            // 12. CLOSE PREVIOUS HISTORY
            // -----------------------------------------

            await client.query(

                CLOSE_ASSIGNMENT_HISTORY_QUERY,

                [
                    ticket.id
                ]

            );


            // -----------------------------------------
            // 13. GENERATE AUDIT REASON
            // -----------------------------------------

            const matchedSkills =
                agent.matched_skills ?? [];

            const workloadRatio = Number(
                agent.workload_ratio ?? 0
            );

            const workloadPercentage = Math.round(
                workloadRatio * 100
            );


            const assignmentReason = [

                `Category: ${ticket.category ?? 'general'}`,

                `Priority: ${priority}`,

                `Priority score: ${priorityScore}`,

                `Matched skills: ${
                    matchedSkills.join(', ') || 'general'
                }`,

                `Active workload: ${
                    agent.active_ticket_count
                }/${agent.max_active_tickets}`,

                `Workload utilization: ${
                    workloadPercentage
                }%`

            ].join('; ');


            // -----------------------------------------
            // 14. INSERT ASSIGNMENT HISTORY
            // -----------------------------------------

            const assignmentResult = await client.query(

                INSERT_ASSIGNMENT_QUERY,

                [

                    ticket.id,

                    agent.support_agent_id,

                    assignedByMemberId,

                    'automatic',

                    assignmentReason

                ]

            );


            if (assignmentResult.rowCount !== 1) {

                throw new Error(
                    'Assignment history could not be created.'
                );

            }


            // -----------------------------------------
            // 15. UPDATE AGENT FAIRNESS TIMESTAMP
            // -----------------------------------------

            await client.query(

                UPDATE_AGENT_TIMESTAMP_QUERY,

                [
                    agent.support_agent_id
                ]

            );


            // -----------------------------------------
            // 16. SYNCHRONIZE CONVERSATION
            // -----------------------------------------

            if (ticket.conversation_id) {

                const conversationResult = await client.query(

                    UPDATE_CONVERSATION_QUERY,

                    [

                        agent.support_agent_id,

                        ticket.conversation_id,

                        organizationId

                    ]

                );


                if (conversationResult.rowCount !== 1) {

                    throw createRoutingError(

                        'Conversation assignment could not be synchronized.',

                        409

                    );

                }

            }


            // -----------------------------------------
            // 17. COMMIT TRANSACTION
            // -----------------------------------------

            await client.query('COMMIT');

            transactionStarted = false;


            // -----------------------------------------
            // 18. RETURN RESULT
            // -----------------------------------------

            return {

                assigned: true,

                ticketId: ticket.id,

                assignedAgent: {

                    id: agent.support_agent_id,

                    memberId: agent.organization_member_id,

                    skills: agent.skills,

                    matchedSkills,

                    activeTicketsBeforeAssignment:
                        agent.active_ticket_count,

                    maxActiveTickets:
                        agent.max_active_tickets,

                    workloadUtilization:
                        workloadPercentage

                },

                assignment: assignmentResult.rows[0],

                routing: {

                    strategy: 'priority_skill_workload_fairness',

                    priority,

                    priorityScore,

                    priorityRank:
                        PRIORITY_RANK[priority],

                    requiredSkills,

                    matchedSkills

                }

            };


        } catch (error) {

            // -----------------------------------------
            // 19. ROLLBACK ON FAILURE
            // -----------------------------------------

            if (transactionStarted) {

                try {

                    await client.query('ROLLBACK');

                } catch (rollbackError) {

                    console.error(
                        'Ticket routing rollback failed:',
                        rollbackError
                    );

                }

            }

            throw error;


        } finally {

            // -----------------------------------------
            // 20. RELEASE DATABASE CONNECTION
            // -----------------------------------------

            client.release();

        }

    };


    return {

        autoAssignTicket

    };

};


// =====================================================
// PRODUCTION SERVICE
// =====================================================

const ticketRoutingService =
    createTicketRoutingService();


// Preserve the existing public API.
// ticket-intake.service.js already imports this function.

export const autoAssignTicket =
    ticketRoutingService.autoAssignTicket;