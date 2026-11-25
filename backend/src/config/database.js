import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
    connectionString: env.databaseUrl,

    max: 5,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
    console.error('Unexpected database error:', error);
});