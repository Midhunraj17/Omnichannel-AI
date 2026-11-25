"""FastAPI route for Phase 3, Task 3.7 — Response Generation Engine.

Exposes:
    POST /api/v1/response/generate

Note:
    This router is intended to be registered in ``app/main.py`` with
    ``prefix="/api/v1"`` and ``tags=["Response Generation"]``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from app.schemas.response_generation import (
    ResponseGenerationRequest,
    ResponseGenerationResult,
)
from app.services.response_generation import (
    EmptyModelResponseError,
    ResponseGenerationError,
    ResponseGenerationProviderError,
    generate_customer_response,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/response/generate",
    response_model=ResponseGenerationResult,
    status_code=status.HTTP_200_OK,
    summary="Generate a domain-aware customer support response",
    description=(
        "Validates an authorized response generation request and generates a "
        "customer-facing reply through the existing Cohere LLM integration."
    ),
)
def generate_response_endpoint(
    payload: ResponseGenerationRequest,
) -> ResponseGenerationResult:
    """Handle POST /api/v1/response/generate with controlled error responses.

    Raw provider errors, stack traces, internal prompts, and credentials are
    never returned to the caller.
    """
    try:
        return generate_customer_response(payload)
    except EmptyModelResponseError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The AI response service returned an empty response. Please try again.",
        )
    except ResponseGenerationProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The AI response service is temporarily unavailable. Please try again later.",
        )
    except ResponseGenerationError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to process the response generation request.",
        )
    except Exception:
        logger.exception("Unexpected error in /api/v1/response/generate.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected internal error occurred while generating the response.",
        )
