# Phase 3 — Task 3.6: AI Orchestrator

## Files
- `app/schemas/orchestration.py`
- `app/services/orchestrator.py`
- `app/api/routes/orchestrator.py`
- `tests/test_orchestrator.py`
- Updated `app/main.py`

## Endpoint
`POST /api/v1/orchestrator/run`

Example request:
```json
{
  "message": "Hello, can you explain your service?",
  "history": [],
  "domain": "general",
  "required_entities": [],
  "conversation_summary": null
}
```

## Important integration/security boundary
The caller must authenticate and authorize the conversation before sending its history.
Do not trust client-supplied history, organization IDs, customer IDs, or conversation IDs.
This AI-service endpoint is not a substitute for authentication/authorization in the Express backend.

The orchestrator only coordinates AI engines. It does not execute refunds,
cancellations, ticket updates, or agent assignment. Product/support destinations
are returned as routing decisions until authorized backend agents are integrated.

## Apply
Copy the new files into the matching paths. Replace `app/main.py` with the
updated version in this patch.

## Test
From `ai-service` with the virtual environment activated:
```powershell
pytest -q
```
