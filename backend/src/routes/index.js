import express from 'express';

import aiRoutes from './ai.routes.js';

import authRoutes from './auth.routes.js';

import conversationRoutes from './conversation.routes.js';

const router = express.Router();


router.get('/health', (req, res) => {

    res.status(200).json({

        success: true,

        message: 'Omnichannel Backend is operational',

        service: 'Backend API'

    });

});

router.use('/auth', authRoutes);
router.use('/ai', aiRoutes);
router.use('/conversations', conversationRoutes);

export default router;