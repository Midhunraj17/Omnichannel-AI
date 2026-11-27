import express from 'express';
import { authenticateUser } from '../middleware/auth.middleware.js';
import {
    requireOrganization,
    requireRoles
} from '../middleware/organization.middleware.js';
import {
    createKnowledgeBaseController,
    listKnowledgeBasesController,
    ingestKnowledgeDocumentController,
    deleteKnowledgeDocumentController
} from '../controllers/knowledge-base.controller.js';

const router = express.Router();

router.use(authenticateUser, requireOrganization);

router.get('/', listKnowledgeBasesController);
router.post('/', requireRoles('owner', 'admin'), createKnowledgeBaseController);
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

export default router;
