import { pool } from '../config/database.js';

async function testDatabase() {
    try {
        const result = await pool.query(`
            SELECT
                current_user,
                session_user,
                current_database(),
                r.rolsuper,
                r.rolbypassrls
            FROM pg_roles r
            WHERE r.rolname = current_user;
        `);

        console.log('Database connection details:');
        console.table(result.rows);

    } catch (error) {
        console.error('Database verification failed:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

testDatabase();