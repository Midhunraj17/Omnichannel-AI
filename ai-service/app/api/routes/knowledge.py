"""Internal Phase 5 document parsing and embedding endpoints."""
from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.knowledge_ingestion import (
    KnowledgeIngestionError,
    ingest_document,
)

router = APIRouter()


class DocumentIngestionRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=15_000_000)


@router.post("/knowledge/ingest")
def ingest_knowledge_document(payload: DocumentIngestionRequest):
    try:
        raw = base64.b64decode(payload.content_base64, validate=True)
        result = ingest_document(payload.file_name, raw)
        return {"success": True, **result}
    except (binascii.Error, ValueError, KnowledgeIngestionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Document processing or embedding provider failed.",
        ) from exc
