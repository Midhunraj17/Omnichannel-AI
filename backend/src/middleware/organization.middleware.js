import {
    resolveOrganizationMembership
} from '../services/organization.service.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const createRequireOrganization = (membershipResolver) => {
    return async (req, res, next) => {
        try {
            const organizationId =
                req.headers['x-organization-id'];

            if (!organizationId || !UUID_REGEX.test(organizationId)) {
                return res.status(400).json({
                    success: false,
                    message: 'A valid organization ID is required'
                });
            }

            const membership = await membershipResolver(
                req.auth.userId,
                organizationId
            );

            if (!membership) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not an active member of this organization'
                });
            }

            req.organization = {
                id: membership.organization_id,
                memberId: membership.id,
                role: membership.role
            };

            return next();

        } catch (error) {
            return next(error);
        }
    };
};


export const requireOrganization =
    createRequireOrganization(resolveOrganizationMembership);


export const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {

        if (!req.organization) {
            return res.status(500).json({
                success: false,
                message: 'Organization context is missing'
            });
        }

        if (!allowedRoles.includes(req.organization.role)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to perform this action'
            });
        }

        return next();
    };
};