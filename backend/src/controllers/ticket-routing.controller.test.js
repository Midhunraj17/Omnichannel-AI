import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketRoutingController
} from './ticket-routing.controller.js';


const createResponse = () => {

    const res = {

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

    };

    return res;

};


const createRequest = () => ({

    params: {

        ticketId: '11111111-1111-4111-8111-111111111111'

    },

    organization: {

        id: '22222222-2222-4222-8222-222222222222',

        memberId: '33333333-3333-4333-8333-333333333333'

    }

});


// =====================================================
// TEST 1: SUCCESSFUL ASSIGNMENT
// =====================================================

test('assigns ticket successfully', async () => {

    const controller = createTicketRoutingController({

        autoAssignTicketFn: async () => ({

            assigned: true,

            ticketId: '11111111-1111-4111-8111-111111111111'

        })

    });

    const req = createRequest();

    const res = createResponse();

    let nextCalled = false;

    await controller(req, res, () => {

        nextCalled = true;

    });

    assert.equal(res.statusCode, 200);

    assert.equal(res.body.success, true);

    assert.equal(res.body.assigned, true);

    assert.equal(nextCalled, false);

});


// =====================================================
// TEST 2: NO AVAILABLE AGENT
// =====================================================

test('handles no eligible agent', async () => {

    const controller = createTicketRoutingController({

        autoAssignTicketFn: async () => ({

            assigned: false,

            reason: 'no_eligible_agent'

        })

    });

    const req = createRequest();

    const res = createResponse();

    await controller(req, res, () => {});

    assert.equal(res.statusCode, 200);

    assert.equal(res.body.assigned, false);

});


// =====================================================
// TEST 3: ALREADY ASSIGNED
// =====================================================

test('handles already assigned ticket', async () => {

    const controller = createTicketRoutingController({

        autoAssignTicketFn: async () => ({

            assigned: false,

            reason: 'already_assigned'

        })

    });

    const req = createRequest();

    const res = createResponse();

    await controller(req, res, () => {});

    assert.equal(res.statusCode, 200);

    assert.equal(res.body.assigned, false);

});


// =====================================================
// TEST 4: INVALID TICKET ID
// =====================================================

test('rejects invalid ticket ID', async () => {

    const controller = createTicketRoutingController();

    const req = createRequest();

    req.params.ticketId = 'invalid-id';

    const res = createResponse();

    await controller(req, res, () => {});

    assert.equal(res.statusCode, 400);

});


// =====================================================
// TEST 5: MISSING ORGANIZATION CONTEXT
// =====================================================

test('rejects missing organization context', async () => {

    const controller = createTicketRoutingController();

    const req = createRequest();

    req.organization = null;

    const res = createResponse();

    await controller(req, res, () => {});

    assert.equal(res.statusCode, 403);

});


// =====================================================
// TEST 6: SERVICE ERRORS ARE FORWARDED
// =====================================================

test('forwards service errors to error middleware', async () => {

    const expectedError = new Error('Database failure');

    const controller = createTicketRoutingController({

        autoAssignTicketFn: async () => {

            throw expectedError;

        }

    });

    const req = createRequest();

    const res = createResponse();

    let forwardedError = null;

    await controller(req, res, (error) => {

        forwardedError = error;

    });

    assert.equal(forwardedError, expectedError);

});