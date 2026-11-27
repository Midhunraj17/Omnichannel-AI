import {
    createKnowledgeBase,
    listKnowledgeBases,
    ingestKnowledgeDocument,
    deleteKnowledgeDocument
} from '../services/knowledge-base.service.js';

import {
    getKnowledgeBase,
    listKnowledgeBaseDocuments,
    updateRetrievalConfig,
    updateKnowledgeBaseStatus,
    deleteKnowledgeBase
} from '../services/knowledge-base-management.service.js';


// =====================================================
// CREATE KNOWLEDGE BASE
// =====================================================

export const createKnowledgeBaseController = async (
    req,
    res,
    next
) => {

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


// =====================================================
// LIST KNOWLEDGE BASES
// =====================================================

export const listKnowledgeBasesController = async (
    req,
    res,
    next
) => {

    try {

        const knowledgeBases = await listKnowledgeBases(
            req.organization.id
        );

        return res.status(200).json({

            success: true,

            knowledge_bases: knowledgeBases

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// GET KNOWLEDGE BASE DETAILS
// =====================================================

export const getKnowledgeBaseController = async (
    req,
    res,
    next
) => {

    try {

        const knowledgeBase = await getKnowledgeBase({

            organizationId: req.organization.id,

            knowledgeBaseId: req.params.knowledgeBaseId

        });

        if (!knowledgeBase) {

            return res.status(404).json({

                success: false,

                message: 'Knowledge Base not found.'

            });

        }

        return res.status(200).json({

            success: true,

            knowledge_base: knowledgeBase

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// LIST KNOWLEDGE BASE DOCUMENTS
// =====================================================

export const listKnowledgeBaseDocumentsController = async (
    req,
    res,
    next
) => {

    try {

        const documents = await listKnowledgeBaseDocuments({

            organizationId: req.organization.id,

            knowledgeBaseId: req.params.knowledgeBaseId

        });

        if (documents === null) {

            return res.status(404).json({

                success: false,

                message: 'Knowledge Base not found.'

            });

        }

        return res.status(200).json({

            success: true,

            knowledge_base_id: req.params.knowledgeBaseId,

            documents

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// UPLOAD KNOWLEDGE DOCUMENT
// =====================================================

export const ingestKnowledgeDocumentController = async (
    req,
    res,
    next
) => {

    try {

        const document = await ingestKnowledgeDocument({

            organizationId: req.organization.id,

            memberId: req.organization.memberId,

            knowledgeBaseId: req.params.knowledgeBaseId,

            fileName: req.body?.file_name,

            contentBase64: req.body?.content_base64

        });

        return res.status(201).json({

            success: true,

            document

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// DELETE DOCUMENT
// =====================================================

export const deleteKnowledgeDocumentController = async (
    req,
    res,
    next
) => {

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

        return res.status(200).json({

            success: true,

            message: 'Document deleted successfully.'

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// UPDATE RETRIEVAL CONFIGURATION
// =====================================================

export const updateRetrievalConfigController = async (
    req,
    res,
    next
) => {

    try {

        const knowledgeBase = await updateRetrievalConfig({

            organizationId: req.organization.id,

            knowledgeBaseId: req.params.knowledgeBaseId,

            config: req.body

        });

        if (!knowledgeBase) {

            return res.status(404).json({

                success: false,

                message: 'Knowledge Base not found.'

            });

        }

        return res.status(200).json({

            success: true,

            message: 'Retrieval configuration updated successfully.',

            knowledge_base: knowledgeBase

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// UPDATE KNOWLEDGE BASE STATUS
// =====================================================

export const updateKnowledgeBaseStatusController = async (
    req,
    res,
    next
) => {

    try {

        const knowledgeBase = await updateKnowledgeBaseStatus({

            organizationId: req.organization.id,

            knowledgeBaseId: req.params.knowledgeBaseId,

            status: req.body?.status

        });

        if (!knowledgeBase) {

            return res.status(404).json({

                success: false,

                message: 'Knowledge Base not found.'

            });

        }

        return res.status(200).json({

            success: true,

            message: 'Knowledge Base status updated successfully.',

            knowledge_base: knowledgeBase

        });

    } catch (error) {

        return next(error);

    }

};


// =====================================================
// DELETE KNOWLEDGE BASE
// =====================================================

export const deleteKnowledgeBaseController = async (
    req,
    res,
    next
) => {

    try {

        const deleted = await deleteKnowledgeBase({

            organizationId: req.organization.id,

            knowledgeBaseId: req.params.knowledgeBaseId

        });

        if (!deleted) {

            return res.status(404).json({

                success: false,

                message: 'Knowledge Base not found.'

            });

        }

        return res.status(200).json({

            success: true,

            message: 'Knowledge Base and its associated documents deleted successfully.'

        });

    } catch (error) {

        return next(error);

    }

};