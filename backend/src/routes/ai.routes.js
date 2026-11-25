import express from 'express';

import { chatController } from '../controllers/ai.controller.js';

import { authenticateUser } from '../middleware/auth.middleware.js';

import {
    requireOrganization
} from '../middleware/organization.middleware.js';

const router = express.Router();

router.post(
    '/chat',
    authenticateUser,
    requireOrganization,
    chatController
);

export default router;