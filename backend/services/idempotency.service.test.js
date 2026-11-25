import {
    describe,
    it,
    afterEach,
    mock
} from 'node:test';

import assert from 'node:assert/strict';

import { pool } from '../src/config/database.js';
import {
    releaseRequest
} from '../src/services/idempotency.service.js';

afterEach(() => {
    mock.restoreAll();
});


describe('Idempotency Reservation Release', () => {


    it('releases a reservation owned by the current request', async () => {

        const reservationId = 'reservation-123';

        const reservationToken = 'token-123';


        mock.method(
            pool,
            'query',
            async (sql, params) => {

                assert.match(
                    sql,
                    /lease_expires_at = NOW\(\)/
                );

                assert.match(
                    sql,
                    /reservation_token = \$2/
                );

                assert.deepEqual(
                    params,
                    [
                        reservationId,
                        reservationToken
                    ]
                );


                return {
                    rows: [{
                        id: reservationId
                    }],
                    rowCount: 1
                };

            }
        );


        const result = await releaseRequest({

            reservationId,

            reservationToken

        });


        assert.deepEqual(result, {
            released: true
        });

    });


    it('does not release a reservation owned by another request', async () => {

        mock.method(
            pool,
            'query',
            async () => ({
                rows: [],
                rowCount: 0
            })
        );


        const result = await releaseRequest({

            reservationId: 'reservation-123',

            reservationToken: 'wrong-token'

        });


        assert.deepEqual(result, {
            released: false
        });

    });

});