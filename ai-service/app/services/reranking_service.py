from __future__ import annotations

import logging

from typing import Any

from app.core.config import settings

from app.services.cohere_client import cohere_client


logger = logging.getLogger(__name__)


MAX_QUERY_LENGTH = 5000

MAX_DOCUMENTS = 20

MAX_DOCUMENT_LENGTH = 4000

DEFAULT_TOP_N = 8

MIN_RELEVANCE_SCORE = 0.0


class RerankingError(Exception):
    """Base exception for document reranking."""


class RerankingValidationError(RerankingError):
    """Raised when reranking input is invalid."""


class RerankingProviderError(RerankingError):
    """Raised when the Cohere reranking provider fails."""


def _validate_query(query: str) -> str:

    if not isinstance(query, str):

        raise RerankingValidationError(
            "Query must be a string."
        )

    query = query.strip()

    if not query:

        raise RerankingValidationError(
            "Query cannot be empty."
        )

    if len(query) > MAX_QUERY_LENGTH:

        raise RerankingValidationError(
            "Query exceeds the maximum permitted length."
        )

    return query


def _validate_documents(
    documents: list[dict[str, Any]]
) -> list[dict[str, Any]]:

    if not isinstance(documents, list):

        raise RerankingValidationError(
            "Documents must be a list."
        )

    if len(documents) > MAX_DOCUMENTS:

        raise RerankingValidationError(
            f"A maximum of {MAX_DOCUMENTS} documents is permitted."
        )

    normalized = []

    seen_ids = set()

    for index, item in enumerate(documents):

        if not isinstance(item, dict):

            raise RerankingValidationError(
                f"Document at index {index} must be an object."
            )

        chunk_id = item.get("chunk_id")

        content = item.get("content")

        if not isinstance(chunk_id, str) or not chunk_id.strip():

            raise RerankingValidationError(
                f"Document at index {index} has an invalid chunk_id."
            )

        if chunk_id in seen_ids:

            raise RerankingValidationError(
                "Duplicate chunk IDs are not permitted."
            )

        if not isinstance(content, str) or not content.strip():

            raise RerankingValidationError(
                f"Document at index {index} has empty content."
            )

        if len(content) > MAX_DOCUMENT_LENGTH:

            raise RerankingValidationError(
                f"Document at index {index} exceeds the maximum length."
            )

        seen_ids.add(chunk_id)

        normalized.append({

            **item,

            "chunk_id": chunk_id,

            "content": content.strip(),

        })

    return normalized


def rerank_documents(

    query: str,

    documents: list[dict[str, Any]],

    top_n: int = DEFAULT_TOP_N,

    min_relevance_score: float = MIN_RELEVANCE_SCORE,

) -> list[dict[str, Any]]:

    """
    Rerank hybrid-retrieval candidates using Cohere.

    Original retrieval metadata is retained.

    The Cohere relevance score is added to every returned result.
    """

    # --------------------------------------------------
    # 1. VALIDATE QUERY
    # --------------------------------------------------

    normalized_query = _validate_query(query)

    # --------------------------------------------------
    # 2. VALIDATE CANDIDATES
    # --------------------------------------------------

    normalized_documents = _validate_documents(
        documents
    )

    if not normalized_documents:

        return []

    # --------------------------------------------------
    # 3. VALIDATE TOP N
    # --------------------------------------------------

    if (

        not isinstance(top_n, int)

        or isinstance(top_n, bool)

        or top_n < 1

        or top_n > MAX_DOCUMENTS

    ):

        raise RerankingValidationError(
            f"top_n must be between 1 and {MAX_DOCUMENTS}."
        )

    # --------------------------------------------------
    # 4. VALIDATE RELEVANCE THRESHOLD
    # --------------------------------------------------

    if (

        not isinstance(min_relevance_score, (int, float))

        or isinstance(min_relevance_score, bool)

        or not 0.0 <= min_relevance_score <= 1.0

    ):

        raise RerankingValidationError(
            "min_relevance_score must be between 0 and 1."
        )

    # --------------------------------------------------
    # 5. PREPARE DOCUMENT TEXT
    # --------------------------------------------------

    document_texts = [

        document["content"]

        for document in normalized_documents

    ]

    # --------------------------------------------------
    # 6. CALL COHERE RERANK
    # --------------------------------------------------

    try:

        response = cohere_client.rerank(

            model=settings.COHERE_RERANK_MODEL,

            query=normalized_query,

            documents=document_texts,

            top_n=min(top_n, len(normalized_documents))

        )

    except Exception as error:

        logger.error(

            "Cohere reranking failed: %s",

            type(error).__name__,

        )

        raise RerankingProviderError(
            "The document reranking provider is unavailable."
        ) from error

    # --------------------------------------------------
    # 7. VALIDATE PROVIDER RESULTS
    # --------------------------------------------------

    try:

        provider_results = response.results

    except AttributeError as error:

        raise RerankingProviderError(
            "Invalid reranking provider response."
        ) from error

    results = []

    seen_indices = set()

    for item in provider_results:

        try:

            index = int(item.index)

            score = float(item.relevance_score)

        except (

            AttributeError,

            TypeError,

            ValueError,

        ) as error:

            raise RerankingProviderError(
                "Malformed reranking result."
            ) from error

        if (

            index < 0

            or index >= len(normalized_documents)

            or index in seen_indices

        ):

            raise RerankingProviderError(
                "Reranking provider returned an invalid document index."
            )

        if not 0.0 <= score <= 1.0:

            raise RerankingProviderError(
                "Reranking provider returned an invalid relevance score."
            )

        seen_indices.add(index)

        if score < min_relevance_score:

            continue

        original_document = normalized_documents[index]

        results.append({

            **original_document,

            "rerank_score": score,

            "rerank_rank": len(results) + 1,

            "reranking_model": settings.COHERE_RERANK_MODEL,

        })

    # --------------------------------------------------
    # 8. RETURN RERANKED RESULTS
    # --------------------------------------------------

    return results