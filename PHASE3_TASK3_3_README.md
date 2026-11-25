# Phase 3 — Task 3.3: Conversation Context Manager

## Included
- `ai-service/app/schemas/context.py`: normalized LLM message and result schemas.
- `ai-service/app/services/context_manager.py`: deterministic role mapping, validation, message-count limit and character budget.
- `ai-service/tests/test_context_manager.py`: nine focused unit tests.

## Security and integration boundary
This patch intentionally does not expose a public API route and does not connect
to PostgreSQL. Express must authenticate the caller, verify tenant membership
and conversation ownership, and retrieve authorized history before passing it
to the AI service. Never accept arbitrary client-supplied history as trusted data.

`history` must contain prior persisted messages only. The current message is
passed separately and appended exactly once. History order is preserved; the
backend query should retrieve it in chronological order (`created_at ASC`).

## Apply
Extract the ZIP at the repository root so its `ai-service` folder merges with
the existing folder. Do not extract inside `ai-service`.

## Test from repository root
```powershell
cd .\ai-service
.\.venv\Scripts\python.exe -m pytest tests\test_context_manager.py -q
.\.venv\Scripts\python.exe -m pytest -q
```

This component prepares context only. It is not persistence, authentication,
long-term memory, summarization, or orchestration.
