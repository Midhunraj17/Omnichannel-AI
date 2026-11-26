import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketEscalationService
} from './ticket-escalation.service.js';


const TICKET_ID =
    '11111111-1111-4111-8111-111111111111';

const ORGANIZATION_ID =
    '22222222-2222-4222-8222-222222222222';


const createTicket = (overrides = {}) => ({

    id: TICKET_ID,

    organization_id: ORGANIZATION_ID,

    status: 'open',

    priority: 'high',

    severity: 'high',

    created_at: new Date(
        '2026-11-25T10:00:00.000Z'
    ),

    first_response_at: null,

    sla_due_at: new Date(
        '2026-11-25T14:00:00.000Z'
    ),

    first_response_sla_hours: 2,

    resolution_sla_hours: 4,

    escalation_required: false,

    escalation_level: 0,

    ...overrides

});


const createEvaluation = (overrides = {}) => ({

    success: true,

    ticket_id: TICKET_ID,

    escalation_required: true,

    escalation_recommended: true,

    should_escalate: true,

    current_escalation_level: 0,

    recommended_escalation_level: 2,

    escalation_target: 'SUPPORT_MANAGER',

    escalation_reason:
        'High priority ticket requires management attention.',

    reason_codes: [
        'HIGH_PRIORITY'
    ],

    notification_recommended: true,

    reassignment_recommended: false,

    evaluation_timestamp:
        '2026-11-25T12:00:00.000Z',

    ...overrides

});


// =====================================================
// TEST 1: SUCCESSFUL INTEGRATION
// =====================================================

test(
    'evaluates and persists ticket escalation',
    async () => {

        let persisted = false;

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket(),

                evaluateFn: async () =>
                    createEvaluation(),

                persistFn: async () => {

                    persisted = true;

                    return {
                        applied: true,
                        escalationLevel: 2
                    };

                }

            });


        const result = await service({

            ticketId: TICKET_ID,

            organizationId: ORGANIZATION_ID

        });


        assert.equal(result.success, true);

        assert.equal(result.ticketId, TICKET_ID);

        assert.equal(persisted, true);

        assert.equal(
            result.persistence.escalationLevel,
            2
        );

    }
);


// =====================================================
// TEST 2: INVALID TICKET ID
// =====================================================

test(
    'rejects invalid ticket ID',
    async () => {

        const service =
            createTicketEscalationService();


        await assert.rejects(

            service({

                ticketId: 'invalid',

                organizationId: ORGANIZATION_ID

            }),

            {
                statusCode: 400
            }

        );

    }
);


// =====================================================
// TEST 3: TICKET NOT FOUND
// =====================================================

test(
    'rejects missing ticket',
    async () => {

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () => null

            });


        await assert.rejects(

            service({

                ticketId: TICKET_ID,

                organizationId: ORGANIZATION_ID

            }),

            {
                statusCode: 404
            }

        );

    }
);


// =====================================================
// TEST 4: TERMINAL TICKET
// =====================================================

test(
    'does not evaluate resolved tickets',
    async () => {

        let aiCalled = false;

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket({
                        status: 'resolved'
                    }),

                evaluateFn: async () => {

                    aiCalled = true;

                    return createEvaluation();

                }

            });


        const result = await service({

            ticketId: TICKET_ID,

            organizationId: ORGANIZATION_ID

        });


        assert.equal(result.applied, false);

        assert.equal(
            result.reason,
            'ticket_terminal_state'
        );

        assert.equal(aiCalled, false);

    }
);


// =====================================================
// TEST 5: AI PAYLOAD MAPPING
// =====================================================

test(
    'maps database ticket data into AI payload',
    async () => {

        let capturedPayload = null;

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket(),

                evaluateFn: async (payload) => {

                    capturedPayload = payload;

                    return createEvaluation();

                },

                persistFn: async () => ({
                    applied: true
                })

            });


        await service({

            ticketId: TICKET_ID,

            organizationId: ORGANIZATION_ID

        });


        assert.equal(
            capturedPayload.ticket_id,
            TICKET_ID
        );

        assert.equal(
            capturedPayload.priority,
            'high'
        );

        assert.equal(
            capturedPayload.severity,
            'high'
        );

        assert.equal(
            capturedPayload.current_escalation_level,
            0
        );

        assert.equal(
            capturedPayload.first_response_sla_hours,
            2
        );

    }
);


// =====================================================
// TEST 6: PRIORITY SEVERITY FALLBACK
// =====================================================

test(
    'uses severity fallback when database severity is null',
    async () => {

        let capturedPayload = null;

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket({
                        priority: 'urgent',
                        severity: null
                    }),

                evaluateFn: async (payload) => {

                    capturedPayload = payload;

                    return createEvaluation();

                },

                persistFn: async () => ({
                    applied: true
                })

            });


        await service({

            ticketId: TICKET_ID,

            organizationId: ORGANIZATION_ID

        });


        assert.equal(
            capturedPayload.severity,
            'critical'
        );

    }
);


// =====================================================
// TEST 7: MISMATCHED AI RESPONSE
// =====================================================

test(
    'rejects AI result belonging to another ticket',
    async () => {

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket(),

                evaluateFn: async () =>
                    createEvaluation({
                        ticket_id:
                            '99999999-9999-4999-8999-999999999999'
                    })

            });


        await assert.rejects(

            service({

                ticketId: TICKET_ID,

                organizationId: ORGANIZATION_ID

            }),

            /mismatched ticket ID/

        );

    }
);


// =====================================================
// TEST 8: AI FAILURE
// =====================================================

test(
    'propagates AI service errors',
    async () => {

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket(),

                evaluateFn: async () => {

                    throw new Error(
                        'AI service unavailable'
                    );

                }

            });


        await assert.rejects(

            service({

                ticketId: TICKET_ID,

                organizationId: ORGANIZATION_ID

            }),

            /AI service unavailable/

        );

    }
);


// =====================================================
// TEST 9: PERSISTENCE FAILURE
// =====================================================

test(
    'propagates persistence errors',
    async () => {

        const service =
            createTicketEscalationService({

                fetchTicketFn: async () =>
                    createTicket(),

                evaluateFn: async () =>
                    createEvaluation(),

                persistFn: async () => {

                    throw new Error(
                        'Database failure'
                    );

                }

            });


        await assert.rejects(

            service({

                ticketId: TICKET_ID,

                organizationId: ORGANIZATION_ID

            }),

            /Database failure/

        );

    }
);