import express from 'express';

import {
    chatController
} from '../controllers/ai.controller.js';

import {
    authenticateUser
} from '../middleware/auth.middleware.js';

import {
    requireOrganization
} from '../middleware/organization.middleware.js';

import {
    requireChatbotTenantAccess
} from '../middleware/resource-authorization.middleware.js';


const router = express.Router();


router.post(
    '/chat',

    authenticateUser,

    requireOrganization,

    requireChatbotTenantAccess,

    chatController
);


export default router;