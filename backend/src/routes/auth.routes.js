import express from 'express';

import {
    authenticateUser
} from '../middleware/auth.middleware.js';

import {
    requireOrganization,
    requireRoles
} from '../middleware/organization.middleware.js';

const router = express.Router();


// 1. Authentication and organization context
router.get(
    '/context',
    authenticateUser,
    requireOrganization,
    (req, res) => {
        res.status(200).json({
            success: true,
            message: 'Authentication and organization authorization successful',
            user: {
                id: req.auth.userId
            },
            organization: {
                id: req.organization.id,
                memberId: req.organization.memberId,
                role: req.organization.role
            }
        });
    }
);


// 2. Admin-only authorization test
router.get(
    '/admin-context',
    authenticateUser,
    requireOrganization,
    requireRoles('owner', 'admin'),
    (req, res) => {
        res.status(200).json({
            success: true,
            message: 'Admin authorization successful',
            organization: {
                id: req.organization.id,
                role: req.organization.role
            }
        });
    }
);


export default router;
