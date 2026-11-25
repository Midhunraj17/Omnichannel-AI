import { pool } from '../config/database.js';

export const resolveOrganizationMembership = async (
    userId,
    organizationId
) => {

    const query = `
        SELECT
            id,
            organization_id,
            user_id,
            role,
            status
        FROM public.organization_members
        WHERE organization_id = $1
          AND user_id = $2
          AND status = 'active'
        LIMIT 1;
    `;

    const result = await pool.query(query, [
        organizationId,
        userId
    ]);

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};