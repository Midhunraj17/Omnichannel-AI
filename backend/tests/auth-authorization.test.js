import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createAuthenticateUser
} from '../src/middleware/auth.middleware.js';

import {
    createRequireOrganization,
    requireRoles
} from '../src/middleware/organization.middleware.js';


const USER_ID = '11111111-1111-4111-8111-111111111111';

const ORG_ID = '22222222-2222-4222-8222-222222222222';

const MEMBER_ID = '33333333-3333-4333-8333-333333333333';


function createResponse() {
    return {
        statusCode: 200,
        body: null,

        status(code) {
            this.statusCode = code;
            return this;
        },

        json(data) {
            this.body = data;
            return this;
        }
    };
}


test('Missing token returns 401', async () => {

    const middleware = createAuthenticateUser({
        auth: {
            getUser: async () => {
                throw new Error('Should not be called');
            }
        }
    });

    const req = { headers: {} };
    const res = createResponse();

    await middleware(req, res, () => {
        throw new Error('next should not be called');
    });

    assert.equal(res.statusCode, 401);
});


test('Invalid token returns 401', async () => {

    const middleware = createAuthenticateUser({
        auth: {
            getUser: async () => ({
                data: { user: null },
                error: new Error('Invalid token')
            })
        }
    });

    const req = {
        headers: {
            authorization: 'Bearer invalid-token'
        }
    };

    const res = createResponse();

    await middleware(req, res, () => {
        throw new Error('next should not be called');
    });

    assert.equal(res.statusCode, 401);
});


test('Valid token attaches verified user identity', async () => {

    const middleware = createAuthenticateUser({
        auth: {
            getUser: async () => ({
                data: {
                    user: {
                        id: USER_ID,
                        email: 'agent@example.com'
                    }
                },
                error: null
            })
        }
    });

    const req = {
        headers: {
            authorization: 'Bearer valid-token'
        }
    };

    const res = createResponse();

    let nextCalled = false;

    await middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.auth.userId, USER_ID);
});


test('Active organization membership is accepted', async () => {

    const middleware = createRequireOrganization(
        async (userId, organizationId) => {

            assert.equal(userId, USER_ID);
            assert.equal(organizationId, ORG_ID);

            return {
                id: MEMBER_ID,
                organization_id: ORG_ID,
                user_id: USER_ID,
                role: 'support_agent',
                status: 'active'
            };
        }
    );

    const req = {
        auth: { userId: USER_ID },
        headers: {
            'x-organization-id': ORG_ID
        }
    };

    const res = createResponse();

    let nextCalled = false;

    await middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.organization.id, ORG_ID);
    assert.equal(req.organization.role, 'support_agent');
});


test('Missing organization membership is rejected', async () => {

    const middleware = createRequireOrganization(
        async () => null
    );

    const req = {
        auth: { userId: USER_ID },
        headers: {
            'x-organization-id': ORG_ID
        }
    };

    const res = createResponse();

    await middleware(req, res, () => {
        throw new Error('next should not be called');
    });

    assert.equal(res.statusCode, 403);
});


test('Invalid organization UUID is rejected', async () => {

    const middleware = createRequireOrganization(
        async () => {
            throw new Error('Database should not be called');
        }
    );

    const req = {
        auth: { userId: USER_ID },
        headers: {
            'x-organization-id': 'invalid-org-id'
        }
    };

    const res = createResponse();

    await middleware(req, res, () => {
        throw new Error('next should not be called');
    });

    assert.equal(res.statusCode, 400);
});


test('Authorized organization role is accepted', () => {

    const middleware = requireRoles('owner', 'admin');

    const req = {
        organization: {
            role: 'admin'
        }
    };

    const res = createResponse();

    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});


test('Unauthorized organization role is rejected', () => {

    const middleware = requireRoles('owner', 'admin');

    const req = {
        organization: {
            role: 'support_agent'
        }
    };

    const res = createResponse();

    middleware(req, res, () => {
        throw new Error('next should not be called');
    });

    assert.equal(res.statusCode, 403);
});