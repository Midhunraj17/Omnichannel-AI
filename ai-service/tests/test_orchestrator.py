from types import SimpleNamespace
from unittest.mock import patch
import pytest


from app.core.config import settings

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.entities import EntityExtractionResponse
from app.schemas.intent import IntentClassificationResponse
from app.schemas.routing import RoutingResponse

client = TestClient(app)
TEST_API_KEY = "test-internal-api-key"


@pytest.fixture(autouse=True)
def configure_test_api_key(monkeypatch):
    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        TEST_API_KEY,
    )


def _post_orchestrator(payload):
    return client.post(
        "/api/v1/orchestrator/run",
        headers={"Authorization": f"Bearer {TEST_API_KEY}"},
        json=payload,
    )


def _intent(name="GENERAL_QUESTION", handoff=False, clarification=False):
    return IntentClassificationResponse(
        primary_intent=name,
        intents=[{"name": name, "confidence": 0.95}],
        confidence=0.95,
        classification_method="rules",
        handoff_requested=handoff,
        requires_clarification=clarification,
    )


def _entities(missing=None, clarification=False):
    return EntityExtractionResponse(
        entities=[],
        missing_entities=missing or [],
        extraction_method="none",
        requires_clarification=clarification,
    )


def _routing(destination="GENERAL_AI", handoff=False, clarification=False):
    return RoutingResponse(
        destination=destination,
        confidence=0.95,
        matched_intents=["GENERAL_QUESTION"],
        reason="Test route",
        requires_clarification=clarification,
        handoff_requested=handoff,
    )


@patch("app.services.orchestrator.generate_customer_response")
@patch("app.services.orchestrator.decide_route")
@patch("app.services.orchestrator.extract_entities")
@patch("app.services.orchestrator.classify_intent")
def test_general_ai_runs_response_generation(
    mock_intent, mock_entities, mock_route, mock_generate
):
    mock_intent.return_value = _intent().model_dump(exclude={"success"})
    mock_entities.return_value = _entities().model_dump(exclude={"success"})
    mock_route.return_value = _routing()
    mock_generate.return_value = SimpleNamespace(
        response="Hello! How can I help?",
        model="test-model",
        finish_reason="COMPLETE",
        usage={"input_tokens": 10, "output_tokens": 8},
    )

    response = _post_orchestrator(
    {"message": "Hello there", "history": []}
)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "response_generated"
    assert body["response"] == "Hello! How can I help?"
    mock_generate.assert_called_once()


@patch("app.services.orchestrator.generate_customer_response")
@patch("app.services.orchestrator.decide_route")
@patch("app.services.orchestrator.extract_entities")
@patch("app.services.orchestrator.classify_intent")
def test_human_handoff_does_not_call_llm(
    mock_intent, mock_entities, mock_route, mock_generate
):
    mock_intent.return_value = _intent("HUMAN_HANDOFF", handoff=True).model_dump(exclude={"success"})
    mock_entities.return_value = _entities().model_dump(exclude={"success"})
    mock_route.return_value = _routing("HUMAN_AGENT", handoff=True)

    response = _post_orchestrator(
    {"message": "I want to speak to a person", "history": []}
)

    assert response.status_code == 200
    assert response.json()["status"] == "handoff_required"
    mock_generate.assert_not_called()


@patch("app.services.orchestrator.generate_customer_response")
@patch("app.services.orchestrator.decide_route")
@patch("app.services.orchestrator.extract_entities")
@patch("app.services.orchestrator.classify_intent")
def test_missing_required_entity_requests_clarification(
    mock_intent, mock_entities, mock_route, mock_generate
):
    mock_intent.return_value = _intent().model_dump(exclude={"success"})
    mock_entities.return_value = _entities(
        ["ORDER_ID"], clarification=True
    ).model_dump(exclude={"success"})
    mock_route.return_value = _routing()

    response = _post_orchestrator(
    {"message": "Where is my order?", "history": []}
)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "clarification_required"
    assert "order id" in body["response"].lower()
    assert body["destination"] == "CLARIFICATION_REQUIRED"
    mock_generate.assert_not_called()


@patch("app.services.orchestrator.generate_customer_response")
@patch("app.services.orchestrator.decide_route")
@patch("app.services.orchestrator.extract_entities")
@patch("app.services.orchestrator.classify_intent")
def test_support_agent_route_does_not_execute_business_action(
    mock_intent, mock_entities, mock_route, mock_generate
):
    mock_intent.return_value = _intent("ORDER_STATUS").model_dump(exclude={"success"})
    mock_entities.return_value = _entities().model_dump(exclude={"success"})
    mock_route.return_value = _routing("SUPPORT_AGENT")
    response = _post_orchestrator(
    {"message": "Check my order status", "history": []}
)

    assert response.status_code == 200
    assert response.json()["status"] == "agent_routing_required"
    assert response.json()["response"] is None
    mock_generate.assert_not_called()


def test_orchestrator_rejects_blank_message():
    response = _post_orchestrator(
    {"message": "   ", "history": []}
)
    assert response.status_code == 422
