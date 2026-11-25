from fastapi import APIRouter, HTTPException

from app.schemas.intent import IntentClassificationRequest, IntentClassificationResponse
from app.services.intent_service import classify_intent

router = APIRouter()


@router.post("/intent/classify", response_model=IntentClassificationResponse)
def intent_classify(request: IntentClassificationRequest):
    try:
        result = classify_intent(request)
        return {"success": True, **result}
    except RuntimeError:
        raise HTTPException(
            status_code=503,
            detail="Intent classification is temporarily unavailable",
        )
