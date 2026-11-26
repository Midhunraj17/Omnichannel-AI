import {
    runTicketPipeline
} from '../services/ticket-pipeline.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const createTicketPipelineController = ({

    runPipelineFn = runTicketPipeline

} = {}) => {

    return async (req, res, next) => {

        try {

            // -----------------------------------------
            // 1. ORGANIZATION CONTEXT
            // -----------------------------------------

            const organizationId =
                req.organization?.id;

            const memberId =
                req.organization?.memberId;


            if (!organizationId || !memberId) {

                return res.status(403).json({

                    success: false,

                    message:
                        'Organization authorization context is required.'

                });

            }


            // -----------------------------------------
            // 2. IDEMPOTENCY KEY
            // -----------------------------------------

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


            // -----------------------------------------
            // 3. REQUEST BODY
            // -----------------------------------------

            const {

                conversation_id,

                message,

                title,

                domain = 'general',

                auto_assign = true

            } = req.body ?? {};


            if (!UUID_REGEX.test(conversation_id ?? '')) {

                return res.status(400).json({

                    success: false,

                    message: 'Invalid conversation ID.'

                });

            }


            if (

                typeof message !== 'string' ||

                !message.trim() ||

                message.trim().length > 10000

            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        'Message must contain 1–10000 characters.'

                });

            }


            if (

                title !== undefined &&

                (

                    typeof title !== 'string' ||

                    title.trim().length > 200

                )

            ) {

                return res.status(400).json({

                    success: false,

                    message: 'Invalid ticket title.'

                });

            }


            if (typeof auto_assign !== 'boolean') {

                return res.status(400).json({

                    success: false,

                    message:
                        'auto_assign must be a boolean.'

                });

            }


            // -----------------------------------------
            // 4. RUN COMPLETE PIPELINE
            // -----------------------------------------

            const result = await runPipelineFn({

                organizationId,

                memberId,

                conversationId: conversation_id,

                intakeRequestId,

                message,

                title,

                domain,

                autoAssign: auto_assign

            });


            // -----------------------------------------
            // 5. RESPONSE STATUS
            // -----------------------------------------

            const statusCode =

                result.ticketCreated && !result.stages?.ticketCreation?.idempotent

                    ? 201

                    : 200;


            return res.status(statusCode).json({

                success: true,

                message:
                    'Customer support pipeline processed successfully.',

                data: result

            });


        } catch (error) {

            return next(error);

        }

    };

};


// =====================================================
// PRODUCTION CONTROLLER
// =====================================================

export const ticketPipelineController =
    createTicketPipelineController();