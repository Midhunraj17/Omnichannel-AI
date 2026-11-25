from fastapi import APIRouter, HTTPException

from app.schemas.entities import EntityExtractionRequest, EntityExtractionResponse
from app.services.entity_service import extract_entities

router = APIRouter()


@router.post("/entities/extract", response_model=EntityExtractionResponse)
def entities_extract(request: EntityExtractionRequest):
    try:
        return {"success": True, **extract_entities(request)}
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Entity extraction is temporarily unavailable")
