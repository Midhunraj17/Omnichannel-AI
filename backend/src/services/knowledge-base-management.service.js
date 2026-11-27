import { pool } from '../config/database.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_RETRIEVAL_CONFIG = {
    top_k: 8,
    score_threshold: 0.15,
    min_rerank_score: 0.0
};

const ALLOWED_RETRIEVAL_FIELDS = new Set([
    'top_k',
    'score_threshold',
    'min_rerank_score'
]);

const createError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const validateUUID = (value, label) => {
    if (
        typeof value !== 'string' ||
        !UUID_REGEX.test(value)
    ) {
        throw createError(`Invalid ${label}.`);
    }
};

const validateRetrievalConfig = (config) => {
    if (
        !config ||
        typeof config !== 'object' ||
        Array.isArray(config)
    ) {
        throw createError(
            'Retrieval configuration must be an object.'
        );
    }

    const keys = Object.keys(config);

    if (!keys.length) {
        throw createError(
            'At least one retrieval setting must be supplied.'
        );
    }

    for (const key of keys) {
        if (!ALLOWED_RETRIEVAL_FIELDS.has(key)) {
            throw createError(
                `Unsupported retrieval setting: ${key}.`
            );
        }
    }

    const normalized = {};

    if ('top_k' in config) {
        if (
            !Number.isInteger(config.top_k) ||
            config.top_k < 1 ||
            config.top_k > 8
        ) {
            throw createError(
                'top_k must be an integer between 1 and 8.'
            );
        }

        normalized.top_k = config.top_k;
    }

    if ('score_threshold' in config) {
        if (
            typeof config.score_threshold !== 'number' ||
            !Number.isFinite(config.score_threshold) ||
            config.score_threshold < 0 ||
            config.score_threshold > 1
        ) {
            throw createError(
                'score_threshold must be between 0 and 1.'
            );
        }

        normalized.score_threshold =
            config.score_threshold;
    }

    if ('min_rerank_score' in config) {
        if (
            typeof config.min_rerank_score !== 'number' ||
            !Number.isFinite(config.min_rerank_score) ||
            config.min_rerank_score < 0 ||
            config.min_rerank_score > 1
        ) {
            throw createError(
                'min_rerank_score must be between 0 and 1.'
            );
        }

        normalized.min_rerank_score =
            config.min_rerank_score;
    }

    return normalized;
};

export const createKnowledgeBaseManagementService = ({
    database = pool
} = {}) => {

    // =====================================================
    // GET KNOWLEDGE BASE DETAILS
    // =====================================================

    const getKnowledgeBase = async ({
        organizationId,
        knowledgeBaseId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');

        const result = await database.query(
            `
                SELECT
                    kb.id,
                    kb.organization_id,
                    kb.chatbot_id,
                    kb.name,
                    kb.description,
                    kb.status,
                    kb.retrieval_config,
                    kb.created_at,
                    kb.updated_at,

                    COUNT(kd.id)::INTEGER AS document_count,

                    COUNT(kd.id) FILTER (
                        WHERE kd.status = 'completed'
                    )::INTEGER AS completed_documents,

                    COUNT(kd.id) FILTER (
                        WHERE kd.status = 'processing'
                    )::INTEGER AS processing_documents,

                    COUNT(kd.id) FILTER (
                        WHERE kd.status = 'failed'
                    )::INTEGER AS failed_documents

                FROM public.knowledge_bases kb

                LEFT JOIN public.knowledge_documents kd
                    ON kd.knowledge_base_id = kb.id

                WHERE kb.id = $1
                  AND kb.organization_id = $2

                GROUP BY kb.id

                LIMIT 1;
            `,
            [
                knowledgeBaseId,
                organizationId
            ]
        );

        if (!result.rowCount) {
            return null;
        }

        return result.rows[0];
    };


    // =====================================================
    // LIST DOCUMENTS
    // =====================================================

    const listKnowledgeBaseDocuments = async ({
        organizationId,
        knowledgeBaseId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');

        const ownership = await database.query(
            `
                SELECT id
                FROM public.knowledge_bases
                WHERE id = $1
                  AND organization_id = $2
                LIMIT 1;
            `,
            [
                knowledgeBaseId,
                organizationId
            ]
        );

        if (!ownership.rowCount) {
            return null;
        }

        const result = await database.query(
            `
                SELECT
                    kd.id,
                    kd.knowledge_base_id,
                    kd.file_name,
                    kd.file_type,
                    kd.mime_type,
                    kd.file_size,
                    kd.status,
                    kd.error_message,
                    kd.content_hash,
                    kd.processed_at,
                    kd.created_at,
                    kd.updated_at,

                    COUNT(kc.id)::INTEGER AS chunk_count

                FROM public.knowledge_documents kd

                LEFT JOIN public.knowledge_chunks kc
                    ON kc.document_id = kd.id

                WHERE kd.knowledge_base_id = $1

                GROUP BY kd.id

                ORDER BY kd.created_at DESC;
            `,
            [knowledgeBaseId]
        );

        return result.rows;
    };


    // =====================================================
    // UPDATE RETRIEVAL CONFIGURATION
    // =====================================================

    const updateRetrievalConfig = async ({
        organizationId,
        knowledgeBaseId,
        config
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');

        const normalizedConfig =
            validateRetrievalConfig(config);

        const result = await database.query(
            `
                UPDATE public.knowledge_bases

                SET
                    retrieval_config =
                        COALESCE(retrieval_config, '{}'::jsonb)
                        || $3::jsonb,

                    updated_at = NOW()

                WHERE id = $1
                  AND organization_id = $2

                RETURNING
                    id,
                    organization_id,
                    chatbot_id,
                    name,
                    status,
                    retrieval_config,
                    updated_at;
            `,
            [
                knowledgeBaseId,
                organizationId,
                JSON.stringify(normalizedConfig)
            ]
        );

        return result.rows[0] ?? null;
    };


    // =====================================================
    // ACTIVATE / DEACTIVATE KNOWLEDGE BASE
    // =====================================================

    const updateKnowledgeBaseStatus = async ({
        organizationId,
        knowledgeBaseId,
        status
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');

        if (!['active', 'inactive'].includes(status)) {
            throw createError(
                'Status must be either active or inactive.'
            );
        }

        const result = await database.query(
            `
                UPDATE public.knowledge_bases

                SET
                    status = $3,
                    updated_at = NOW()

                WHERE id = $1
                  AND organization_id = $2

                RETURNING
                    id,
                    organization_id,
                    chatbot_id,
                    name,
                    status,
                    updated_at;
            `,
            [
                knowledgeBaseId,
                organizationId,
                status
            ]
        );

        return result.rows[0] ?? null;
    };


    // =====================================================
    // DELETE KNOWLEDGE BASE
    // =====================================================

    const deleteKnowledgeBase = async ({
        organizationId,
        knowledgeBaseId
    }) => {

        validateUUID(organizationId, 'organization ID');
        validateUUID(knowledgeBaseId, 'knowledge base ID');

        const result = await database.query(
            `
                DELETE FROM public.knowledge_bases

                WHERE id = $1
                  AND organization_id = $2

                RETURNING id;
            `,
            [
                knowledgeBaseId,
                organizationId
            ]
        );

        return result.rowCount > 0;
    };


    return {
        getKnowledgeBase,
        listKnowledgeBaseDocuments,
        updateRetrievalConfig,
        updateKnowledgeBaseStatus,
        deleteKnowledgeBase
    };
};


// =====================================================
// PRODUCTION EXPORTS
// =====================================================

const managementService =
    createKnowledgeBaseManagementService();

export const getKnowledgeBase =
    managementService.getKnowledgeBase;

export const listKnowledgeBaseDocuments =
    managementService.listKnowledgeBaseDocuments;

export const updateRetrievalConfig =
    managementService.updateRetrievalConfig;

export const updateKnowledgeBaseStatus =
    managementService.updateKnowledgeBaseStatus;

export const deleteKnowledgeBase =
    managementService.deleteKnowledgeBase;