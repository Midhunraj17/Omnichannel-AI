import express from 'express';

import {
    ticketRoutingController
} from '../controllers/ticket-routing.controller.js';

import {
    ticketIntakeController
} from '../controllers/ticket-intake.controller.js';

import {
    ticketEscalationController
} from '../controllers/ticket-escalation.controller.js';

import {
    ticketPipelineController
} from '../controllers/ticket-pipeline.controller.js';

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

    ticketIntakeControllerFn = ticketIntakeController,

    ticketEscalationControllerFn =
        ticketEscalationController,

    ticketPipelineControllerFn =
        ticketPipelineController

} = {}) => {

    const router = express.Router();


    // -------------------------------------------------
    // END-TO-END CUSTOMER SUPPORT PIPELINE
    // -------------------------------------------------

    router.post(

        '/pipeline/from-conversation',

        authenticateUserMiddleware,

        requireOrganizationMiddleware,

        requireRoles(
            'owner',
            'admin',
            'support_agent'
        ),

        ticketPipelineControllerFn

    );


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


    // -------------------------------------------------
    // EVALUATE AND APPLY TICKET ESCALATION
    // -------------------------------------------------

    router.post(

        '/:ticketId/escalation/evaluate',

        authenticateUserMiddleware,

        requireOrganizationMiddleware,

        requireRoles(
            'owner',
            'admin'
        ),

        ticketEscalationControllerFn

    );


    return router;

};


// =====================================================
// PRODUCTION ROUTER
// =====================================================

export default createTicketRouter();