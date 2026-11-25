import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import apiRoutes from './routes/index.js';

import {
    notFound,
    errorHandler
} from './middleware/error.middleware.js';

import { env } from './config/env.js';

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: env.frontendUrl || 'http://localhost:5173'
}));

// Request parsing
app.use(express.json({ limit: '1mb' }));

// Logging
if (env.nodeEnv === 'development') {
    app.use(morgan('dev'));
}

// API routes
app.use('/api/v1', apiRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;