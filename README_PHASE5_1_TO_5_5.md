# Omnichannel AI — Phase 5.1 to 5.5 implementation

Target branch inspected: `feature/phase-4.1-completion` at commit `96ea598c31980d71555350dee31a114e0193d932`.

This package completes the **foundation scope** for:
- 5.1 Knowledge-base data model and organization ownership
- 5.2 Document ingestion endpoint and backend lifecycle
- 5.3 TXT, Markdown, PDF and DOCX extraction
- 5.4 Normalization and deterministic overlapping chunking
- 5.5 Cohere embedding generation and persistence in `document_embeddings`

It does **not** implement semantic/hybrid retrieval, reranking, context construction, or chat/orchestrator integration (those are later tasks 5.6–5.9).

## Files to replace/create

Replace:
1. `database/migrations/016_phase5_knowledge_rag.sql`
2. `ai-service/app/services/knowledge_ingestion.py`
3. `ai-service/app/api/routes/knowledge.py`
4. `ai-service/app/main.py`
5. `ai-service/requirements.txt`
6. `backend/src/services/knowledge-base.service.js`
7. `backend/src/controllers/knowledge-base.controller.js`
8. `backend/src/routes/knowledge-base.routes.js`
9. `backend/src/routes/index.js`
10. `backend/src/app.js`

Create:
11. `ai-service/tests/test_knowledge_ingestion.py`

Existing middleware imports were verified against the repository:
- `authenticateUser` from `backend/src/middleware/auth.middleware.js`
- `requireOrganization`, `requireRoles` from `backend/src/middleware/organization.middleware.js`

## Important prerequisites

1. Run this from the repository root (`OMNICHANNEL-AI`).
2. Apply migration `016_phase5_knowledge_rag.sql` in Supabase SQL Editor. It is idempotent for the added columns/indexes and replaces the search function if one already exists.
3. Ensure the PostgreSQL connection used by `backend/src/config/database.js` has permission to insert into the four knowledge tables. The backend uses the existing privileged server-side `DATABASE_URL`; never expose it to the browser.
4. Set `COHERE_API_KEY`, `COHERE_EMBED_MODEL`, `COHERE_EMBED_DIMENSION=1024` in the AI-service environment. Keep `AI_SERVICE_API_KEY` identical between backend and AI service.
5. `pypdf` and `python-docx` are added to requirements.

## Upload API

All endpoints are mounted below `/api/v1`:
- `GET /knowledge-bases`
- `POST /knowledge-bases` (owner/admin)
- `POST /knowledge-bases/:knowledgeBaseId/documents` (owner/admin)
- `DELETE /knowledge-bases/documents/:documentId` (owner/admin)

Headers:
- `Authorization: Bearer <Supabase access token>`
- `x-organization-id: <organization UUID>`

Create body:
```json
{"name":"Product Help","description":"Product documentation","chatbot_id":null}
```

Upload body:
```json
{"file_name":"faq.pdf","content_base64":"<base64 file bytes>"}
```

Upload limit defaults to 10 MiB raw file size. The Express JSON body limit is raised to 15 MiB to accommodate base64 overhead. Configure `KNOWLEDGE_UPLOAD_MAX_BYTES` if required, but keep it below the JSON request limit after base64 expansion.

## Storage note

The current repository has no verified Supabase Storage bucket/upload abstraction for knowledge files. This implementation processes the uploaded bytes in memory and records an `inline:` reference as the current `storage_path`; it does not claim durable binary-file storage. Extracted text, chunks, hashes, metadata and embeddings are persisted. Durable original-file storage should be added with a private Storage bucket before production use.

## Run

AI service:
```powershell
cd .\ai-service
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest tests/test_knowledge_ingestion.py -q
python -m pytest -q
```

Backend:
```powershell
cd ..\backend
npm test
```

Start AI service and backend in separate terminals using your existing startup commands.

## Verify database

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='knowledge_documents'
ORDER BY ordinal_position;

SELECT COUNT(*) AS knowledge_bases FROM public.knowledge_bases;
SELECT COUNT(*) AS documents FROM public.knowledge_documents;
SELECT COUNT(*) AS chunks FROM public.knowledge_chunks;
SELECT COUNT(*) AS embeddings FROM public.document_embeddings;
```

## Scope / safety
- Organization ID is taken from authenticated membership middleware, not request JSON.
- Knowledge base is checked against the active organization before ingestion.
- Optional chatbot association is checked against the same organization.
- Upload routes are owner/admin only.
- Document writes and embedding writes are committed in one DB transaction after extraction/embedding succeeds.
- Failed processing marks the document `failed` with a bounded error message.
- Duplicate file content within the same knowledge base is rejected.
- Scanned/image-only PDFs are rejected with a clear OCR-required error.
