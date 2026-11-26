import { pool } from '../config/database.js';
import { env } from '../config/env.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = Number(process.env.KNOWLEDGE_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);

async function callAiIngestion(fileName, base64) {
    const response = await fetch(`${env.aiServiceUrl}/api/v1/knowledge/ingest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.aiServiceApiKey}`
        },
        body: JSON.stringify({ file_name: fileName, content_base64: base64 }),
        signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || 'Knowledge ingestion service failed.');
    }
    return response.json();
}

export const createKnowledgeBase = async ({ organizationId, chatbotId, name, description }) => {
    if (!UUID_RE.test(organizationId)) throw new TypeError('Invalid organization ID.');
    if (chatbotId && !UUID_RE.test(chatbotId)) throw new TypeError('Invalid chatbot ID.');
    if (typeof name !== 'string' || !name.trim() || name.length > 120) {
        throw new TypeError('Knowledge base name must be 1–120 characters.');
    }

    if (chatbotId) {
        const owner = await pool.query(
            'SELECT id FROM public.chatbots WHERE id=$1 AND organization_id=$2',
            [chatbotId, organizationId]
        );
        if (!owner.rowCount) throw new Error('Chatbot not found in this organization.');
    }

    const result = await pool.query(
        `INSERT INTO public.knowledge_bases
            (organization_id, chatbot_id, name, description, status)
         VALUES ($1,$2,$3,$4,'active')
         RETURNING id, organization_id, chatbot_id, name, description, status, created_at`,
        [organizationId, chatbotId || null, name.trim(), description?.trim() || null]
    );
    return result.rows[0];
};

export const listKnowledgeBases = async (organizationId) => {
    const result = await pool.query(
        `SELECT kb.id, kb.chatbot_id, kb.name, kb.description, kb.status,
                kb.created_at, COUNT(kd.id)::int AS document_count
         FROM public.knowledge_bases kb
         LEFT JOIN public.knowledge_documents kd ON kd.knowledge_base_id=kb.id
         WHERE kb.organization_id=$1
         GROUP BY kb.id ORDER BY kb.created_at DESC`,
        [organizationId]
    );
    return result.rows;
};

export const ingestKnowledgeDocument = async ({
    organizationId, memberId, knowledgeBaseId, fileName, contentBase64
}) => {
    if (!UUID_RE.test(knowledgeBaseId)) throw new TypeError('Invalid knowledge base ID.');
    if (typeof fileName !== 'string' || fileName.length > 255) throw new TypeError('Invalid file name.');
    if (typeof contentBase64 !== 'string') throw new TypeError('Document content is required.');

    const raw = Buffer.from(contentBase64, 'base64');
    if (!raw.length || raw.length > MAX_BYTES) throw new TypeError('File must be between 1 byte and configured upload limit.');

    const kb = await pool.query(
        `SELECT id FROM public.knowledge_bases
         WHERE id=$1 AND organization_id=$2 AND status='active'`,
        [knowledgeBaseId, organizationId]
    );
    if (!kb.rowCount) throw new Error('Knowledge base not found or inactive.');

    const inserted = await pool.query(
        `INSERT INTO public.knowledge_documents
            (knowledge_base_id, uploaded_by_member_id, file_name, storage_path,
             file_type, mime_type, file_size, status)
         VALUES ($1,$2,$3,$4,$5,$5,$6,'processing')
         RETURNING id`,
        [knowledgeBaseId, memberId || null, fileName, `inline:${knowledgeBaseId}/${Date.now()}/${fileName}`,
         fileName.split('.').pop()?.toLowerCase() || null, raw.length]
    );
    const documentId = inserted.rows[0].id;

    try {
        const processed = await callAiIngestion(fileName, raw.toString('base64'));
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const chunk of processed.chunks) {
                const row = await client.query(
                    `INSERT INTO public.knowledge_chunks
                        (document_id, chunk_index, content, token_count, metadata)
                     VALUES ($1,$2,$3,$4,$5::jsonb)
                     RETURNING id`,
                    [documentId, chunk.chunk_index, chunk.content, chunk.token_count,
                     JSON.stringify(chunk.metadata || {})]
                );
                const vector = `[${chunk.embedding.map(Number).join(',')}]`;
                await client.query(
                    `INSERT INTO public.document_embeddings
                        (chunk_id, embedding, embedding_model)
                     VALUES ($1,$2::vector,$3)`,
                    [row.rows[0].id, vector, process.env.COHERE_EMBED_MODEL || 'embed-v5.0-pro']
                );
            }
            await client.query(
                `UPDATE public.knowledge_documents
                 SET status='completed', content_hash=$2, processed_at=NOW(),
                     updated_at=NOW(), error_message=NULL
                 WHERE id=$1`,
                [documentId, processed.content_hash]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        return { document_id: documentId, status: 'completed', chunk_count: processed.chunks.length };
    } catch (error) {
        await pool.query(
            `UPDATE public.knowledge_documents
             SET status='failed', error_message=$2, updated_at=NOW()
             WHERE id=$1`,
            [documentId, String(error.message).slice(0, 500)]
        );
        throw error;
    }
};

export const deleteKnowledgeDocument = async ({ organizationId, documentId }) => {
    const result = await pool.query(
        `DELETE FROM public.knowledge_documents kd
         USING public.knowledge_bases kb
         WHERE kd.id=$1 AND kb.id=kd.knowledge_base_id
           AND kb.organization_id=$2
         RETURNING kd.id`,
        [documentId, organizationId]
    );
    return result.rowCount > 0;
};
