import express from 'express';


import {
    authenticateUser
} from '../middleware/auth.middleware.js';


import {
    requireOrganization
} from '../middleware/organization.middleware.js';


import {
    searchKnowledgeBaseController
} from '../controllers/knowledge-retrieval.controller.js';


const router = express.Router();


router.use(
    authenticateUser,
    requireOrganization
);


router.post(
    '/:knowledgeBaseId/search',
    searchKnowledgeBaseController
);


export default router;