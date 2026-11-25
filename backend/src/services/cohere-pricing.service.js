const PRICING_VERSION =
    'cohere-command-a-plus-api-free-tier-2026-11-23';


const MODEL_PRICING = {

    'command-a-plus-05-2026': {
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
        pricingVersion: PRICING_VERSION,
        currency: 'USD'
    }

};


export const calculateCohereCost = ({
    modelName,
    inputTokens,
    outputTokens
}) => {

    const pricing = MODEL_PRICING[modelName];

    // Unknown models must not receive
    // an invented pricing rate.
    if (!pricing) {

        return {
            inputCost: 0,
            outputCost: 0,
            totalCost: 0,
            currency: 'USD',
            pricingVersion: null,
            pricingAvailable: false
        };

    }


    const inputCost =
        (inputTokens / 1_000_000) *
        pricing.inputCostPerMillion;


    const outputCost =
        (outputTokens / 1_000_000) *
        pricing.outputCostPerMillion;


    return {

        inputCost,

        outputCost,

        totalCost: inputCost + outputCost,

        currency: pricing.currency,

        pricingVersion: pricing.pricingVersion,

        pricingAvailable: true

    };

};