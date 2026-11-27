import base64

import binascii

import logging


from fastapi import (

    APIRouter,

    HTTPException,

    status,

)


from pydantic import (

    BaseModel,

    Field,

    field_validator,

)


from app.core.config import settings


from app.schemas.knowledge_reranking import (

    KnowledgeRerankingRequest,

    KnowledgeRerankingResponse,

)


from app.services.knowledge_ingestion import (

    KnowledgeIngestionError,

    MAX_FILE_BYTES,

    ingest_document,

)


from app.services.query_embedding_service import (

    generate_query_embedding,

)


from app.services.reranking_service import (

    RerankingError,

    RerankingProviderError,

    RerankingValidationError,

    rerank_documents,

)


from app.services.context_builder import (

    build_rag_context,

)


logger = logging.getLogger(__name__)


router = APIRouter()


# ============================================================
# REQUEST SCHEMAS
# ============================================================

class DocumentIngestionRequest(BaseModel):

    file_name: str = Field(

        min_length=1,

        max_length=255,

    )

    content_base64: str = Field(

        min_length=1,

        max_length=14_000_000,

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

        max_length=5000,

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

    payload: DocumentIngestionRequest,

):

    try:

        raw = base64.b64decode(

            payload.content_base64,

            validate=True,

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

            raw,

        )

        return {

            "success": True,

            **result,

        }

    except (

        binascii.Error,

        ValueError,

        KnowledgeIngestionError,

    ) as error:

        raise HTTPException(

            status_code=422,

            detail=str(error),

        ) from error

    except Exception as error:

        logger.exception(

            "Knowledge document ingestion failed."

        )

        raise HTTPException(

            status_code=502,

            detail="Document processing failed.",

        ) from error


# ============================================================
# QUERY EMBEDDING
# ============================================================

@router.post("/knowledge/embed-query")

def embed_knowledge_query(

    payload: QueryEmbeddingRequest,

):

    try:

        embedding = generate_query_embedding(

            payload.query,

        )

        return {

            "success": True,

            "model": settings.COHERE_EMBED_MODEL,

            "dimension": len(embedding),

            "embedding": embedding,

        }

    except ValueError as error:

        raise HTTPException(

            status_code=422,

            detail=str(error),

        ) from error

    except Exception as error:

        logger.exception(

            "Query embedding generation failed."

        )

        raise HTTPException(

            status_code=502,

            detail="Query embedding generation failed.",

        ) from error


# ============================================================
# PHASE 5.8
# RERANKING + CONTEXT CONSTRUCTION
# ============================================================

@router.post(

    "/knowledge/rerank-context",

    response_model=KnowledgeRerankingResponse,

    status_code=status.HTTP_200_OK,

)

def rerank_knowledge_context(

    payload: KnowledgeRerankingRequest,

):

    try:

        candidate_documents = [

            document.model_dump()

            for document in payload.documents

        ]

        # ----------------------------------------------------
        # 1. COHERE RERANKING
        # ----------------------------------------------------

        reranked_documents = rerank_documents(

            query=payload.query,

            documents=candidate_documents,

            top_n=payload.top_n,

            min_relevance_score=(

                payload.min_relevance_score

            ),

        )

        # ----------------------------------------------------
        # 2. BUILD BOUNDED RAG CONTEXT
        # ----------------------------------------------------

        context_result = build_rag_context(

            query=payload.query,

            documents=reranked_documents,

            max_characters=(

                payload.max_context_characters

            ),

            max_documents=payload.top_n,

        )

        # ----------------------------------------------------
        # 3. RETURN STRUCTURED RESPONSE
        # ----------------------------------------------------

        return KnowledgeRerankingResponse(

            success=True,

            query=payload.query,

            reranking_model=(

                settings.COHERE_RERANK_MODEL

            ),

            candidate_count=len(candidate_documents),

            result_count=len(reranked_documents),

            results=reranked_documents,

            context=context_result["context"],

            context_character_count=(

                context_result["character_count"]

            ),

            context_document_count=(

                context_result["document_count"]

            ),

            sources=context_result["sources"],

            context_truncated=(

                context_result["truncated"]

            ),

        )

    except RerankingValidationError as error:

        raise HTTPException(

            status_code=422,

            detail=str(error),

        ) from error

    except RerankingProviderError as error:

        raise HTTPException(

            status_code=502,

            detail="Document reranking is temporarily unavailable.",

        ) from error

    except RerankingError as error:

        raise HTTPException(

            status_code=500,

            detail="Unable to process document reranking.",

        ) from error

    except Exception as error:

        logger.exception(

            "Unexpected error during knowledge reranking."

        )

        raise HTTPException(

            status_code=500,

            detail="Unable to construct knowledge context.",

        ) from error