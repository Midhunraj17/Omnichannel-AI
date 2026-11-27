# Phase 5 test and smoke-test plan

## AI service

From `ai-service/`:

```powershell
pip install -r requirements.txt
pip install pypdf python-docx
python -m pytest -q
```

Add focused tests for the new ingestion service:

```python
from app.services.knowledge_ingestion import chunk_text, normalize_text

def test_chunk_text_overlap_and_coverage():
    text = ("A useful knowledge sentence. " * 150)
    chunks = chunk_text(text, chunk_chars=500, overlap_chars=50)
    assert len(chunks) > 1
    assert all(chunks)
    assert chunks[0] in text
```

The full existing AI-service suite should remain green. Cohere-dependent
integration tests require a configured API key and should be run separately.

## Backend

From `backend/`:

```powershell
npm test
```

Then run:
```powershell
npm run dev
```

Smoke-test the four routes described in `INTEGRATION_PATCHES.md`. Confirm:
- missing bearer token returns 401;
- missing/invalid organization ID returns 400;
- a user outside the organization cannot list/create KBs;
- support-agent role cannot upload/delete documents;
- a chatbot belonging to another organization cannot be attached;
- unsupported file extensions and empty documents fail cleanly;
- successful ingestion creates one document, N chunks, and N embeddings;
- deleting a document cascades to chunks and embeddings.

## Supabase checks

After migration 016:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='knowledge_documents'
ORDER BY ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('knowledge_bases','knowledge_documents','knowledge_chunks','document_embeddings');

SELECT proname
FROM pg_proc
JOIN pg_namespace n ON n.oid=pg_proc.pronamespace
WHERE n.nspname='public' AND proname='search_knowledge_chunks';
```

## Operational caveats

- The SQL function expects a session setting `app.embedding_model` to be set
  when called. The supplied backend ingestion path stores the configured model
  label. If you wire direct RPC search, set the session value on the same DB
  connection before invoking the function.
- This first delivery stores document bytes transiently in the request and
  stores chunk text/embeddings in Postgres. It does not yet persist the original
  binary into Supabase Storage. For production-scale uploads, switch to private
  Storage bucket upload with signed URLs and stream extraction from the object.
- OCR for scanned PDFs, URL crawling, spreadsheet ingestion, incremental
  re-indexing, and multi-KB weighted retrieval are not included in this phase.
