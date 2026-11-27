import base64
import binascii

from fastapi import (
    APIRouter,
    HTTPException
)

from pydantic import (
    BaseModel,
    Field,
    field_validator
)

from app.core.config import settings

from app.services.knowledge_ingestion import (
    KnowledgeIngestionError,
    MAX_FILE_BYTES,
    ingest_document
)

from app.services.query_embedding_service import (
    generate_query_embedding
)


router = APIRouter()


# ============================================================
# REQUEST SCHEMAS
# ============================================================

class DocumentIngestionRequest(BaseModel):

    file_name: str = Field(
        min_length=1,
        max_length=255
    )

    content_base64: str = Field(
        min_length=1,
        max_length=14_000_000
    )

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value):

        value = value.strip()

        if (
            "/" in value
            or "\\" in value
            or value in {".", ".."}
        ):

            raise ValueError(
                "Invalid file name."
            )

        return value


class QueryEmbeddingRequest(BaseModel):

    query: str = Field(
        min_length=1,
        max_length=5000
    )

    @field_validator("query")
    @classmethod
    def validate_query(cls, value):

        value = value.strip()

        if not value:

            raise ValueError(
                "Query cannot be empty."
            )

        return value


# ============================================================
# DOCUMENT INGESTION
# ============================================================

@router.post("/knowledge/ingest")
def ingest_knowledge_document(
    payload: DocumentIngestionRequest
):

    try:

        raw = base64.b64decode(
            payload.content_base64,
            validate=True
        )

        if (
            not raw
            or len(raw) > MAX_FILE_BYTES
        ):

            raise KnowledgeIngestionError(
                "File must be between 1 byte and 10 MiB."
            )

        result = ingest_document(
            payload.file_name,
            raw
        )

        return {
            "success": True,
            **result
        }

    except (
        binascii.Error,
        ValueError,
        KnowledgeIngestionError
    ) as error:

        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error

    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail="Document processing failed."
        ) from error


# ============================================================
# QUERY EMBEDDING
# ============================================================

@router.post("/knowledge/embed-query")
def embed_knowledge_query(
    payload: QueryEmbeddingRequest
):

    try:

        embedding = generate_query_embedding(
            payload.query
        )

        return {

            "success": True,

            "model": settings.COHERE_EMBED_MODEL,

            "dimension": len(embedding),

            "embedding": embedding

        }

    except ValueError as error:

        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error

    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail="Query embedding generation failed."
        ) from error