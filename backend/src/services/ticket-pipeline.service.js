import { pool } from '../config/database.js';

import {
    runTicketOrchestration
} from './ticket-orchestration-ai.service.js';

import {
    createTicketFromConversation
} from './ticket-intake.service.js';

import {
    evaluateAndApplyTicketEscalation
} from './ticket-escalation.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// PRIORITY MAPPING
// =====================================================

const PRIORITY_MAPPING = {

    P1_CRITICAL: 'urgent',

    P2_HIGH: 'high',

    P3_NORMAL: 'medium',

    P4_LOW: 'low'

};


// =====================================================
// SEVERITY MAPPING
// =====================================================

const normalizeSeverity = (severity) => {

    return String(severity ?? 'MEDIUM')
        .trim()
        .toLowerCase();

};


// =====================================================
// CATEGORY MAPPING
// =====================================================

const normalizeCategory = (category) => {

    return String(category ?? 'OTHER')
        .trim()
        .toLowerCase();

};


// =====================================================
// ERROR FACTORY
// =====================================================

const createError = (
    message,
    statusCode
) => {

    const error = new Error(message);

    error.statusCode = statusCode;

    return error;

};


// =====================================================
// FETCH CONVERSATION
// =====================================================

const loadConversationContext = async ({
    conversationId,
    organizationId
}) => {

    // -------------------------------------------------
    // 1. VERIFY CONVERSATION OWNERSHIP
    // -------------------------------------------------

    const conversationResult = await pool.query(

        `
            SELECT

                id,

                organization_id,

                chatbot_id,

                status

            FROM public.conversations

            WHERE id = $1
              AND organization_id = $2

            LIMIT 1;
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


    const conversation =
        conversationResult.rows[0];


    // -------------------------------------------------
    // 2. VERIFY CONVERSATION STATE
    // -------------------------------------------------

    if (
        ['resolved', 'closed'].includes(
            conversation.status
        )
    ) {

        throw createError(
            'Cannot process a closed conversation.',
            409
        );

    }


    // -------------------------------------------------
    // 3. FETCH RECENT CONVERSATION HISTORY
    // -------------------------------------------------

    const messagesResult = await pool.query(

        `
            SELECT

                sender_type,

                content,

                created_at

            FROM public.messages

            WHERE conversation_id = $1

            ORDER BY created_at DESC

            LIMIT 20;
        `,

        [
            conversationId
        ]

    );


    // -------------------------------------------------
    // 4. NORMALIZE HISTORY
    // -------------------------------------------------

    const history = messagesResult.rows

        .reverse()

        .filter(message => {

            return (

                ['customer', 'bot', 'agent', 'system']
                    .includes(message.sender_type)

                &&

                typeof message.content === 'string'

                &&

                message.content.trim().length > 0

            );

        })

        .map(message => ({

            sender_type: message.sender_type,

            content: message.content

        }));


    return {

        conversation,

        history

    };

};


// =====================================================
// PERSIST TICKET TRIAGE METADATA
// =====================================================

const persistTicketTriage = async ({
    ticketId,
    organizationId,
    triage
}) => {

    const priority =
        PRIORITY_MAPPING[triage.priority];


    if (!priority) {

        throw createError(
            'AI returned an unsupported ticket priority.',
            422
        );

    }


    const result = await pool.query(

        `
            UPDATE public.tickets

            SET

                subcategory = $1,

                classification_confidence = $2,

                classification_labels = $3::JSONB,

                classification_method = $4,

                requires_human_review = $5,

                impact_level = $6,

                urgency_level = $7,

                first_response_sla_hours = $8,

                resolution_sla_hours = $9,

                escalation_required = $10,

                priority_reason_codes = $11::JSONB,

                priority_score = $12,

                priority = $13,

                severity = $14,

                category = $15,

                sla_due_at = (
                    created_at +
                    ($16 * INTERVAL '1 hour')
                ),

                updated_at = NOW()

            WHERE id = $17

              AND organization_id = $18

            RETURNING

                id,

                priority,

                severity,

                priority_score,

                category,

                subcategory,

                escalation_required,

                first_response_sla_hours,

                resolution_sla_hours;
        `,

        [

            triage.subcategory,

            triage.confidence,

            JSON.stringify(
                triage.labels ?? []
            ),

            triage.classification_method,

            Boolean(
                triage.requires_human_review
            ),

            triage.impact_level,

            triage.urgency_level,

            triage.first_response_sla_hours,

            triage.resolution_sla_hours,

            Boolean(
                triage.escalation_required
            ),

            JSON.stringify(
                triage.priority_reason_codes ?? []
            ),

            triage.priority_score,

            priority,

            normalizeSeverity(
                triage.severity
            ),

            normalizeCategory(
                triage.category
            ),

            triage.resolution_sla_hours,

            ticketId,

            organizationId

        ]

    );


    if (result.rowCount !== 1) {

        throw createError(
            'Unable to persist ticket classification metadata.',
            409
        );

    }


    return result.rows[0];

};


// =====================================================
// TICKET PIPELINE SERVICE FACTORY
// =====================================================

export const createTicketPipelineService = ({

    loadConversationFn = loadConversationContext,

    orchestrateFn = runTicketOrchestration,

    createTicketFn = createTicketFromConversation,

    persistTriageFn = persistTicketTriage,

    escalateFn = evaluateAndApplyTicketEscalation

} = {}) => {


    return async ({

        organizationId,

        memberId,

        conversationId,

        intakeRequestId,

        message,

        title,

        domain = 'general',

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
                'Invalid ticket pipeline identifiers.',
                400
            );

        }


        // -------------------------------------------------
        // 2. VALIDATE MESSAGE
        // -------------------------------------------------

        if (

            typeof message !== 'string' ||

            !message.trim() ||

            message.trim().length > 10000

        ) {

            throw createError(
                'Customer message must contain 1–10000 characters.',
                400
            );

        }


        if (typeof autoAssign !== 'boolean') {

            throw createError(
                'autoAssign must be a boolean.',
                400
            );

        }


        // -------------------------------------------------
        // 3. LOAD CONVERSATION CONTEXT
        // -------------------------------------------------

        const context = await loadConversationFn({

            conversationId,

            organizationId

        });


        // -------------------------------------------------
        // 4. RUN AI ORCHESTRATION
        // -------------------------------------------------

        const orchestration = await orchestrateFn({

            message: message.trim(),

            history: context.history,

            domain

        });


        const triage =
            orchestration.ticket_triage;


        // -------------------------------------------------
        // 5. CHECK SUPPORT REQUIREMENT
        // -------------------------------------------------

        if (

            !triage ||

            triage.applicable !== true ||

            ![
                'agent_routing_required',
                'handoff_required'
            ].includes(orchestration.status)

        ) {

            return {

                success: true,

                pipelineStatus: 'no_ticket_required',

                ticketCreated: false,

                reason:
                    'The AI decision does not require ticket creation.',

                orchestration

            };

        }


        // -------------------------------------------------
        // 6. VALIDATE TRIAGE PRIORITY
        // -------------------------------------------------

        const priority =
            PRIORITY_MAPPING[triage.priority];


        if (!priority) {

            throw createError(
                'Unsupported AI ticket priority.',
                422
            );

        }


        // -------------------------------------------------
        // 7. DETERMINE TICKET TITLE
        // -------------------------------------------------

        const ticketTitle =

            typeof title === 'string' && title.trim()

                ? title.trim()

                : message.trim()
                    .split('\n')[0]
                    .slice(0, 200);


        // -------------------------------------------------
        // 8. CREATE AND ROUTE TICKET
        // -------------------------------------------------

        const ticketResult = await createTicketFn({

            organizationId,

            memberId,

            conversationId,

            intakeRequestId,

            title: ticketTitle,

            description: message.trim(),

            category: normalizeCategory(
                triage.category
            ),

            priority,

            severity: normalizeSeverity(
                triage.severity
            ),

            priorityScore:
                triage.priority_score,

            autoAssign

        });


        const ticket = ticketResult.ticket;


        if (!ticket?.id) {

            throw new Error(
                'Ticket intake did not return a valid ticket.'
            );

        }


        // -------------------------------------------------
        // 9. PERSIST CLASSIFICATION AND SLA METADATA
        // -------------------------------------------------

        const classification =
            await persistTriageFn({

                ticketId: ticket.id,

                organizationId,

                triage

            });


        // -------------------------------------------------
        // 10. RUN ESCALATION ENGINE
        // -------------------------------------------------

        let escalation = {

            evaluated: false,

            applied: false,

            reason: 'escalation_not_evaluated'

        };


        try {

            escalation = {

                evaluated: true,

                ...(await escalateFn({

                    ticketId: ticket.id,

                    organizationId

                }))

            };

        } catch (error) {

            // Ticket creation and classification have
            // already completed successfully.
            //
            // Preserve the ticket and report the failed
            // escalation stage separately.

            console.error(
                'Pipeline escalation stage failed:',
                error.message
            );

            escalation = {

                evaluated: false,

                applied: false,

                reason: 'escalation_evaluation_failed'

            };

        }


        // -------------------------------------------------
        // 11. FINAL PIPELINE STATUS
        // -------------------------------------------------

        const escalationSucceeded =
            escalation.evaluated === true;


        const pipelineStatus =
            escalationSucceeded
                ? 'completed'
                : 'partially_completed';


        // -------------------------------------------------
        // 12. FINAL RESULT
        // -------------------------------------------------

        return {

            success: true,

            pipelineStatus,

            ticketCreated: ticketResult.created,

            ticket: {

                id: ticket.id,

                title: ticket.title,

                status: ticket.status,

                priority: classification.priority,

                severity: classification.severity,

                category: classification.category,

                subcategory:
                    classification.subcategory

            },

            stages: {

                orchestration: {
                    completed: true
                },

                classification: {
                    completed: true,

                    confidence: triage.confidence,

                    method: triage.classification_method,

                    requiresHumanReview:
                        triage.requires_human_review

                },

                ticketCreation: {
                    completed: true,

                    idempotent: ticketResult.idempotent

                },

                routing: {

                    completed:
                        ticketResult.routing?.assigned === true,

                    ...ticketResult.routing

                },

                escalation: {

                    completed: escalationSucceeded,

                    ...escalation

                }

            },

            orchestration: {

                status: orchestration.status,

                intent: orchestration.intent,

                entities: orchestration.entities,

                decision: orchestration.hybrid_decision

            }

        };

    };

};


// =====================================================
// PRODUCTION PIPELINE
// =====================================================

export const runTicketPipeline =
    createTicketPipelineService();