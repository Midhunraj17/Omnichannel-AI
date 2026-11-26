import {
    createTicketFromConversation
} from '../services/ticket-intake.service.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// CONTROLLER FACTORY
// =====================================================

export const createTicketIntakeController = ({

    createTicketFn = createTicketFromConversation

} = {}) => {

    return async (req, res, next) => {

        try {

            // ---------------------------------------------
            // 1. AUTHENTICATED ORGANIZATION CONTEXT
            // ---------------------------------------------

            const organizationId =
                req.organization?.id;

            const memberId =
                req.organization?.memberId;


            if (!organizationId || !memberId) {

                return res.status(403).json({

                    success: false,

                    message:
                        'Organization authorization context is missing.'

                });

            }


            // ---------------------------------------------
            // 2. IDEMPOTENCY KEY
            // ---------------------------------------------

            const intakeRequestId =
                req.get('Idempotency-Key');


            if (
                typeof intakeRequestId !== 'string' ||
                !UUID_REGEX.test(intakeRequestId)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        'A valid Idempotency-Key UUID is required.'

                });

            }


            // ---------------------------------------------
            // 3. REQUEST BODY
            // ---------------------------------------------

            const {

                conversation_id,

                title,

                description = '',

                category = 'general',

                priority = 'medium',

                severity,

                priority_score,

                auto_assign = true

            } = req.body ?? {};


            if (!UUID_REGEX.test(conversation_id ?? '')) {

                return res.status(400).json({

                    success: false,

                    message: 'A valid conversation ID is required.'

                });

            }


            if (
                typeof auto_assign !== 'boolean'
            ) {

                return res.status(400).json({

                    success: false,

                    message: 'auto_assign must be a boolean.'

                });

            }


            // ---------------------------------------------
            // 4. CREATE AND ROUTE TICKET
            // ---------------------------------------------

            const result = await createTicketFn({

                organizationId,

                memberId,

                conversationId: conversation_id,

                intakeRequestId,

                title,

                description,

                category,

                priority,

                severity,

                priorityScore: priority_score,

                autoAssign: auto_assign

            });


            // ---------------------------------------------
            // 5. RESPONSE
            // ---------------------------------------------

            return res.status(
                result.created ? 201 : 200
            ).json({

                success: true,

                message: result.created
                    ? 'Support ticket created successfully.'
                    : 'Existing ticket returned successfully.',

                data: {

                    ticket: result.ticket,

                    routing: result.routing,

                    idempotent: result.idempotent

                }

            });


        } catch (error) {

            return next(error);

        }

    };

};


// =====================================================
// PRODUCTION CONTROLLER
// =====================================================

export const ticketIntakeController =
    createTicketIntakeController();