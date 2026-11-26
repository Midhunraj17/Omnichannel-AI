import test from 'node:test';

import assert from 'node:assert/strict';

import {
    createTicketPipelineController
} from './ticket-pipeline.controller.js';


const CONVERSATION_ID =
    '11111111-1111-4111-8111-111111111111';

const ORGANIZATION_ID =
    '22222222-2222-4222-8222-222222222222';

const MEMBER_ID =
    '33333333-3333-4333-8333-333333333333';

const REQUEST_ID =
    '44444444-4444-4444-8444-444444444444';


const createRequest = () => ({

    get(name) {

        if (name === 'Idempotency-Key') {
            return REQUEST_ID;
        }

    },

    organization: {

        id: ORGANIZATION_ID,

        memberId: MEMBER_ID

    },

    body: {

        conversation_id: CONVERSATION_ID,

        message:
            'My payment failed and money was deducted.',

        domain: 'general',

        auto_assign: true

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
// TEST 1: SUCCESSFUL PIPELINE
// =====================================================

test(
    'returns successful pipeline response',
    async () => {

        const controller =
            createTicketPipelineController({

                runPipelineFn: async () => ({

                    success: true,

                    ticketCreated: true,

                    pipelineStatus: 'completed',

                    ticket: {
                        id: 'ticket-1'
                    },

                    stages: {
                        ticketCreation: {
                            idempotent: false
                        }
                    }

                })

            });


        const req = createRequest();

        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(
            res.statusCode,
            201
        );

        assert.equal(
            res.body.success,
            true
        );

        assert.equal(
            res.body.data.pipelineStatus,
            'completed'
        );

    }
);


// =====================================================
// TEST 2: NO TICKET REQUIRED
// =====================================================

test(
    'returns successful response when ticket is unnecessary',
    async () => {

        const controller =
            createTicketPipelineController({

                runPipelineFn: async () => ({

                    success: true,

                    ticketCreated: false,

                    pipelineStatus:
                        'no_ticket_required'

                })

            });


        const req = createRequest();

        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(
            res.statusCode,
            200
        );

        assert.equal(
            res.body.data.ticketCreated,
            false
        );

    }
);


// =====================================================
// TEST 3: INVALID CONVERSATION
// =====================================================

test(
    'rejects invalid conversation ID',
    async () => {

        const controller =
            createTicketPipelineController();


        const req = createRequest();

        req.body.conversation_id = 'invalid';


        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(
            res.statusCode,
            400
        );

    }
);


// =====================================================
// TEST 4: INVALID IDEMPOTENCY KEY
// =====================================================

test(
    'rejects invalid idempotency key',
    async () => {

        const controller =
            createTicketPipelineController();


        const req = createRequest();

        req.get = () => 'invalid';


        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(
            res.statusCode,
            400
        );

    }
);


// =====================================================
// TEST 5: MISSING ORGANIZATION
// =====================================================

test(
    'rejects missing organization context',
    async () => {

        const controller =
            createTicketPipelineController();


        const req = createRequest();

        req.organization = null;


        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(
            res.statusCode,
            403
        );

    }
);


// =====================================================
// TEST 6: INVALID MESSAGE
// =====================================================

test(
    'rejects empty messages',
    async () => {

        const controller =
            createTicketPipelineController();


        const req = createRequest();

        req.body.message = '';


        const res = createResponse();


        await controller(
            req,
            res,
            () => {}
        );


        assert.equal(
            res.statusCode,
            400
        );

    }
);


// =====================================================
// TEST 7: PIPELINE ERROR
// =====================================================

test(
    'forwards pipeline errors to error middleware',
    async () => {

        const expectedError =
            new Error('AI service unavailable');


        const controller =
            createTicketPipelineController({

                runPipelineFn: async () => {

                    throw expectedError;

                }

            });


        const req = createRequest();

        const res = createResponse();

        let receivedError = null;


        await controller(
            req,
            res,
            error => {
                receivedError = error;
            }
        );


        assert.equal(
            receivedError,
            expectedError
        );

    }
);