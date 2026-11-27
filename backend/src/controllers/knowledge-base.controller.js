import {
    createKnowledgeBase,
    listKnowledgeBases,
    ingestKnowledgeDocument,
    deleteKnowledgeDocument
} from '../services/knowledge-base.service.js';

export const createKnowledgeBaseController = async (req, res, next) => {
    try {
        const knowledgeBase = await createKnowledgeBase({
            organizationId: req.organization.id,
            memberId: req.organization.memberId,
            chatbotId: req.body?.chatbot_id || null,
            name: req.body?.name,
            description: req.body?.description
        });
        return res.status(201).json({
            success: true,
            knowledge_base: knowledgeBase
        });
    } catch (error) {
        return next(error);
    }
};

export const listKnowledgeBasesController = async (req, res, next) => {
    try {
        const knowledgeBases = await listKnowledgeBases(req.organization.id);
        return res.status(200).json({
            success: true,
            knowledge_bases: knowledgeBases
        });
    } catch (error) {
        return next(error);
    }
};

export const ingestKnowledgeDocumentController = async (req, res, next) => {
    try {
        const document = await ingestKnowledgeDocument({
            organizationId: req.organization.id,
            memberId: req.organization.memberId,
            knowledgeBaseId: req.params.knowledgeBaseId,
            fileName: req.body?.file_name,
            contentBase64: req.body?.content_base64
        });
        return res.status(201).json({ success: true, document });
    } catch (error) {
        return next(error);
    }
};

export const deleteKnowledgeDocumentController = async (req, res, next) => {
    try {
        const deleted = await deleteKnowledgeDocument({
            organizationId: req.organization.id,
            documentId: req.params.documentId
        });
        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: 'Document not found.'
            });
        }
        return res.status(200).json({ success: true });
    } catch (error) {
        return next(error);
    }
};
