import express from 'express';

import aiRoutes from './ai.routes.js';

import authRoutes from './auth.routes.js';

import conversationRoutes from './conversation.routes.js';

import ticketRoutes from './ticket.routes.js';


const router = express.Router();


// =====================================================
// HEALTH CHECK
// =====================================================

router.get('/health', (req, res) => {

    res.status(200).json({

        success: true,

        message: 'Omnichannel Backend is operational',

        service: 'Backend API'

    });

});


// =====================================================
// ROUTE REGISTRATION
// =====================================================

router.use('/auth', authRoutes);

router.use('/ai', aiRoutes);

router.use('/conversations', conversationRoutes);

router.use('/tickets', ticketRoutes);


export default router;