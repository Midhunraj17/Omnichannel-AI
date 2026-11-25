import express from 'express';

import {
    ticketRoutingController
} from '../controllers/ticket-routing.controller.js';

import {
    ticketIntakeController
} from '../controllers/ticket-intake.controller.js';

import {
    authenticateUser
} from '../middleware/auth.middleware.js';

import {
    requireOrganization,
    requireRoles
} from '../middleware/organization.middleware.js';


// =====================================================
// ROUTER FACTORY
// =====================================================

export const createTicketRouter = ({

    authenticateUserMiddleware = authenticateUser,

    requireOrganizationMiddleware = requireOrganization,

    ticketRoutingControllerFn = ticketRoutingController,

    ticketIntakeControllerFn = ticketIntakeController

} = {}) => {

    const router = express.Router();


    // -------------------------------------------------
    // CREATE TICKET FROM CONVERSATION
    // -------------------------------------------------

    router.post(

        '/from-conversation',

        authenticateUserMiddleware,

        requireOrganizationMiddleware,

        requireRoles(
            'owner',
            'admin',
            'support_agent'
        ),

        ticketIntakeControllerFn

    );


    // -------------------------------------------------
    // AUTOMATIC TICKET ASSIGNMENT
    // -------------------------------------------------

    router.post(

        '/:ticketId/auto-assign',

        authenticateUserMiddleware,

        requireOrganizationMiddleware,

        requireRoles(
            'owner',
            'admin'
        ),

        ticketRoutingControllerFn

    );


    return router;

};


// =====================================================
// PRODUCTION ROUTER
// =====================================================

export default createTicketRouter();