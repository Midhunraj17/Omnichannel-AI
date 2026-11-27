import math

from app.core.config import settings

from app.services.cohere_client import (
    cohere_client
)


def generate_query_embedding(
    query: str
) -> list[float]:

    # --------------------------------------------------
    # VALIDATE INPUT
    # --------------------------------------------------

    if not isinstance(query, str):

        raise ValueError(
            "Query must be a string."
        )

    query = query.strip()

    if not query:

        raise ValueError(
            "Search query cannot be empty."
        )

    if len(query) > 5000:

        raise ValueError(
            "Search query exceeds maximum length."
        )

    # --------------------------------------------------
    # GENERATE QUERY EMBEDDING
    # --------------------------------------------------

    response = cohere_client.embed(

        model=settings.COHERE_EMBED_MODEL,

        texts=[query],

        input_type="search_query",

        embedding_types=["float"],

        output_dimension=settings.COHERE_EMBED_DIMENSION

    )

    # --------------------------------------------------
    # EXTRACT VECTOR
    # --------------------------------------------------

    try:

        vector = [
            float(value)
            for value in response.embeddings.float[0]
        ]

    except (
        AttributeError,
        IndexError,
        TypeError,
        ValueError
    ) as error:

        raise RuntimeError(
            "Invalid embedding response."
        ) from error

    # --------------------------------------------------
    # VALIDATE DIMENSION
    # --------------------------------------------------

    expected_dimension = int(
        settings.COHERE_EMBED_DIMENSION
    )

    if len(vector) != expected_dimension:

        raise RuntimeError(
            f"Embedding dimension mismatch. "
            f"Expected {expected_dimension}, "
            f"received {len(vector)}."
        )

    # --------------------------------------------------
    # VALIDATE NUMERIC VALUES
    # --------------------------------------------------

    if not all(
        math.isfinite(value)
        for value in vector
    ):

        raise RuntimeError(
            "Embedding contains non-finite numeric values."
        )

    return vector
