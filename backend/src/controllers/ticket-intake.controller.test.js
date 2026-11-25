import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketIntakeController
} from './ticket-intake.controller.js';


const createResponse = () => {

    return {

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

};


const createRequest = () => ({

    get(name) {

        if (name === 'Idempotency-Key') {

            return '11111111-1111-4111-8111-111111111111';

        }

    },

    organization: {

        id: '22222222-2222-4222-8222-222222222222',

        memberId: '33333333-3333-4333-8333-333333333333'

    },

    body: {

        conversation_id:
            '44444444-4444-4444-8444-444444444444',

        title: 'Payment failed',

        description: 'Customer cannot complete payment.',

        category: 'billing',

        priority: 'high',

        severity: 'high',

        priority_score: 80,

        auto_assign: true

    }

});


// =====================================================
// TEST 1: SUCCESSFUL CREATION
// =====================================================

test('creates ticket successfully', async () => {

    const controller = createTicketIntakeController({

        createTicketFn: async () => ({

            created: true,

            ticket: {

                id: '55555555-5555-4555-8555-555555555555'

            },

            routing: {

                assigned: true

            },

            idempotent: false

        })

    });


    const req = createRequest();

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 201);

    assert.equal(res.body.success, true);

    assert.equal(res.body.data.idempotent, false);

});


// =====================================================
// TEST 2: IDEMPOTENT RESPONSE
// =====================================================

test('returns existing ticket for repeated request', async () => {

    const controller = createTicketIntakeController({

        createTicketFn: async () => ({

            created: false,

            ticket: {

                id: '55555555-5555-4555-8555-555555555555'

            },

            routing: {

                assigned: false,

                reason: 'already_assigned'

            },

            idempotent: true

        })

    });


    const req = createRequest();

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 200);

    assert.equal(res.body.data.idempotent, true);

});


// =====================================================
// TEST 3: INVALID IDEMPOTENCY KEY
// =====================================================

test('rejects invalid idempotency key', async () => {

    const controller = createTicketIntakeController();

    const req = createRequest();

    req.get = () => 'invalid-key';

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 400);

});


// =====================================================
// TEST 4: INVALID CONVERSATION ID
// =====================================================

test('rejects invalid conversation ID', async () => {

    const controller = createTicketIntakeController();

    const req = createRequest();

    req.body.conversation_id = 'invalid';

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 400);

});


// =====================================================
// TEST 5: MISSING ORGANIZATION
// =====================================================

test('rejects missing organization context', async () => {

    const controller = createTicketIntakeController();

    const req = createRequest();

    req.organization = null;

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 403);

});


// =====================================================
// TEST 6: ROUTING FAILURE DOES NOT CHANGE HTTP HANDLING
// =====================================================

test('returns routing failure as part of ticket result', async () => {

    const controller = createTicketIntakeController({

        createTicketFn: async () => ({

            created: true,

            ticket: {

                id: '55555555-5555-4555-8555-555555555555'

            },

            routing: {

                assigned: false,

                reason: 'routing_failed'

            },

            idempotent: false

        })

    });


    const req = createRequest();

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 201);

    assert.equal(res.body.success, true);

    assert.equal(
        res.body.data.routing.reason,
        'routing_failed'
    );

});


// =====================================================
// TEST 7: SERVICE ERROR FORWARDED
// =====================================================

test('forwards service errors to error middleware', async () => {

    const expectedError = new Error('Database unavailable');

    const controller = createTicketIntakeController({

        createTicketFn: async () => {

            throw expectedError;

        }

    });


    const req = createRequest();

    const res = createResponse();

    let receivedError = null;


    await controller(req, res, (error) => {

        receivedError = error;

    });


    assert.equal(receivedError, expectedError);

});


// =====================================================
// TEST 8: AUTO ASSIGN VALIDATION
// =====================================================

test('rejects invalid auto_assign value', async () => {

    const controller = createTicketIntakeController();

    const req = createRequest();

    req.body.auto_assign = 'yes';

    const res = createResponse();


    await controller(req, res, () => {});


    assert.equal(res.statusCode, 400);

});