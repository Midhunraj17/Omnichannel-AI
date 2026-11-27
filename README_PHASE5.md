# Phase 5 — Tenant-isolated Knowledge Base & RAG

Reference baseline: `Midhunraj17/Omnichannel-AI`, branch `main`, commit `defd45d`.
This package is an additive Phase 5 implementation package. It reuses the existing
`knowledge_bases`, `knowledge_documents`, `knowledge_chunks`, and
`document_embeddings` tables and the existing 1024-dimensional Cohere embedding
configuration. It does not recreate Phase 1–4 tables or replace the existing
ticket/orchestration architecture.

## Phase 5 deliverables

1. Knowledge-base/document lifecycle metadata and safe vector search RPC.
2. Tenant-scoped knowledge-base and document APIs in the Node backend.
3. Text/PDF/DOCX extraction and deterministic chunking in the AI service.
4. Cohere embedding and reranking through the existing lazy Cohere client.
5. Semantic retrieval constrained by organization + knowledge-base IDs.
6. Safe ingestion lifecycle (`uploaded → processing → completed/failed`).
7. Tests for chunking and tenant-scoped retrieval SQL contract.
8. Exact integration instructions and rollback notes.

## Important compatibility boundary

The repository currently has no complete document upload/RAG request path. The
existing chat controller invokes the orchestrator without a knowledge-base ID.
This package therefore adds the KB/document APIs and RAG retrieval primitives,
and includes a precise chat-integration patch guide. Do not silently enable
retrieval for every chatbot: first attach one active knowledge base to the
chatbot and then apply the chat integration patch.

The existing schema uses `VECTOR(1024)`. The configured Cohere model is
`embed-v5.0-pro` with dimension 1024. Keep those values aligned.

## Apply order

1. Copy the files under `database/` and `backend/` and `ai-service/` into the
   matching repository paths.
2. Apply `database/migrations/016_phase5_knowledge_rag.sql` in Supabase SQL
   Editor (or your migration runner) once.
3. Install the two AI-service dependencies:
   `pip install pypdf python-docx`
   (they are also listed in the Phase 5 requirements addition file).
4. Add the environment variables shown below.
5. Register the FastAPI router and Express router as documented in
   `INTEGRATION_PATCHES.md`.
6. Run tests and smoke tests in `TESTING.md`.

## Environment additions

Backend `.env`:
- `AI_SERVICE_URL` (already required by the existing backend)
- `AI_SERVICE_API_KEY` (already required)
- `KNOWLEDGE_UPLOAD_MAX_BYTES=10485760` (10 MiB default)

AI service `.env`:
- `COHERE_API_KEY` (already required)
- `COHERE_EMBED_MODEL=embed-v5.0-pro` (existing default)
- `COHERE_EMBED_DIMENSION=1024` (existing default)
- `KNOWLEDGE_MAX_CHUNK_CHARS=1200`
- `KNOWLEDGE_CHUNK_OVERLAP_CHARS=180`

## Supported input

- `.txt`, `.md`
- `.pdf` (text-based PDF; scanned/image-only PDFs require OCR and are rejected
  as empty rather than silently indexed)
- `.docx`

The upload API accepts JSON with `file_name`, `content_base64`, and
`knowledge_base_id`. The API intentionally avoids trusting a caller-supplied
`organization_id`: tenant ownership is derived from the authenticated request.

## Security properties

- Every KB lookup is filtered by both `organization_id` and `knowledge_base_id`.
- Every document/chunk/embedding write is reached only after KB ownership is
  verified by the backend.
- Vector search joins through KB → document → chunk → embedding and applies
  tenant and KB predicates in SQL.
- Authenticated users can read only their organization’s knowledge data under
  RLS. Mutating APIs require owner/admin roles.
- The AI service remains protected by the existing internal bearer key.
- Document text is treated as untrusted reference material, never as system
  instructions. Existing response-generation trust-boundary instructions remain
  authoritative.

## Rollback

If needed, stop calling the new APIs and execute the rollback section at the end
of migration 016. Do not drop the pre-existing knowledge tables.
