from fastapi import APIRouter, HTTPException

from app.schemas.orchestration import OrchestrationRequest, OrchestrationResponse
from app.services.llm_service import LLMServiceError
from app.services.orchestrator import orchestrate

router = APIRouter()


@router.post("/orchestrator/run", response_model=OrchestrationResponse)
def run_orchestrator(request: OrchestrationRequest):
    try:
        return orchestrate(request)
    except (RuntimeError, LLMServiceError):
        raise HTTPException(
            status_code=503,
            detail="AI orchestration is temporarily unavailable",
        )
