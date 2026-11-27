import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.middleware.js';
import { env } from './config/env.js';

const app = express();

app.use(helmet());
app.use(cors({
    origin: env.frontendUrl || 'http://localhost:5173'
}));

// Base64 expands binary uploads by roughly 4/3. This permits a 10 MiB
// file while retaining a bounded JSON request size.
app.use(express.json({
    limit: process.env.KNOWLEDGE_JSON_LIMIT || '15mb'
}));

if (env.nodeEnv === 'development') {
    app.use(morgan('dev'));
}

app.use('/api/v1', apiRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
