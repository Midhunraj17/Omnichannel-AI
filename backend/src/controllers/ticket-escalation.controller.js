import {
    evaluateAndApplyTicketEscalation
} from '../services/ticket-escalation.service.js';


const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const createTicketEscalationController = ({

    evaluateEscalationFn =
        evaluateAndApplyTicketEscalation

} = {}) => {

    return async (req, res, next) => {

        try {

            // -----------------------------------------
            // 1. VALIDATE TICKET ID
            // -----------------------------------------

            const { ticketId } = req.params;


            if (!UUID_REGEX.test(ticketId ?? '')) {

                return res.status(400).json({

                    success: false,

                    message: 'Invalid ticket ID.'

                });

            }


            // -----------------------------------------
            // 2. ORGANIZATION CONTEXT
            // -----------------------------------------

            const organizationId =
                req.organization?.id;


            if (!organizationId) {

                return res.status(403).json({

                    success: false,

                    message:
                        'Organization authorization context is required.'

                });

            }


            // -----------------------------------------
            // 3. EVALUATE ESCALATION
            // -----------------------------------------

            const result =
                await evaluateEscalationFn({

                    ticketId,

                    organizationId

                });


            // -----------------------------------------
            // 4. RETURN RESULT
            // -----------------------------------------

            return res.status(200).json({

                success: true,

                message:
                    'Ticket escalation evaluation completed.',

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

export const ticketEscalationController =
    createTicketEscalationController();