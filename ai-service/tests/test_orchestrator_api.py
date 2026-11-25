from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings

from app.services import (
    entity_service,
    orchestrator,
)


client = TestClient(app)

TEST_API_KEY = "test-orchestrator-integration-key"


def test_orchestrator_endpoint_executes_authenticated_pipeline(monkeypatch):

    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        TEST_API_KEY,
    )

    monkeypatch.setattr(
        entity_service,
        "_cohere_extract",
        lambda request, allowed: [],
    )

    generation_calls = []

    def fake_generation(request):

        generation_calls.append(request)

        return SimpleNamespace(
            response="Hello! I received your previous message.",
            model="test-model",
            finish_reason="stop",
            usage={},
        )

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        fake_generation,
    )

    response = client.post(
        "/api/v1/orchestrator/run",
        headers={
            "Authorization": f"Bearer {TEST_API_KEY}"
        },
        json={
            "message": "How are you?",
            "history": [
                {
                    "sender_type": "customer",
                    "content": "Hello"
                },
                {
                    "sender_type": "bot",
                    "content": "Hi! How can I help?"
                }
            ],
            "domain": "general",
            "required_entities": [],
            "conversation_summary": None
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True

    assert body["status"] == "response_generated"

    assert body["destination"] == "GENERAL_AI"

    assert body["response"] == (
        "Hello! I received your previous message."
    )

    assert len(generation_calls) == 1

    assert body["context_history_messages_included"] >= 2


def test_orchestrator_endpoint_rejects_missing_authentication(monkeypatch):

    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        TEST_API_KEY,
    )

    response = client.post(
        "/api/v1/orchestrator/run",
        json={
            "message": "Hello"
        },
    )

    assert response.status_code == 401