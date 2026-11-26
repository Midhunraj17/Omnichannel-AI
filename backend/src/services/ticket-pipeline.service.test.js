import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketPipelineService
} from './ticket-pipeline.service.js';


const TICKET_ID =
    '11111111-1111-4111-8111-111111111111';

const ORGANIZATION_ID =
    '22222222-2222-4222-8222-222222222222';

const MEMBER_ID =
    '33333333-3333-4333-8333-333333333333';

const CONVERSATION_ID =
    '44444444-4444-4444-8444-444444444444';

const REQUEST_ID =
    '55555555-5555-4555-8555-555555555555';


// =====================================================
// MOCK CONTEXT
// =====================================================

const createContext = () => ({

    conversation: {

        id: CONVERSATION_ID,

        organization_id: ORGANIZATION_ID,

        status: 'active'

    },

    history: [

        {

            sender_type: 'customer',

            content: 'Previous customer message.'

        }

    ]

});


// =====================================================
// MOCK TRIAGE
// =====================================================

const createTriage = (overrides = {}) => ({

    applicable: true,

    category: 'PAYMENT',

    subcategory: 'payment_failure',

    priority: 'P2_HIGH',

    priority_score: 80,

    severity: 'HIGH',

    impact_level: 4,

    urgency_level: 4,

    sentiment: 'NEGATIVE',

    confidence: 0.95,

    classification_method: 'hybrid',

    labels: [
        'payment',
        'technical'
    ],

    priority_reason_codes: [
        'PAYMENT_FAILURE'
    ],

    requires_human_review: false,

    escalation_required: true,

    first_response_sla_hours: 2,

    resolution_sla_hours: 8,

    ...overrides

});


// =====================================================
// MOCK ORCHESTRATION
// =====================================================

const createOrchestration = (overrides = {}) => ({

    success: true,

    status: 'agent_routing_required',

    intent: {

        primary_intent: 'PAYMENT_ISSUE'

    },

    entities: {

        entities: []

    },

    routing: {

        destination: 'SUPPORT'

    },

    ticket_triage: createTriage(),

    hybrid_decision: {

        action: 'ROUTE_SUPPORT'

    },

    ...overrides

});


// =====================================================
// COMMON INPUT
// =====================================================

const createInput = (overrides = {}) => ({

    organizationId: ORGANIZATION_ID,

    memberId: MEMBER_ID,

    conversationId: CONVERSATION_ID,

    intakeRequestId: REQUEST_ID,

    message:
        'My payment failed and money was deducted.',

    autoAssign: true,

    ...overrides

});


// =====================================================
// TEST 1: COMPLETE PIPELINE
// =====================================================

test(
    'executes the complete support ticket pipeline',
    async () => {

        const stages = [];

        const service =
            createTicketPipelineService({

                loadConversationFn: async () => {

                    stages.push('conversation');

                    return createContext();

                },

                orchestrateFn: async () => {

                    stages.push('orchestration');

                    return createOrchestration();

                },

                createTicketFn: async () => {

                    stages.push('ticket_creation');

                    return {

                        created: true,

                        idempotent: false,

                        ticket: {

                            id: TICKET_ID,

                            title: 'Payment failed',

                            status: 'in_progress'

                        },

                        routing: {

                            assigned: true,

                            assignedAgent: {
                                id: 'agent-1'
                            }

                        }

                    };

                },

                persistTriageFn: async () => {

                    stages.push('classification');

                    return {

                        id: TICKET_ID,

                        priority: 'high',

                        severity: 'high',

                        category: 'payment',

                        subcategory: 'payment_failure'

                    };

                },

                escalateFn: async () => {

                    stages.push('escalation');

                    return {

                        success: true,

                        persistence: {

                            applied: true,

                            escalationLevel: 2

                        }

                    };

                }

            });


        const result = await service(
            createInput()
        );


        assert.equal(result.success, true);

        assert.equal(
            result.pipelineStatus,
            'completed'
        );

        assert.equal(
            result.ticketCreated,
            true
        );

        assert.equal(
            result.ticket.id,
            TICKET_ID
        );


        assert.deepEqual(
            stages,
            [
                'conversation',
                'orchestration',
                'ticket_creation',
                'classification',
                'escalation'
            ]
        );

    }
);


// =====================================================
// TEST 2: NO TICKET REQUIRED
// =====================================================

test(
    'does not create a ticket when AI triage is absent',
    async () => {

        let ticketCreated = false;

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration({
                        ticket_triage: null,
                        status: 'response_generated'
                    }),

                createTicketFn: async () => {

                    ticketCreated = true;

                }

            });


        const result = await service(
            createInput()
        );


        assert.equal(
            result.pipelineStatus,
            'no_ticket_required'
        );

        assert.equal(
            result.ticketCreated,
            false
        );

        assert.equal(
            ticketCreated,
            false
        );

    }
);


// =====================================================
// TEST 3: CLARIFICATION DOES NOT CREATE TICKET
// =====================================================

test(
    'does not create a ticket when clarification is required',
    async () => {

        let ticketCreated = false;

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration({
                        status: 'clarification_required'
                    }),

                createTicketFn: async () => {

                    ticketCreated = true;

                }

            });


        const result = await service(
            createInput()
        );


        assert.equal(
            result.ticketCreated,
            false
        );

        assert.equal(
            ticketCreated,
            false
        );

    }
);


// =====================================================
// TEST 4: PRIORITY MAPPING
// =====================================================

test(
    'maps AI priority into backend ticket priority',
    async () => {

        let capturedInput = null;

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration(),

                createTicketFn: async (input) => {

                    capturedInput = input;

                    return {

                        created: true,

                        ticket: {
                            id: TICKET_ID
                        },

                        routing: {
                            assigned: false
                        }

                    };

                },

                persistTriageFn: async () => ({

                    id: TICKET_ID,

                    priority: 'urgent',

                    severity: 'critical',

                    category: 'payment',

                    subcategory: 'payment_failure'

                }),

                escalateFn: async () => ({
                    success: true
                })

            });


        await service(
            createInput()
        );


        assert.equal(
            capturedInput.priority,
            'high'
        );

        assert.equal(
            capturedInput.category,
            'payment'
        );

        assert.equal(
            capturedInput.severity,
            'high'
        );

        assert.equal(
            capturedInput.priorityScore,
            80
        );

    }
);


// =====================================================
// TEST 5: AI FAILURE
// =====================================================

test(
    'propagates orchestration failures',
    async () => {

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () => {

                    throw new Error(
                        'AI service unavailable'
                    );

                }

            });


        await assert.rejects(

            service(createInput()),

            /AI service unavailable/

        );

    }
);


// =====================================================
// TEST 6: TICKET CREATION FAILURE
// =====================================================

test(
    'propagates ticket creation failures',
    async () => {

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration(),

                createTicketFn: async () => {

                    throw new Error(
                        'Ticket creation failed'
                    );

                }

            });


        await assert.rejects(

            service(createInput()),

            /Ticket creation failed/

        );

    }
);


// =====================================================
// TEST 7: CLASSIFICATION PERSISTENCE FAILURE
// =====================================================

test(
    'propagates classification persistence failures',
    async () => {

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration(),

                createTicketFn: async () => ({

                    created: true,

                    ticket: {
                        id: TICKET_ID
                    },

                    routing: {
                        assigned: false
                    }

                }),

                persistTriageFn: async () => {

                    throw new Error(
                        'Classification persistence failed'
                    );

                }

            });


        await assert.rejects(

            service(createInput()),

            /Classification persistence failed/

        );

    }
);


// =====================================================
// TEST 8: ESCALATION FAILURE
// =====================================================

test(
    'preserves created ticket when escalation fails',
    async () => {

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration(),

                createTicketFn: async () => ({

                    created: true,

                    ticket: {
                        id: TICKET_ID
                    },

                    routing: {
                        assigned: true
                    }

                }),

                persistTriageFn: async () => ({

                    id: TICKET_ID,

                    priority: 'high',

                    severity: 'high',

                    category: 'payment',

                    subcategory: 'payment_failure'

                }),

                escalateFn: async () => {

                    throw new Error(
                        'Escalation service unavailable'
                    );

                }

            });


        const result = await service(
            createInput()
        );


        assert.equal(
            result.pipelineStatus,
            'partially_completed'
        );

        assert.equal(
            result.ticketCreated,
            true
        );

        assert.equal(
            result.stages.escalation.completed,
            false
        );

        assert.equal(
            result.stages.escalation.reason,
            'escalation_evaluation_failed'
        );

    }
);


// =====================================================
// TEST 9: IDEMPOTENT TICKET
// =====================================================

test(
    'supports an existing ticket returned by idempotent intake',
    async () => {

        const service =
            createTicketPipelineService({

                loadConversationFn: async () =>
                    createContext(),

                orchestrateFn: async () =>
                    createOrchestration(),

                createTicketFn: async () => ({

                    created: false,

                    idempotent: true,

                    ticket: {
                        id: TICKET_ID
                    },

                    routing: {
                        assigned: false,
                        reason: 'already_assigned'
                    }

                }),

                persistTriageFn: async () => ({

                    id: TICKET_ID,

                    priority: 'high',

                    severity: 'high',

                    category: 'payment',

                    subcategory: 'payment_failure'

                }),

                escalateFn: async () => ({
                    success: true
                })

            });


        const result = await service(
            createInput()
        );


        assert.equal(
            result.ticketCreated,
            false
        );

        assert.equal(
            result.stages.ticketCreation.idempotent,
            true
        );

    }
);


// =====================================================
// TEST 10: INVALID IDENTIFIERS
// =====================================================

test(
    'rejects invalid pipeline identifiers',
    async () => {

        const service =
            createTicketPipelineService();


        await assert.rejects(

            service(
                createInput({
                    conversationId: 'invalid'
                })
            ),

            {
                statusCode: 400
            }

        );

    }
);


// =====================================================
// TEST 11: INVALID MESSAGE
// =====================================================

test(
    'rejects empty customer messages',
    async () => {

        const service =
            createTicketPipelineService();


        await assert.rejects(

            service(
                createInput({
                    message: '   '
                })
            ),

            {
                statusCode: 400
            }

        );

    }
);