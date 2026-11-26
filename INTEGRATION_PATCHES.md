# Exact integration patches

Apply these small edits to the existing repository. They are deliberately kept
separate from the new files so Phase 4 code is not replaced wholesale.

## 1. FastAPI router registration

In `ai-service/app/main.py`:

- Add `knowledge` to the import tuple:
  `from app.api.routes import (..., knowledge)`
- Add `(knowledge.router, "Knowledge Base Ingestion"),` to `protected_routes`.

## 2. Express route registration

In `backend/src/routes/index.js`:

- Add `import knowledgeBaseRoutes from './knowledge-base.routes.js';`
- Add `router.use('/knowledge-bases', knowledgeBaseRoutes);`

## 3. Increase JSON payload limit for base64 documents

In `backend/src/app.js`, change:
`app.use(express.json({ limit: '1mb' }));`
to:
`app.use(express.json({ limit: '15mb' }));`

The actual decoded upload limit is independently checked by the service (10 MiB).
For production, a streaming multipart upload to Supabase Storage is preferred;
this JSON/base64 route is a bounded first implementation.

## 4. Add the embedding model to backend environment

Add `COHERE_EMBED_MODEL=embed-v5.0-pro` to backend `.env`.
The backend only stores the model label; Cohere credentials remain in the AI
service and are never exposed to the browser.

## 5. Chatbot-to-knowledge-base association

The existing `knowledge_bases.chatbot_id` column already exists. Create a KB
with `chatbot_id` set to the chatbot UUID. The chat controller must only select
the KB where BOTH `organization_id` and `chatbot_id` match. Never accept a
knowledge-base ID from an untrusted customer request as the authorization
source.

## 6. Retrieval injection into the existing response generation

The current chat controller calls `generateAIResponseFn({ message, history,
domain, requiredEntities })`. The Phase 5 RAG retrieval call must be inserted
after loading chatbot settings and before this call:

1. Resolve the active KB with:
   `SELECT id FROM public.knowledge_bases WHERE organization_id=$1
    AND chatbot_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1`
2. If one exists, call the tenant-scoped vector retrieval service with
   `(organizationId, knowledgeBaseId, normalizedMessage)`.
3. Pass the returned context to `generateAIResponseFn` as
   `contextualContext`.

Do not add a caller-provided `organization_id` or `knowledge_base_id` to the
chat request body.

The backend AI service must serialize `contextual_context` to the FastAPI
`/api/v1/orchestrator/run` payload. The existing orchestrator already forwards
`contextual_result.contextual_context` to response generation; to inject retrieved
KB context, merge the retrieved context with that value in a clearly delimited
untrusted-reference section. Keep the existing system prompt and trust-boundary
instructions unchanged.

## 7. Important route body contract

Create KB:
`POST /api/v1/knowledge-bases`
Headers: `Authorization: Bearer <supabase access token>`,
`X-Organization-Id: <organization UUID>`
Body:
`{"name":"Help Center","description":"Public support documentation","chatbot_id":"<chatbot UUID>"}`

List KBs:
`GET /api/v1/knowledge-bases`

Upload document:
`POST /api/v1/knowledge-bases/<kb UUID>/documents`
Body:
`{"file_name":"faq.pdf","content_base64":"<base64 bytes>"}`

Delete document:
`DELETE /api/v1/knowledge-bases/documents/<document UUID>`

All writes require `owner` or `admin` organization role.
