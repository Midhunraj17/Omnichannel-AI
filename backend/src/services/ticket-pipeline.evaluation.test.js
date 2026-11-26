import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketPipelineService
} from './ticket-pipeline.service.js';


const ORGANIZATION_ID =
    '11111111-1111-4111-8111-111111111111';

const MEMBER_ID =
    '22222222-2222-4222-8222-222222222222';

const CONVERSATION_ID =
    '33333333-3333-4333-8333-333333333333';

const REQUEST_ID =
    '44444444-4444-4444-8444-444444444444';

const TICKET_ID =
    '55555555-5555-4555-8555-555555555555';


const createInput = (overrides = {}) => ({
    organizationId: ORGANIZATION_ID,
    memberId: MEMBER_ID,
    conversationId: CONVERSATION_ID,
    intakeRequestId: REQUEST_ID,
    message: 'My payment failed and money was deducted.',
    domain: 'general',
    autoAssign: true,
    ...overrides
});


const createContext = () => ({
    conversation: {
        id: CONVERSATION_ID,
        organization_id: ORGANIZATION_ID,
        status: 'active'
    },
    history: [
        {
            sender_type: 'customer',
            content: 'I previously reported a payment issue.'
        }
    ]
});


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
        destination: 'SUPPORT_AGENT'
    },

    ticket_triage: {
        applicable: true,
        category: 'PAYMENT',
        subcategory: 'payment_failure',
        priority: 'P2_HIGH',
        priority_score: 80,
        severity: 'HIGH',
        impact_level: 4,
        urgency_level: 4,
        confidence: 0.95,
        classification_method: 'hybrid',
        labels: ['payment'],
        priority_reason_codes: ['PAYMENT_FAILURE'],
        requires_human_review: false,
        escalation_required: true,
        first_response_sla_hours: 2,
        resolution_sla_hours: 8
    },

    hybrid_decision: {
        action: 'ROUTE_SUPPORT'
    },

    ...overrides
});


const createTicketResult = (overrides = {}) => ({
    created: true,
    idempotent: false,

    ticket: {
        id: TICKET_ID,
        title: 'Payment failed',
        status: 'open'
    },

    routing: {
        assigned: true,
        assignedAgent: {
            id: 'evaluation-agent'
        }
    },

    ...overrides
});


const createClassification = () => ({
    id: TICKET_ID,
    priority: 'high',
    severity: 'high',
    category: 'payment',
    subcategory: 'payment_failure'
});


// =====================================================
// TEST 1: COMPLETE PIPELINE
// =====================================================

test(
    'evaluation: complete pipeline executes all stages in order',
    async () => {
        const executedStages = [];

        const service = createTicketPipelineService({

            loadConversationFn: async () => {
                executedStages.push('conversation');

                return createContext();
            },

            orchestrateFn: async () => {
                executedStages.push('orchestration');

                return createOrchestration();
            },

            createTicketFn: async () => {
                executedStages.push('ticket_creation');

                return createTicketResult();
            },

            persistTriageFn: async () => {
                executedStages.push('classification');

                return createClassification();
            },

            escalateFn: async () => {
                executedStages.push('escalation');

                return {
                    success: true,
                    persistence: {
                        applied: true,
                        escalationLevel: 2
                    }
                };
            }
        });

        const result = await service(createInput());

        assert.equal(result.success, true);

        assert.equal(result.pipelineStatus, 'completed');

        assert.equal(result.ticketCreated, true);

        assert.equal(result.ticket.id, TICKET_ID);

        assert.deepEqual(executedStages, [
            'conversation',
            'orchestration',
            'ticket_creation',
            'classification',
            'escalation'
        ]);
    }
);


// =====================================================
// TEST 2: NO TICKET FOR NORMAL ANSWERS
// =====================================================

test(
    'evaluation: normal AI response does not create a ticket',
    async () => {
        let ticketCreationCalled = false;

        const service = createTicketPipelineService({

            loadConversationFn: async () => createContext(),

            orchestrateFn: async () => createOrchestration({
                status: 'response_generated',
                ticket_triage: null
            }),

            createTicketFn: async () => {
                ticketCreationCalled = true;

                return createTicketResult();
            }
        });

        const result = await service(createInput());

        assert.equal(
            result.pipelineStatus,
            'no_ticket_required'
        );

        assert.equal(result.ticketCreated, false);

        assert.equal(ticketCreationCalled, false);
    }
);


// =====================================================
// TEST 3: NO TICKET FOR CLARIFICATION
// =====================================================

test(
    'evaluation: clarification does not trigger ticket creation',
    async () => {
        let ticketCreationCalled = false;

        const service = createTicketPipelineService({

            loadConversationFn: async () => createContext(),

            orchestrateFn: async () => createOrchestration({
                status: 'clarification_required'
            }),

            createTicketFn: async () => {
                ticketCreationCalled = true;

                return createTicketResult();
            }
        });

        const result = await service(createInput());

        assert.equal(result.ticketCreated, false);

        assert.equal(ticketCreationCalled, false);
    }
);


// =====================================================
// TEST 4: PRIORITY MAPPING
// =====================================================

test(
    'evaluation: AI priority is mapped correctly to backend priority',
    async () => {
        let capturedTicketInput = null;

        const service = createTicketPipelineService({

            loadConversationFn: async () => createContext(),

            orchestrateFn: async () => createOrchestration(),

            createTicketFn: async (input) => {
                capturedTicketInput = input;

                return createTicketResult();
            },

            persistTriageFn: async () => createClassification(),

            escalateFn: async () => ({
                success: true
            })
        });

        await service(createInput());

        assert.equal(capturedTicketInput.priority, 'high');

        assert.equal(capturedTicketInput.category, 'payment');

        assert.equal(capturedTicketInput.severity, 'high');

        assert.equal(capturedTicketInput.priorityScore, 80);
    }
);


// =====================================================
// TEST 5: ESCALATION FAILURE
// =====================================================

test(
    'evaluation: escalation failure preserves the created ticket',
    async () => {
        const service = createTicketPipelineService({

            loadConversationFn: async () => createContext(),

            orchestrateFn: async () => createOrchestration(),

            createTicketFn: async () => createTicketResult(),

            persistTriageFn: async () => createClassification(),

            escalateFn: async () => {
                throw new Error('Simulated escalation failure');
            }
        });

        const result = await service(createInput());

        assert.equal(result.success, true);

        assert.equal(result.ticketCreated, true);

        assert.equal(result.ticket.id, TICKET_ID);

        assert.equal(
            result.pipelineStatus,
            'partially_completed'
        );

        assert.equal(
            result.stages.escalation.completed,
            false
        );
    }
);


// =====================================================
// TEST 6: IDEMPOTENT REPLAY
// =====================================================

test(
    'evaluation: repeated intake does not report a duplicate creation',
    async () => {
        const service = createTicketPipelineService({

            loadConversationFn: async () => createContext(),

            orchestrateFn: async () => createOrchestration(),

            createTicketFn: async () => createTicketResult({
                created: false,
                idempotent: true
            }),

            persistTriageFn: async () => createClassification(),

            escalateFn: async () => ({
                success: true
            })
        });

        const result = await service(createInput());

        assert.equal(result.success, true);

        assert.equal(result.ticketCreated, false);

        assert.equal(result.ticket.id, TICKET_ID);

        assert.equal(
            result.stages.ticketCreation.idempotent,
            true
        );
    }
);


// =====================================================
// TEST 7: INVALID IDENTIFIERS
// =====================================================

test(
    'evaluation: invalid tenant identifiers are rejected',
    async () => {
        const service = createTicketPipelineService();

        await assert.rejects(
            service(
                createInput({
                    organizationId: 'invalid'
                })
            ),
            {
                statusCode: 400
            }
        );
    }
);


// =====================================================
// TEST 8: UNSUPPORTED PRIORITY
// =====================================================

test(
    'evaluation: unsupported AI priority cannot create a ticket',
    async () => {
        let ticketCreationCalled = false;

        const service = createTicketPipelineService({

            loadConversationFn: async () => createContext(),

            orchestrateFn: async () => createOrchestration({
                ticket_triage: {
                    ...createOrchestration().ticket_triage,
                    priority: 'UNSUPPORTED_PRIORITY'
                }
            }),

            createTicketFn: async () => {
                ticketCreationCalled = true;

                return createTicketResult();
            }
        });

        await assert.rejects(
            service(createInput()),
            {
                statusCode: 422
            }
        );

        assert.equal(ticketCreationCalled, false);
    }
);