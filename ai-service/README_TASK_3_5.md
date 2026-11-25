# Phase 3 — Task 3.5 Cohere Integration

## Included
- Lazy Cohere v2 client creation with a configured request timeout.
- Centralized customer-support system prompt and message validation.
- Backward-compatible `generate_response(message)` function.
- `generate_response_with_metadata(...)` for response, model, finish reason and token usage.
- Bounded retry for HTTP 408, 425, 429 and 5xx responses, plus network/timeout errors.
- Unit tests using fake clients; tests do not call Cohere or consume API credits.

## Integration
1. Back up the current files:
   - `app/services/cohere_client.py`
   - `app/services/llm_service.py`
   - `app/core/config.py`
2. Merge the supplied `config_additions.txt` into your existing `Settings` class.
3. Copy the `app` and `tests` folders into the existing `ai-service` directory.
4. Do not replace `main.py`, `.env`, or requirements.txt.
5. Keep your real API key only in the local `.env`; never paste it into chat or commit it.

## Configuration additions
Add these class attributes to `Settings` in `app/core/config.py`:

```python
COHERE_TIMEOUT_SECONDS = float(os.getenv("COHERE_TIMEOUT_SECONDS", 30))
COHERE_MAX_RETRIES = int(os.getenv("COHERE_MAX_RETRIES", 2))
COHERE_RETRY_BASE_SECONDS = float(os.getenv("COHERE_RETRY_BASE_SECONDS", 0.5))
COHERE_RETRY_MAX_SECONDS = float(os.getenv("COHERE_RETRY_MAX_SECONDS", 4))
COHERE_MAX_TOKENS = int(os.getenv("COHERE_MAX_TOKENS", 800))
COHERE_TEMPERATURE = float(os.getenv("COHERE_TEMPERATURE", 0.3))
```

Optional `.env` values (do not share the file):
```env
COHERE_TIMEOUT_SECONDS=30
COHERE_MAX_RETRIES=2
COHERE_RETRY_BASE_SECONDS=0.5
COHERE_RETRY_MAX_SECONDS=4
COHERE_MAX_TOKENS=800
COHERE_TEMPERATURE=0.3
```

## Test
From `ai-service`:
```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_cohere_integration.py -v
.\.venv\Scripts\python.exe -m pytest -q
```

The tests mock the SDK client. They verify local behavior, not live Cohere credentials or model availability.

## Usage metadata
`generate_response_with_metadata` returns normalized token counts from Cohere's `meta.tokens` and `meta.billed_units`. This patch does not persist usage to Supabase and does not calculate currency costs; those require a durable usage schema and current model pricing. The usage adapter is ready for later persistence.
