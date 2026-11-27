"""Protected internal document extraction and embedding endpoint."""
from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.services.knowledge_ingestion import (
    KnowledgeIngestionError,
    MAX_FILE_BYTES,
    ingest_document,
)

router = APIRouter()


class DocumentIngestionRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=14_000_000)

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        if "/" in value or "\\" in value or value in {".", ".."}:
            raise ValueError("file_name must be a plain file name.")
        return value.strip()


@router.post("/knowledge/ingest")
def ingest_knowledge_document(payload: DocumentIngestionRequest):
    try:
        raw = base64.b64decode(payload.content_base64, validate=True)
        if not raw or len(raw) > MAX_FILE_BYTES:
            raise KnowledgeIngestionError("File must be between 1 byte and 10 MiB.")
        result = ingest_document(payload.file_name, raw)
        return {"success": True, **result}
    except (binascii.Error, ValueError, KnowledgeIngestionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        # Do not expose provider credentials or internal exception details.
        raise HTTPException(
            status_code=502,
            detail="Document processing or embedding provider failed.",
        ) from exc
