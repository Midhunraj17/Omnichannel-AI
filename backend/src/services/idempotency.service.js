import { randomUUID } from 'node:crypto';

import { pool } from '../config/database.js';


const LEASE_DURATION_SECONDS = 120;


// =====================================================
// RESERVE REQUEST
// =====================================================

export const reserveRequest = async ({
    organizationId,
    chatbotId,
    idempotencyKey,
    requestHash
}) => {

    const client = await pool.connect();

    const reservationToken = randomUUID();

    try {

        await client.query('BEGIN');

        const insertResult = await client.query(
            `
                INSERT INTO public.api_idempotency_keys (
                    organization_id,
                    chatbot_id,
                    idempotency_key,
                    request_hash,
                    status,
                    reservation_token,
                    lease_expires_at
                )
                VALUES (
                    $1, $2, $3, $4,
                    'processing',
                    $5,
                    NOW() + ($6 * INTERVAL '1 second')
                )
                ON CONFLICT (
                    organization_id,
                    chatbot_id,
                    idempotency_key
                )
                DO NOTHING
                RETURNING id;
            `,
            [
                organizationId,
                chatbotId,
                idempotencyKey,
                requestHash,
                reservationToken,
                LEASE_DURATION_SECONDS
            ]
        );


        if (insertResult.rowCount === 1) {

            await client.query('COMMIT');

            return {
                state: 'reserved',
                id: insertResult.rows[0].id,
                reservationToken
            };

        }


        const existingResult = await client.query(
            `
                SELECT *
                FROM public.api_idempotency_keys
                WHERE organization_id = $1
                  AND chatbot_id = $2
                  AND idempotency_key = $3
                FOR UPDATE;
            `,
            [
                organizationId,
                chatbotId,
                idempotencyKey
            ]
        );


        if (existingResult.rowCount === 0) {

            throw new Error(
                'Unable to retrieve idempotency reservation.'
            );

        }


        const existing = existingResult.rows[0];


        if (existing.request_hash !== requestHash) {

            await client.query('COMMIT');

            return {
                state: 'conflict'
            };

        }


        if (new Date(existing.expires_at) <= new Date()) {

            const refreshedResult = await client.query(
                `
                    UPDATE public.api_idempotency_keys
                    SET
                        status = 'processing',
                        request_hash = $2,
                        response_body = NULL,
                        response_status = NULL,
                        reservation_token = $3,
                        lease_expires_at =
                            NOW() + ($4 * INTERVAL '1 second'),
                        expires_at = NOW() + INTERVAL '24 hours',
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING id;
                `,
                [
                    existing.id,
                    requestHash,
                    reservationToken,
                    LEASE_DURATION_SECONDS
                ]
            );

            await client.query('COMMIT');

            return {
                state: 'reserved',
                id: refreshedResult.rows[0].id,
                reservationToken
            };

        }


        if (existing.status === 'completed') {

            await client.query('COMMIT');

            return {
                state: 'completed',
                responseBody: existing.response_body,
                responseStatus: existing.response_status
            };

        }


        if (
            existing.status === 'processing' &&
            existing.lease_expires_at &&
            new Date(existing.lease_expires_at) <= new Date()
        ) {

            const reclaimedResult = await client.query(
                `
                    UPDATE public.api_idempotency_keys
                    SET
                        reservation_token = $2,
                        lease_expires_at =
                            NOW() + ($3 * INTERVAL '1 second'),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING id;
                `,
                [
                    existing.id,
                    reservationToken,
                    LEASE_DURATION_SECONDS
                ]
            );

            await client.query('COMMIT');

            return {
                state: 'reserved',
                id: reclaimedResult.rows[0].id,
                reservationToken
            };

        }


        await client.query('COMMIT');

        return {
            state: 'processing'
        };


    } catch (error) {

        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error(
                'Idempotency rollback failed:',
                rollbackError.message
            );
        }

        throw error;

    } finally {

        client.release();

    }

};


// =====================================================
// COMPLETE REQUEST
// =====================================================

export const completeRequest = async ({
    reservationId,
    reservationToken,
    responseBody,
    responseStatus = 200
}) => {

    const result = await pool.query(
        `
            UPDATE public.api_idempotency_keys
            SET
                status = 'completed',
                response_body = $3::jsonb,
                response_status = $4,
                reservation_token = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $1
              AND reservation_token = $2
              AND status = 'processing'
            RETURNING id;
        `,
        [
            reservationId,
            reservationToken,
            JSON.stringify(responseBody),
            responseStatus
        ]
    );


    if (result.rowCount !== 1) {

        throw new Error(
            'Reservation ownership lost or request already completed.'
        );

    }


    return {
        success: true,
        reservationId: result.rows[0].id
    };

};


// =====================================================
// RELEASE FAILED REQUEST
// =====================================================

export const releaseRequest = async ({
    reservationId,
    reservationToken
}) => {

    const result = await pool.query(
        `
            UPDATE public.api_idempotency_keys
            SET
                lease_expires_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
              AND reservation_token = $2
              AND status = 'processing'
            RETURNING id;
        `,
        [
            reservationId,
            reservationToken
        ]
    );


    return {
        released: result.rowCount === 1
    };

};


// =====================================================
// GET CACHED RESPONSE
// =====================================================

export const getCachedResponse = async ({
    organizationId,
    chatbotId,
    idempotencyKey
}) => {

    const result = await pool.query(
        `
            SELECT
                response_body,
                response_status
            FROM public.api_idempotency_keys
            WHERE organization_id = $1
              AND chatbot_id = $2
              AND idempotency_key = $3
              AND status = 'completed'
              AND expires_at > NOW()
            LIMIT 1;
        `,
        [
            organizationId,
            chatbotId,
            idempotencyKey
        ]
    );


    if (result.rowCount === 0) {
        return null;
    }


    return {
        responseBody: result.rows[0].response_body,
        responseStatus: result.rows[0].response_status
    };

};


// =====================================================
// RENEW RESERVATION
// =====================================================

export const renewReservation = async ({
    reservationId,
    reservationToken
}) => {

    const result = await pool.query(
        `
            UPDATE public.api_idempotency_keys
            SET
                lease_expires_at =
                    NOW() + ($3 * INTERVAL '1 second'),
                updated_at = NOW()
            WHERE id = $1
              AND reservation_token = $2
              AND status = 'processing'
            RETURNING id;
        `,
        [
            reservationId,
            reservationToken,
            LEASE_DURATION_SECONDS
        ]
    );


    if (result.rowCount !== 1) {

        throw new Error(
            'Unable to renew reservation: ownership lost.'
        );

    }


    return {
        success: true,
        reservationId: result.rows[0].id
    };

};