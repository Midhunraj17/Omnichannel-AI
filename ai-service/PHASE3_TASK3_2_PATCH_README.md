# Phase 3 — Task 3.2: Entity Extraction Engine

This patch extends the existing `ai-service` created in Task 3.1. It does not replace the Node backend, frontend, database, environment files, or Cohere configuration.

## Files added
- `ai-service/app/schemas/entities.py` — request/response contracts.
- `ai-service/app/services/entity_rules.py` — conservative regex/rule extraction for structured values.
- `ai-service/app/services/entity_service.py` — rule + Cohere semantic extraction, domain allowlists, de-duplication, and missing-entity calculation.
- `ai-service/app/api/routes/entities.py` — FastAPI endpoint.
- `ai-service/tests/test_entity_rules.py` and `test_entity_service.py` — unit tests.

## File modified
- `ai-service/app/main.py` — registers the entities router while retaining health, chat, and Task 3.1 intent routes.

## Endpoint
`POST http://localhost:8000/api/v1/entities/extract`

Example request:
```json
{
  "message": "My order ORD-12345 has not arrived. Contact me at alien@example.com. I need 2 units.",
  "domain": "ecommerce",
  "required_entities": ["ORDER_ID", "EMAIL_ADDRESS", "PRODUCT_NAME"]
}
```

The response returns extracted candidates, missing required entity types, extraction method, and a clarification flag. Exact confidence values are heuristic/model-reported and are not calibrated probabilities.

## Apply
1. Back up `ai-service/app/main.py`.
2. Extract this ZIP into the repository root, allowing the included `ai-service/app/main.py` to merge/replace the existing file.
3. Do not replace `.env` or `.env.example`.
4. From `ai-service`, with `.venv` active, run `python -m pytest tests -v`.
5. Start with `uvicorn app.main:app --reload --port 8000` and test in `/docs`.

## Important semantics
- Entity values are candidates, not verified business records.
- `validation_status` is always `unverified`. The AI service does not check order existence, customer ownership, account access, or business-system truth.
- `required_entities` must be supplied by a trusted workflow/intent caller. The extractor does not assume every absent entity is missing.
- Domain controls the allowed semantic entity types: `general`, `ecommerce`, `product`, `saas`, `service`.
- Deterministic values are extracted locally. Cohere is used for semantic values such as person/product/service names, locations, descriptions, and feature names.
- If Cohere fails but deterministic entities were extracted, those candidates are returned. If no deterministic entities exist, the endpoint returns HTTP 503 rather than pretending extraction succeeded.
- Tenant identity and authorization are not implemented in this internal endpoint. Keep it behind the trusted backend; do not expose FastAPI publicly.

## Tests
The included tests cover deterministic extraction and missing-entity behavior. Run the full AI-service test suite to ensure Task 3.1 remains green.
