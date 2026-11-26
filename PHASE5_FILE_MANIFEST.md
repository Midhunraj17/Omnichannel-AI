# Files in this package

## Create
- `database/migrations/016_phase5_knowledge_rag.sql`
- `ai-service/app/services/knowledge_ingestion.py`
- `ai-service/app/api/routes/knowledge.py`
- `ai-service/tests/test_knowledge_ingestion.py`
- `backend/src/services/knowledge-base.service.js`
- `backend/src/controllers/knowledge-base.controller.js`
- `backend/src/routes/knowledge-base.routes.js`

## Additive / instructions
- `ai-service/PHASE5_REQUIREMENTS_ADDITIONS.txt`
- `INTEGRATION_PATCHES.md`
- `TESTING.md`
- `README_PHASE5.md`

## Existing files to edit (small edits, not full replacement)
- `ai-service/app/main.py` — register protected knowledge router.
- `backend/src/routes/index.js` — register knowledge-base routes.
- `backend/src/app.js` — increase JSON limit to 15 MiB.
- `backend/.env` — add `COHERE_EMBED_MODEL` label if not already present.
- `backend/src/controllers/ai.controller.js` and `backend/src/services/ai.service.js`
  — apply the RAG context injection described in `INTEGRATION_PATCHES.md`.

No Phase 1–4 migration or existing ticket workflow file is replaced.
