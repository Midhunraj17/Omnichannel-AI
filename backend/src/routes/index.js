import express from 'express';

import aiRoutes from './ai.routes.js';

import authRoutes from './auth.routes.js';

import conversationRoutes from './conversation.routes.js';

import ticketRoutes from './ticket.routes.js';

import knowledgeBaseRoutes from './knowledge-base.routes.js';

import knowledgeRetrievalRoutes from './knowledge-retrieval.routes.js';


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

router.use('/tickets', ticketRoutes);


// Existing knowledge-base management routes.
router.use('/knowledge-bases', knowledgeBaseRoutes);


// New semantic retrieval route.
router.use('/knowledge-retrieval', knowledgeRetrievalRoutes);


export default router;