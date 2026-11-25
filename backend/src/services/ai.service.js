import { env } from '../config/env.js';

export const generateAIResponse = async (message) => {
    try {
        const response = await fetch(
            `${env.aiServiceUrl}/api/v1/orchestrator/run`,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.aiServiceApiKey}`
                },

                body: JSON.stringify({
                    message,
                    history: [],
                    domain: 'general',
                    required_entities: []
                }),

                signal: AbortSignal.timeout(30000)
            }
        );

        if (!response.ok) {
            throw new Error(
                `AI Service returned status ${response.status}`
            );
        }

        return await response.json();

    } catch (error) {
        console.error(
            'AI Service Communication Error:',
            error.message
        );

        throw error;
    }
};