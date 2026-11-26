from fastapi import APIRouter, HTTPException

from app.schemas.escalation import (
    EscalationEvaluationRequest,
    EscalationEvaluationResult,
)

from app.services.escalation_engine import (
    evaluate_escalation,
)


router = APIRouter()


@router.post(
    "/tickets/escalation/evaluate",
    response_model=EscalationEvaluationResult,
)
def evaluate_ticket_escalation(
    request: EscalationEvaluationRequest,
):

    try:

        return evaluate_escalation(
            request
        )

    except (ValueError, TypeError) as error:

        raise HTTPException(
            status_code=422,
            detail=str(error),
        )

    except Exception:

        raise HTTPException(
            status_code=500,
            detail="Ticket escalation evaluation failed.",
        )