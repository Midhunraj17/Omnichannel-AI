from unittest.mock import MagicMock, patch

import pytest


from app.services.reranking_service import (

    rerank_documents,

    RerankingValidationError,

    RerankingProviderError,

)


DOCUMENTS = [

    {

        "chunk_id": "chunk-1",

        "content": "Refund policy for cancelled orders.",

        "file_name": "refunds.pdf",

        "metadata": {},

    },

    {

        "chunk_id": "chunk-2",

        "content": "Shipping and delivery information.",

        "file_name": "shipping.pdf",

        "metadata": {},

    },

    {

        "chunk_id": "chunk-3",

        "content": "How to return purchased products.",

        "file_name": "returns.pdf",

        "metadata": {},

    },

]


def create_response(results):

    response = MagicMock()

    response.results = results

    return response


def create_item(index, score):

    item = MagicMock()

    item.index = index

    item.relevance_score = score

    return item


# ============================================================
# 1. SUCCESSFUL RERANKING
# ============================================================

@patch("app.services.reranking_service.cohere_client.rerank")

def test_successful_reranking(mock_rerank):

    mock_rerank.return_value = create_response([

        create_item(2, 0.95),

        create_item(0, 0.87),

    ])

    result = rerank_documents(

        query="How do I return an order?",

        documents=DOCUMENTS,

        top_n=2,

    )

    assert len(result) == 2

    assert result[0]["chunk_id"] == "chunk-3"

    assert result[0]["rerank_score"] == 0.95

    assert result[0]["rerank_rank"] == 1

    assert result[1]["chunk_id"] == "chunk-1"

    mock_rerank.assert_called_once()


# ============================================================
# 2. PRESERVE ORIGINAL METADATA
# ============================================================

@patch("app.services.reranking_service.cohere_client.rerank")

def test_preserves_original_metadata(mock_rerank):

    mock_rerank.return_value = create_response([

        create_item(0, 0.91),

    ])

    result = rerank_documents(

        query="Refund",

        documents=DOCUMENTS,

        top_n=1,

    )

    assert result[0]["file_name"] == "refunds.pdf"

    assert result[0]["metadata"] == {}


# ============================================================
# 3. EMPTY DOCUMENT LIST
# ============================================================

def test_empty_document_list():

    result = rerank_documents(

        query="Refund",

        documents=[],

    )

    assert result == []


# ============================================================
# 4. EMPTY QUERY
# ============================================================

def test_empty_query_rejected():

    with pytest.raises(RerankingValidationError):

        rerank_documents(

            query=" ",

            documents=DOCUMENTS,

        )


# ============================================================
# 5. INVALID TOP N
# ============================================================

def test_invalid_top_n_rejected():

    with pytest.raises(RerankingValidationError):

        rerank_documents(

            query="Refund",

            documents=DOCUMENTS,

            top_n=0,

        )


# ============================================================
# 6. DUPLICATE CHUNK IDS
# ============================================================

def test_duplicate_chunk_ids_rejected():

    documents = [

        DOCUMENTS[0],

        DOCUMENTS[0],

    ]

    with pytest.raises(RerankingValidationError):

        rerank_documents(

            query="Refund",

            documents=documents,

        )


# ============================================================
# 7. INVALID DOCUMENT CONTENT
# ============================================================

def test_empty_document_content_rejected():

    documents = [

        {

            "chunk_id": "chunk-1",

            "content": "  ",

        }

    ]

    with pytest.raises(RerankingValidationError):

        rerank_documents(

            query="Refund",

            documents=documents,

        )


# ============================================================
# 8. RELEVANCE FILTERING
# ============================================================

@patch("app.services.reranking_service.cohere_client.rerank")

def test_minimum_relevance_filtering(mock_rerank):

    mock_rerank.return_value = create_response([

        create_item(0, 0.90),

        create_item(1, 0.20),

    ])

    result = rerank_documents(

        query="Refund",

        documents=DOCUMENTS,

        top_n=2,

        min_relevance_score=0.50,

    )

    assert len(result) == 1

    assert result[0]["chunk_id"] == "chunk-1"


# ============================================================
# 9. PROVIDER FAILURE
# ============================================================

@patch("app.services.reranking_service.cohere_client.rerank")

def test_provider_failure_is_controlled(mock_rerank):

    mock_rerank.side_effect = RuntimeError(

        "Sensitive provider error"

    )

    with pytest.raises(RerankingProviderError):

        rerank_documents(

            query="Refund",

            documents=DOCUMENTS,

        )


# ============================================================
# 10. INVALID PROVIDER INDEX
# ============================================================

@patch("app.services.reranking_service.cohere_client.rerank")

def test_invalid_provider_index_rejected(mock_rerank):

    mock_rerank.return_value = create_response([

        create_item(100, 0.90),

    ])

    with pytest.raises(RerankingProviderError):

        rerank_documents(

            query="Refund",

            documents=DOCUMENTS,

        )