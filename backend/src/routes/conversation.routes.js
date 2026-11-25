import express from 'express';

import {
    sendAgentMessageController
} from '../controllers/conversation.controller.js';

import {
    authenticateUser
} from '../middleware/auth.middleware.js';

import {
    requireOrganization,
    requireRoles
} from '../middleware/organization.middleware.js';

const router = express.Router();

router.post(
    '/:chatbotId/:conversationId/messages',
    authenticateUser,
    requireOrganization,
    requireRoles('support_agent'),
    sendAgentMessageController
);

export default router;