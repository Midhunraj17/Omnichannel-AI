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

import {
    requireAssignedConversationAccess
} from '../middleware/resource-authorization.middleware.js';


const router = express.Router();


router.post(
    '/:chatbotId/:conversationId/messages',

    authenticateUser,

    requireOrganization,

    requireRoles('support_agent'),

    requireAssignedConversationAccess,

    sendAgentMessageController
);


export default router;