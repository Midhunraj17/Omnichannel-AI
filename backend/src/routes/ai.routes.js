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


// =====================================================
// AI ROUTER FACTORY
// =====================================================

export const createAiRouter = ({

    authenticateUserMiddleware = authenticateUser,

    requireOrganizationMiddleware = requireOrganization,

    requireChatbotTenantAccessMiddleware =
        requireChatbotTenantAccess,

    chatControllerFn = chatController

} = {}) => {

    const router = express.Router();


    router.post(
        '/chat',

        authenticateUserMiddleware,

        requireOrganizationMiddleware,

        requireChatbotTenantAccessMiddleware,

        chatControllerFn
    );


    return router;

};


// =====================================================
// PRODUCTION ROUTER
// =====================================================

export default createAiRouter();