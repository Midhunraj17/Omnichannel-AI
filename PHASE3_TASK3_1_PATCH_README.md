# Phase 3 — Task 3.1: Intent Classification Engine

This patch adds the first implementation of the intent-classification endpoint to the existing `ai-service`.

## Files added
- `ai-service/app/schemas/intent.py` — request/response contracts and allowed intent type.
- `ai-service/app/services/intent_rules.py` — high-precision deterministic rules.
- `ai-service/app/services/intent_service.py` — hybrid rules + Cohere classifier and output validation.
- `ai-service/app/api/routes/intent.py` — FastAPI endpoint.
- `ai-service/tests/` — unit tests.

## File modified
- `ai-service/app/main.py` — registers the intent router.

## Endpoint
`POST http://localhost:8000/api/v1/intent/classify`

Example request:
```json
{
  "message": "Where is my order?",
  "context": {
    "previous_intent": null,
    "conversation_summary": null,
    "recent_messages": []
  }
}
```

Example response:
```json
{
  "success": true,
  "primary_intent": "ORDER_TRACKING",
  "intents": [
    { "name": "ORDER_TRACKING", "confidence": 0.94 }
  ],
  "confidence": 0.94,
  "classification_method": "rules",
  "handoff_requested": false,
  "requires_clarification": false
}
```

## Apply the patch
Copy the included `ai-service` directory into the existing repository and allow the `app/main.py` file to be replaced. Do not replace your `.env` file.

Ensure `COHERE_API_KEY` is set in `ai-service/.env` for messages that do not match deterministic rules. The existing configured `COHERE_CHAT_MODEL` is reused.

Start the AI service from `ai-service`:
```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

Test the endpoint with the JSON request above. Interactive API docs are available at `http://localhost:8000/docs`.

## Behaviour
- Exact greetings, thanks, and goodbyes can be handled without an LLM call.
- High-precision known phrases are classified by rules.
- Unmatched or semantically complex messages are sent to Cohere.
- Cohere output is restricted to the supported intent taxonomy.
- Multiple rule/LLM intents can be returned.
- `UNKNOWN` is a classification result; provider failure is returned as HTTP 503, not mislabeled as `UNKNOWN`.
- A human request sets `handoff_requested`; this endpoint does not itself create a ticket or transfer a conversation.

## Important integration/security note
This endpoint is currently an internal AI-service endpoint. The repository snapshot does not yet show verified end-user authentication/tenant-context propagation into FastAPI. Do not expose this service directly to the public internet. Before production, the backend must authenticate the caller and pass trusted organization context through a protected service-to-service mechanism. Tenant-specific intent configuration will be added when the organization configuration layer is implemented.

## Validation performed for this patch
- Python bytecode compilation passed.
- Five deterministic rule smoke checks passed.
- Full pytest execution and live Cohere API validation were not performed in this environment because the uploaded Windows virtual environment cannot be executed here and the Cohere SDK is not installed in the analysis runtime.
