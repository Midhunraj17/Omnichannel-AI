import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketEscalationController
} from './ticket-escalation.controller.js';


const TICKET_ID =
    '11111111-1111-4111-8111-111111111111';

const ORGANIZATION_ID =
    '22222222-2222-4222-8222-222222222222';


const createRequest = () => ({

    params: {
        ticketId: TICKET_ID
    },

    organization: {
        id: ORGANIZATION_ID
    }

});


const createResponse = () => ({

    statusCode: 200,

    body: null,

    status(code) {

        this.statusCode = code;

        return this;

    },

    json(body) {

        this.body = body;

        return this;

    }

});


// =====================================================
// TEST 1: SUCCESS
// =====================================================

test(
    'evaluates ticket escalation successfully',
    async () => {

        const controller =
            createTicketEscalationController({

                evaluateEscalationFn: async () => ({

                    success: true,

                    ticketId: TICKET_ID,

                    persistence: {
                        applied: true,
                        escalationLevel: 2
                    }

                })

            });


        const req = createRequest();

        const res = createResponse();

        let nextCalled = false;


        await controller(
            req,
            res,
            () => {
                nextCalled = true;
            }
        );


        assert.equal(res.statusCode, 200);

        assert.equal(res.body.success, true);

        assert.equal(
            res.body.data.ticketId,
            TICKET_ID
        );

        assert.equal(nextCalled, false);

    }
);


// =====================================================
// TEST 2: INVALID TICKET ID
// =====================================================

test(
    'rejects invalid ticket ID',
    async () => {

        const controller =
            createTicketEscalationController();


        const req = createRequest();

        req.params.ticketId = 'invalid';


        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(res.statusCode, 400);

    }
);


// =====================================================
// TEST 3: MISSING ORGANIZATION
// =====================================================

test(
    'rejects missing organization context',
    async () => {

        const controller =
            createTicketEscalationController();


        const req = createRequest();

        req.organization = null;


        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(res.statusCode, 403);

    }
);


// =====================================================
// TEST 4: SERVICE ERROR
// =====================================================

test(
    'forwards service errors to middleware',
    async () => {

        const expectedError =
            new Error('AI service failure');


        const controller =
            createTicketEscalationController({

                evaluateEscalationFn: async () => {

                    throw expectedError;

                }

            });


        const req = createRequest();

        const res = createResponse();

        let forwardedError = null;


        await controller(
            req,
            res,
            (error) => {
                forwardedError = error;
            }
        );


        assert.equal(
            forwardedError,
            expectedError
        );

    }
);