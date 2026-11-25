import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, () => {
    console.log(`
    ===================================
       OMNICHANNEL AI BACKEND
    ===================================
       Status : Running
       Port   : ${env.port}
       Mode   : ${env.nodeEnv}
    ===================================
    `);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');

    server.close(() => {
        console.log('Server closed successfully');
        process.exit(0);
    });
});