import {
    describe,
    it,
    afterEach,
    mock
} from 'node:test';

import assert from 'node:assert/strict';

import { generateAIResponse } from '../src/services/ai.service.js';
import { env } from '../src/config/env.js';


afterEach(() => {
    mock.restoreAll();
});


describe('AI Service HTTP Integration', () => {


    it('sends authenticated requests with conversation history', async () => {

        let capturedUrl;

        let capturedOptions;


        mock.method(
            globalThis,
            'fetch',
            async (url, options) => {

                capturedUrl = url;

                capturedOptions = options;


                return new Response(
                    JSON.stringify({

                        status: 'response_generated',

                        response: 'Hello from AI service'

                    }),
                    {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );

            }
        );


        const result = await generateAIResponse({

            message: 'How are you?',

            history: [
                {
                    sender_type: 'customer',
                    content: 'Hello'
                },
                {
                    sender_type: 'bot',
                    content: 'Hi!'
                }
            ],

            domain: 'general',

            requiredEntities: []

        });


        assert.equal(
            capturedUrl,
            `${env.aiServiceUrl}/api/v1/orchestrator/run`
        );


        assert.equal(
            capturedOptions.method,
            'POST'
        );


        assert.equal(
            capturedOptions.headers.Authorization,
            `Bearer ${env.aiServiceApiKey}`
        );


        const payload = JSON.parse(
            capturedOptions.body
        );


        assert.equal(payload.message, 'How are you?');

        assert.equal(payload.history.length, 2);

        assert.equal(
            payload.history[0].sender_type,
            'customer'
        );


        assert.equal(
            result.response,
            'Hello from AI service'
        );

    });


    it('rejects invalid conversation history before making a request', async () => {

        let fetchCalled = false;


        mock.method(
            globalThis,
            'fetch',
            async () => {

                fetchCalled = true;

                return new Response('{}');

            }
        );


        await assert.rejects(

            generateAIResponse({

                message: 'Hello',

                history: [
                    {
                        sender_type: 'invalid',
                        content: 'Bad message'
                    }
                ]

            }),

            {
                name: 'TypeError'
            }

        );


        assert.equal(fetchCalled, false);

    });


    it('rejects unsupported chatbot domains', async () => {

        await assert.rejects(

            generateAIResponse({

                message: 'Hello',

                domain: 'unsupported-domain'

            }),

            {
                name: 'TypeError'
            }

        );

    });


    it('handles AI service communication failures', async () => {

        mock.method(
            globalThis,
            'fetch',
            async () => {
                throw new Error('Network unavailable');
            }
        );


        await assert.rejects(

            generateAIResponse({
                message: 'Hello'
            }),

            {
                message: 'Unable to communicate with the AI service.'
            }

        );

    });


    it('handles unsuccessful AI service responses', async () => {

        mock.method(
            globalThis,
            'fetch',
            async () => new Response(
                JSON.stringify({
                    detail: 'Unavailable'
                }),
                {
                    status: 503
                }
            )
        );


        await assert.rejects(

            generateAIResponse({
                message: 'Hello'
            }),

            {
                message: 'The AI service could not process the request.'
            }

        );

    });


    it('rejects malformed AI service JSON', async () => {

        mock.method(
            globalThis,
            'fetch',
            async () => new Response(
                'not-json',
                {
                    status: 200
                }
            )
        );


        await assert.rejects(

            generateAIResponse({
                message: 'Hello'
            }),

            {
                message: 'The AI service returned an invalid response.'
            }

        );

    });


    it('rejects unexpected AI service response structures', async () => {

        mock.method(
            globalThis,
            'fetch',
            async () => new Response(
                JSON.stringify({
                    unexpected: true
                }),
                {
                    status: 200
                }
            )
        );


        await assert.rejects(

            generateAIResponse({
                message: 'Hello'
            }),

            {
                message:
                    'The AI service returned an unexpected response structure.'
            }

        );

    });

});