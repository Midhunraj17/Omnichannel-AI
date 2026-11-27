from types import SimpleNamespace

import pytest

from app.services import (
    query_embedding_service as service
)


class FakeCohereClient:

    def __init__(self, vector):

        self.vector = vector
        self.kwargs = None

    def embed(self, **kwargs):

        self.kwargs = kwargs

        return SimpleNamespace(
            embeddings=SimpleNamespace(
                float=[self.vector]
            )
        )


def test_query_embedding_uses_search_query(monkeypatch):

    fake = FakeCohereClient(
        [0.1] * 1024
    )

    monkeypatch.setattr(
        service,
        "cohere_client",
        fake
    )

    result = service.generate_query_embedding(
        "refund policy"
    )

    assert len(result) == 1024

    assert fake.kwargs["input_type"] == "search_query"

    assert fake.kwargs["texts"] == ["refund policy"]


def test_empty_query_rejected():

    with pytest.raises(ValueError):

        service.generate_query_embedding(
            " "
        )


def test_wrong_dimension_rejected(monkeypatch):

    fake = FakeCohereClient(
        [0.1] * 8
    )

    monkeypatch.setattr(
        service,
        "cohere_client",
        fake
    )

    with pytest.raises(
        RuntimeError,
        match="dimension mismatch"
    ):

        service.generate_query_embedding(
            "refund policy"
        )


def test_non_finite_values_rejected(monkeypatch):

    fake = FakeCohereClient(
        [float("nan")] + [0.1] * 1023
    )

    monkeypatch.setattr(
        service,
        "cohere_client",
        fake
    )

    with pytest.raises(
        RuntimeError,
        match="non-finite"
    ):

        service.generate_query_embedding(
            "refund policy"
        )
