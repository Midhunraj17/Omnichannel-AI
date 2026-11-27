import { createHash } from 'node:crypto';
import path from 'node:path';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = Number(process.env.KNOWLEDGE_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx']);
const EMBEDDING_MODEL = process.env.COHERE_EMBED_MODEL || 'embed-v5.0-pro';
const EMBEDDING_DIMENSION = Number(process.env.COHERE_EMBED_DIMENSION || 1024);

function assertUuid(value, label) {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
        const error = new TypeError(`Invalid ${label}.`);
        error.statusCode = 400;
        throw error;
    }
}

function decodeBase64(value) {
    if (typeof value !== 'string' || !value.trim()) {
        const error = new TypeError('Document content is required.');
        error.statusCode = 400;
        throw error;
    }
    // Reject malformed base64 rather than silently accepting truncated bytes.
    const normalized = value.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
        const error = new TypeError('Document content must be valid base64.');
        error.statusCode = 400;
        throw error;
    }
    const raw = Buffer.from(normalized, 'base64');
    if (!raw.length || raw.length > MAX_BYTES) {
        const error = new TypeError(`File must be between 1 byte and ${MAX_BYTES} bytes.`);
        error.statusCode = 413;
        throw error;
    }
    return raw;
}

async function callAiIngestion(fileName, base64) {
    const response = await fetch(`${env.aiServiceUrl}/api/v1/knowledge/ingest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.aiServiceApiKey}`
        },
        body: JSON.stringify({ file_name: fileName, content_base64: base64 }),
        signal: AbortSignal.timeout(180000)
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.detail || 'Knowledge ingestion service failed.');
        error.statusCode = response.status === 422 ? 422 : 502;
        throw error;
    }
    return response.json();
}

export const createKnowledgeBase = async ({
    organizationId, memberId, chatbotId, name, description
}) => {
    assertUuid(organizationId, 'organization ID');
    if (chatbotId) assertUuid(chatbotId, 'chatbot ID');

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
        const error = new TypeError('Knowledge base name must contain 1–120 characters.');
        error.statusCode = 400;
        throw error;
    }
    if (description != null && (typeof description !== 'string' || description.length > 2000)) {
        const error = new TypeError('Description must be at most 2000 characters.');
        error.statusCode = 400;
        throw error;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (chatbotId) {
            const owner = await client.query(
                `SELECT id FROM public.chatbots
                 WHERE id=$1 AND organization_id=$2`,
                [chatbotId, organizationId]
            );
            if (!owner.rowCount) {
                const error = new Error('Chatbot not found in this organization.');
                error.statusCode = 404;
                throw error;
            }
        }

        const result = await client.query(
            `INSERT INTO public.knowledge_bases
                (organization_id, chatbot_id, created_by_member_id, name, description, status)
             VALUES ($1,$2,$3,$4,$5,'active')
             RETURNING id, organization_id, chatbot_id, name, description,
                       status, retrieval_config, created_at, updated_at`,
            [organizationId, chatbotId || null, memberId || null, name.trim(),
                description?.trim() || null]
        );
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const listKnowledgeBases = async (organizationId) => {
    assertUuid(organizationId, 'organization ID');
    const result = await pool.query(
        `SELECT kb.id, kb.chatbot_id, kb.name, kb.description, kb.status,
                kb.retrieval_config, kb.created_at, kb.updated_at,
                COUNT(kd.id)::int AS document_count
         FROM public.knowledge_bases kb
         LEFT JOIN public.knowledge_documents kd ON kd.knowledge_base_id=kb.id
         WHERE kb.organization_id=$1
         GROUP BY kb.id
         ORDER BY kb.created_at DESC`,
        [organizationId]
    );
    return result.rows;
};

export const ingestKnowledgeDocument = async ({
    organizationId, memberId, knowledgeBaseId, fileName, contentBase64
}) => {
    assertUuid(organizationId, 'organization ID');
    assertUuid(knowledgeBaseId, 'knowledge base ID');

    if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255 ||
        path.basename(fileName) !== fileName || fileName.includes('\0')) {
        const error = new TypeError('Invalid file name.');
        error.statusCode = 400;
        throw error;
    }
    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
        const error = new TypeError('Supported files: TXT, MD, PDF and DOCX.');
        error.statusCode = 415;
        throw error;
    }

    const raw = decodeBase64(contentBase64);
    const contentHash = createHash('sha256').update(raw).digest('hex');

    const kb = await pool.query(
        `SELECT id FROM public.knowledge_bases
         WHERE id=$1 AND organization_id=$2 AND status='active'`,
        [knowledgeBaseId, organizationId]
    );
    if (!kb.rowCount) {
        const error = new Error('Knowledge base not found or inactive.');
        error.statusCode = 404;
        throw error;
    }

    const duplicate = await pool.query(
        `SELECT id FROM public.knowledge_documents
         WHERE knowledge_base_id=$1 AND content_hash=$2
           AND status <> 'failed'
         LIMIT 1`,
        [knowledgeBaseId, contentHash]
    );
    if (duplicate.rowCount) {
        const error = new Error('This file content already exists in the knowledge base.');
        error.statusCode = 409;
        throw error;
    }

    const inserted = await pool.query(
        `INSERT INTO public.knowledge_documents
            (knowledge_base_id, uploaded_by_member_id, file_name, storage_path,
             file_type, mime_type, file_size, content_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing')
         RETURNING id`,
        [
            knowledgeBaseId, memberId || null, fileName,
            `inline:${knowledgeBaseId}/${contentHash}/${fileName}`,
            extension.slice(1), extension === '.pdf' ? 'application/pdf'
                : extension === '.docx'
                    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    : extension === '.md' ? 'text/markdown' : 'text/plain',
            raw.length, contentHash
        ]
    );
    const documentId = inserted.rows[0].id;

    try {
        const processed = await callAiIngestion(fileName, raw.toString('base64'));
        if (!Array.isArray(processed.chunks) || processed.chunks.length === 0) {
            throw new Error('Ingestion service returned no document chunks.');
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const chunk of processed.chunks) {
                if (!Array.isArray(chunk.embedding) ||
                    chunk.embedding.length !== EMBEDDING_DIMENSION ||
                    chunk.embedding.some(value => !Number.isFinite(Number(value)))) {
                    throw new Error('Invalid embedding returned by AI service.');
                }
                if (typeof chunk.content !== 'string' || !chunk.content.trim()) {
                    throw new Error('Invalid empty chunk returned by AI service.');
                }

                const chunkResult = await client.query(
                    `INSERT INTO public.knowledge_chunks
                        (document_id, chunk_index, content, token_count, metadata)
                     VALUES ($1,$2,$3,$4,$5::jsonb)
                     RETURNING id`,
                    [
                        documentId, chunk.chunk_index, chunk.content,
                        chunk.token_count ?? null,
                        JSON.stringify(chunk.metadata || {})
                    ]
                );

                const vectorLiteral = `[${chunk.embedding.map(Number).join(',')}]`;
                await client.query(
                    `INSERT INTO public.document_embeddings
                        (chunk_id, embedding, embedding_model)
                     VALUES ($1,$2::extensions.vector,$3)`,
                    [chunkResult.rows[0].id, vectorLiteral, EMBEDDING_MODEL]
                );
            }

            await client.query(
                `UPDATE public.knowledge_documents
                 SET status='completed', content_hash=$2, processed_at=NOW(),
                     updated_at=NOW(), error_message=NULL
                 WHERE id=$1`,
                [documentId, processed.content_hash || contentHash]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        return {
            document_id: documentId,
            file_name: fileName,
            status: 'completed',
            character_count: processed.character_count,
            chunk_count: processed.chunks.length,
            content_hash: processed.content_hash || contentHash
        };
    } catch (error) {
        await pool.query(
            `UPDATE public.knowledge_documents
             SET status='failed', error_message=$2, updated_at=NOW()
             WHERE id=$1`,
            [documentId, String(error.message || 'Processing failed').slice(0, 500)]
        );
        throw error;
    }
};

export const deleteKnowledgeDocument = async ({ organizationId, documentId }) => {
    assertUuid(organizationId, 'organization ID');
    assertUuid(documentId, 'document ID');
    const result = await pool.query(
        `DELETE FROM public.knowledge_documents AS kd
         USING public.knowledge_bases AS kb
         WHERE kd.id=$1
           AND kb.id=kd.knowledge_base_id
           AND kb.organization_id=$2
         RETURNING kd.id`,
        [documentId, organizationId]
    );
    return result.rowCount > 0;
};
