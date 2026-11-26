import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketRoutingService
} from './ticket-routing.service.js';


// =====================================================
// TEST IDENTIFIERS
// =====================================================

const TICKET_ID =
    '11111111-1111-4111-8111-111111111111';

const ORGANIZATION_ID =
    '22222222-2222-4222-8222-222222222222';

const MEMBER_ID =
    '33333333-3333-4333-8333-333333333333';

const AGENT_ID =
    '44444444-4444-4444-8444-444444444444';

const CONVERSATION_ID =
    '55555555-5555-4555-8555-555555555555';


// =====================================================
// MOCK TICKET
// =====================================================

const createTicket = (overrides = {}) => ({

    id: TICKET_ID,

    organization_id: ORGANIZATION_ID,

    conversation_id: CONVERSATION_ID,

    assigned_agent_id: null,

    status: 'open',

    priority: 'medium',

    category: 'TECHNICAL',

    severity: 'medium',

    priority_score: 50,

    ...overrides

});


// =====================================================
// MOCK AGENT
// =====================================================

const createAgent = (overrides = {}) => ({

    support_agent_id: AGENT_ID,

    organization_member_id: MEMBER_ID,

    skills: [
        'technical',
        'software',
        'bug'
    ],

    matched_skills: [
        'technical',
        'software'
    ],

    max_active_tickets: 10,

    active_ticket_count: 3,

    workload_ratio: 0.3,

    last_assigned_at: null,

    created_at: new Date(),

    ...overrides

});


// =====================================================
// MOCK DATABASE
// =====================================================

const createMockPool = ({

    ticket = createTicket(),

    agent = createAgent(),

    assignmentError = null,

    conversationRowCount = 1

} = {}) => {

    const calls = [];

    const client = {

        async query(sql, params = []) {

            calls.push({
                sql,
                params
            });


            // BEGIN
            if (sql.trim() === 'BEGIN') {

                return {
                    rowCount: null,
                    rows: []
                };

            }


            // COMMIT
            if (sql.trim() === 'COMMIT') {

                return {
                    rowCount: null,
                    rows: []
                };

            }


            // ROLLBACK
            if (sql.trim() === 'ROLLBACK') {

                return {
                    rowCount: null,
                    rows: []
                };

            }


            // FETCH TICKET
            if (
                sql.includes('FROM public.tickets') &&
                sql.includes('FOR UPDATE;')
            ) {

                return {

                    rowCount: ticket ? 1 : 0,

                    rows: ticket
                        ? [ticket]
                        : []

                };

            }


            // FIND AGENT
            if (
                sql.includes('FROM public.support_agents sa')
            ) {

                return {

                    rowCount: agent ? 1 : 0,

                    rows: agent
                        ? [agent]
                        : []

                };

            }


            // UPDATE TICKET
            if (
                sql.includes('UPDATE public.tickets')
            ) {

                return {

                    rowCount: 1,

                    rows: []

                };

            }


            // CLOSE ASSIGNMENT HISTORY
            if (
                sql.includes('UPDATE public.ticket_assignments')
            ) {

                return {

                    rowCount: 0,

                    rows: []

                };

            }


            // INSERT ASSIGNMENT HISTORY
            if (
                sql.includes('INSERT INTO public.ticket_assignments')
            ) {

                if (assignmentError) {
                    throw assignmentError;
                }

                return {

                    rowCount: 1,

                    rows: [

                        {

                            id: '66666666-6666-4666-8666-666666666666',

                            ticket_id: TICKET_ID,

                            support_agent_id: AGENT_ID,

                            assigned_by_member_id: MEMBER_ID,

                            assigned_at: new Date()

                        }

                    ]

                };

            }


            // UPDATE AGENT TIMESTAMP
            if (
                sql.includes('UPDATE public.support_agents')
            ) {

                return {

                    rowCount: 1,

                    rows: []

                };

            }


            // UPDATE CONVERSATION
            if (
                sql.includes('UPDATE public.conversations')
            ) {

                return {

                    rowCount: conversationRowCount,

                    rows: []

                };

            }


            throw new Error(
                `Unexpected SQL query: ${sql}`
            );

        },


        release() {

            calls.push({
                sql: 'RELEASE',
                params: []
            });

        }

    };


    const dbPool = {

        async connect() {

            return client;

        }

    };


    return {

        dbPool,

        calls

    };

};


// =====================================================
// COMMON INPUT
// =====================================================

const createInput = (overrides = {}) => ({

    ticketId: TICKET_ID,

    organizationId: ORGANIZATION_ID,

    assignedByMemberId: MEMBER_ID,

    ...overrides

});


// =====================================================
// TEST 1: SUCCESSFUL ROUTING
// =====================================================

test(
    'automatically assigns a ticket to the selected agent',
    async () => {

        const mock = createMockPool();

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        const result = await service.autoAssignTicket(
            createInput()
        );


        assert.equal(
            result.assigned,
            true
        );

        assert.equal(
            result.ticketId,
            TICKET_ID
        );

        assert.equal(
            result.assignedAgent.id,
            AGENT_ID
        );

        assert.equal(
            result.assignment.ticket_id,
            TICKET_ID
        );

        assert.equal(
            result.routing.strategy,
            'priority_skill_workload_fairness'
        );

        assert.ok(
            mock.calls.some(
                call => call.sql.trim() === 'COMMIT'
            )
        );

        assert.ok(
            mock.calls.some(
                call => call.sql === 'RELEASE'
            )
        );

    }
);


// =====================================================
// TEST 2: INVALID IDENTIFIERS
// =====================================================

test(
    'rejects invalid routing identifiers',
    async () => {

        const mock = createMockPool();

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await assert.rejects(

            () => service.autoAssignTicket(

                createInput({

                    ticketId: 'invalid-id'

                })

            ),

            error => {

                assert.equal(
                    error.statusCode,
                    400
                );

                return true;

            }

        );

        assert.equal(
            mock.calls.length,
            0
        );

    }
);


// =====================================================
// TEST 3: TICKET NOT FOUND
// =====================================================

test(
    'returns 404 when ticket does not exist',
    async () => {

        const mock = createMockPool({

            ticket: null

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await assert.rejects(

            () => service.autoAssignTicket(
                createInput()
            ),

            error => {

                assert.equal(
                    error.statusCode,
                    404
                );

                return true;

            }

        );

        assert.ok(
            mock.calls.some(
                call => call.sql.trim() === 'ROLLBACK'
            )
        );

    }
);


// =====================================================
// TEST 4: ALREADY ASSIGNED
// =====================================================

test(
    'does not reassign an already assigned ticket',
    async () => {

        const mock = createMockPool({

            ticket: createTicket({

                assigned_agent_id: AGENT_ID

            })

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        const result = await service.autoAssignTicket(
            createInput()
        );


        assert.equal(
            result.assigned,
            false
        );

        assert.equal(
            result.reason,
            'already_assigned'
        );

        assert.equal(
            result.assignedAgentId,
            AGENT_ID
        );

    }
);


// =====================================================
// TEST 5: NO ELIGIBLE AGENT
// =====================================================

test(
    'returns no_eligible_agent when no candidate exists',
    async () => {

        const mock = createMockPool({

            agent: null

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        const result = await service.autoAssignTicket(
            createInput()
        );


        assert.equal(
            result.assigned,
            false
        );

        assert.equal(
            result.reason,
            'no_eligible_agent'
        );

        assert.ok(
            mock.calls.some(
                call => call.sql.trim() === 'COMMIT'
            )
        );

    }
);


// =====================================================
// TEST 6: CLOSED TICKET
// =====================================================

test(
    'rejects assignment of a resolved ticket',
    async () => {

        const mock = createMockPool({

            ticket: createTicket({

                status: 'resolved'

            })

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await assert.rejects(

            () => service.autoAssignTicket(
                createInput()
            ),

            error => {

                assert.equal(
                    error.statusCode,
                    409
                );

                return true;

            }

        );

        assert.ok(
            mock.calls.some(
                call => call.sql.trim() === 'ROLLBACK'
            )
        );

    }
);


// =====================================================
// TEST 7: PRIORITY SCORE
// =====================================================

test(
    'passes priority score into the agent selection query',
    async () => {

        const mock = createMockPool({

            ticket: createTicket({

                priority: 'urgent',

                priority_score: 95

            })

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await service.autoAssignTicket(
            createInput()
        );


        const candidateCall = mock.calls.find(

            call => call.sql.includes(
                'FROM public.support_agents sa'
            )

        );


        assert.ok(candidateCall);

        assert.equal(
            candidateCall.params[2],
            95
        );

    }
);


// =====================================================
// TEST 8: CATEGORY SKILL MATCHING
// =====================================================

test(
    'passes normalized category skills into agent selection',
    async () => {

        const mock = createMockPool({

            ticket: createTicket({

                category: 'TECHNICAL'

            })

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await service.autoAssignTicket(
            createInput()
        );


        const candidateCall = mock.calls.find(

            call => call.sql.includes(
                'FROM public.support_agents sa'
            )

        );


        assert.ok(candidateCall);

        assert.ok(
            candidateCall.params[1].includes(
                'technical'
            )
        );

        assert.ok(
            candidateCall.params[1].includes(
                'software'
            )
        );

    }
);


// =====================================================
// TEST 9: ASSIGNMENT FAILURE ROLLBACK
// =====================================================

test(
    'rolls back when assignment history insertion fails',
    async () => {

        const mock = createMockPool({

            assignmentError: new Error(
                'Assignment history insertion failed'
            )

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await assert.rejects(

            () => service.autoAssignTicket(
                createInput()
            ),

            /Assignment history insertion failed/

        );


        assert.ok(
            mock.calls.some(
                call => call.sql.trim() === 'ROLLBACK'
            )
        );

        assert.ok(
            mock.calls.some(
                call => call.sql === 'RELEASE'
            )
        );

    }
);


// =====================================================
// TEST 10: CONVERSATION SYNCHRONIZATION FAILURE
// =====================================================

test(
    'rolls back when conversation assignment cannot synchronize',
    async () => {

        const mock = createMockPool({

            conversationRowCount: 0

        });

        const service = createTicketRoutingService({

            dbPool: mock.dbPool

        });


        await assert.rejects(

            () => service.autoAssignTicket(
                createInput()
            ),

            error => {

                assert.equal(
                    error.statusCode,
                    409
                );

                return true;

            }

        );


        assert.ok(
            mock.calls.some(
                call => call.sql.trim() === 'ROLLBACK'
            )
        );

    }
);