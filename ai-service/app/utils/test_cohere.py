import os
import pytest

from app.services.llm_service import generate_response
from app.services.embedding_service import generate_embedding
from app.services.reranking_service import rerank_documents


# Run these tests only when explicitly enabled.
pytestmark = pytest.mark.skipif(
    os.getenv("RUN_COHERE_INTEGRATION") != "1",
    reason="Live Cohere integration tests are disabled by default."
)


def test_llm():

    response = generate_response(
        "Explain what an AI chatbot is in two sentences."
    )

    assert isinstance(response, str)
    assert response.strip()


def test_embedding():

    embedding = generate_embedding(
        "Our company provides premium laptops."
    )

    assert isinstance(embedding, list)
    assert len(embedding) > 0
    assert all(isinstance(value, (int, float)) for value in embedding)


def test_reranking():

    query = "How can I return my purchased product?"

    documents = [
        "Our return policy allows customers to return eligible products within 30 days.",
        "Our company provides free shipping on orders above Rs. 1000.",
        "Customers can contact support for assistance with product returns.",
        "Our premium membership offers exclusive discounts."
    ]

    results = rerank_documents(query, documents)

    assert isinstance(results, list)
    assert len(results) > 0

    for result in results:
        assert "relevance_score" in result
        assert "document" in result