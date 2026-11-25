import { getSupabaseAuthClient } from '../config/supabase.js';

export const createAuthenticateUser = (authClient) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication token is required'
                });
            }

            const token = authHeader.substring(7).trim();

            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid authentication token'
                });
            }

            const client = authClient || getSupabaseAuthClient();

            const { data, error } = await client.auth.getUser(token);

            if (error || !data?.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired authentication token'
                });
            }

            req.auth = {
                userId: data.user.id,
                user: data.user
            };

            return next();

        } catch (error) {
            console.error('Authentication service error:', error.message);

            return res.status(503).json({
                success: false,
                message: 'Authentication service temporarily unavailable'
            });
        }
    };
};

export const authenticateUser =
    createAuthenticateUser();