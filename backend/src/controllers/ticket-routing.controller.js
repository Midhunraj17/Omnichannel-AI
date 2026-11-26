import {
    autoAssignTicket
} from '../services/ticket-routing.service.js';


// =====================================================
// UUID VALIDATION
// =====================================================

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// =====================================================
// CONTROLLER FACTORY
// =====================================================

export const createTicketRoutingController = ({

    autoAssignTicketFn = autoAssignTicket

} = {}) => {

    return async (req, res, next) => {

        try {

            // -------------------------------------------------
            // 1. VALIDATE TICKET ID
            // -------------------------------------------------

            const { ticketId } = req.params;

            if (!UUID_REGEX.test(ticketId ?? '')) {

                return res.status(400).json({

                    success: false,

                    message: 'Invalid ticket ID.'

                });

            }


            // -------------------------------------------------
            // 2. VALIDATE ORGANIZATION CONTEXT
            // -------------------------------------------------

            if (
                !req.organization ||
                !req.organization.id ||
                !req.organization.memberId
            ) {

                return res.status(403).json({

                    success: false,

                    message: 'Organization context is required.'

                });

            }


            // -------------------------------------------------
            // 3. EXECUTE AUTOMATIC ROUTING
            // -------------------------------------------------

            const result = await autoAssignTicketFn({

                ticketId,

                organizationId: req.organization.id,

                assignedByMemberId: req.organization.memberId

            });


            // -------------------------------------------------
            // 4. RETURN ROUTING RESULT
            // -------------------------------------------------

            return res.status(200).json({

                success: true,

                ...result

            });


        } catch (error) {

            return next(error);

        }

    };

};


// =====================================================
// PRODUCTION CONTROLLER
// =====================================================

export const ticketRoutingController =
    createTicketRoutingController();