import express from 'express';

import {
    authenticateUser
} from '../middleware/auth.middleware.js';

import {
    requireOrganization,
    requireRoles
} from '../middleware/organization.middleware.js';

import {
    createKnowledgeBaseController,
    listKnowledgeBasesController,
    getKnowledgeBaseController,
    listKnowledgeBaseDocumentsController,
    ingestKnowledgeDocumentController,
    deleteKnowledgeDocumentController,
    updateRetrievalConfigController,
    updateKnowledgeBaseStatusController,
    deleteKnowledgeBaseController
} from '../controllers/knowledge-base.controller.js';


const router = express.Router();


// =====================================================
// AUTHENTICATION AND TENANT CONTEXT
// =====================================================

router.use(
    authenticateUser,
    requireOrganization
);


// =====================================================
// KNOWLEDGE BASE COLLECTION
// =====================================================

router.get(
    '/',
    listKnowledgeBasesController
);

router.post(
    '/',
    requireRoles('owner', 'admin'),
    createKnowledgeBaseController
);


// =====================================================
// DOCUMENT MANAGEMENT
// =====================================================

router.get(
    '/:knowledgeBaseId/documents',
    listKnowledgeBaseDocumentsController
);

router.post(
    '/:knowledgeBaseId/documents',
    requireRoles('owner', 'admin'),
    ingestKnowledgeDocumentController
);

router.delete(
    '/documents/:documentId',
    requireRoles('owner', 'admin'),
    deleteKnowledgeDocumentController
);


// =====================================================
// KNOWLEDGE BASE CONFIGURATION
// =====================================================

router.get(
    '/:knowledgeBaseId',
    getKnowledgeBaseController
);

router.patch(
    '/:knowledgeBaseId/retrieval-config',
    requireRoles('owner', 'admin'),
    updateRetrievalConfigController
);

router.patch(
    '/:knowledgeBaseId/status',
    requireRoles('owner', 'admin'),
    updateKnowledgeBaseStatusController
);


// =====================================================
// DELETE KNOWLEDGE BASE
// =====================================================

router.delete(
    '/:knowledgeBaseId',
    requireRoles('owner', 'admin'),
    deleteKnowledgeBaseController
);


export default router;