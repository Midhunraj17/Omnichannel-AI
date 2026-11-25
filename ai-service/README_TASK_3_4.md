# Phase 3 — Task 3.4: Routing Engine

## Included files

Copy these files into the existing `ai-service` directory, preserving paths:

- `app/schemas/routing.py`
- `app/services/routing_engine.py`
- `app/api/routes/routing.py`
- `tests/test_routing_engine.py`

## Register the API route

In `app/main.py`, add `routing` to the existing route imports:

```python
from app.api.routes import health, chat, intent, entities, routing
```

Then register the router:

```python
app.include_router(routing.router, prefix="/api/v1", tags=["Routing"])
```

Do not replace the rest of `main.py`.

## Routing policy

- Explicit handoff always routes to `HUMAN_AGENT`.
- `AMBIGUOUS`, `UNKNOWN`, and explicit clarification requests route to `CLARIFICATION_REQUIRED`.
- Product/commercial enquiries route to `PRODUCT_AGENT`.
- Order, payment, account, complaint, ticket, return, refund and technical issues route to `SUPPORT_AGENT`.
- Greetings, thanks, general questions and out-of-scope messages route to `GENERAL_AI`.
- A selected intent confidence below 0.60 requires clarification.
- For multiple intents, support takes precedence over product, and product takes precedence over general conversation.

The routing engine is deterministic and does not call Cohere.

## API

`POST /api/v1/routing/decide`

Example request:

```json
{
  "classification": {
    "success": true,
    "primary_intent": "REFUND_REQUEST",
    "intents": [
      {"name": "REFUND_REQUEST", "confidence": 0.96}
    ],
    "confidence": 0.96,
    "classification_method": "rules",
    "handoff_requested": false,
    "requires_clarification": false
  }
}
```

Expected destination: `SUPPORT_AGENT`.

## Run tests

From `ai-service`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_routing_engine.py -v
```

Then run the full suite:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

The routing endpoint consumes an already-produced intent classification. It does not itself invoke the intent engine, access the database, assign an agent, or execute a ticket action. Those responsibilities belong to later orchestration/backend components.
