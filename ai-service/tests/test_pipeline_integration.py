from types import SimpleNamespace

import pytest

from app.schemas.orchestration import OrchestrationRequest
from app.services import entity_service, orchestrator


@pytest.fixture(autouse=True)
def mock_cohere_entity_extraction(monkeypatch):
    """Prevent external Cohere calls while retaining the real entity service."""

    monkeypatch.setattr(
        entity_service,
        "_cohere_extract",
        lambda request, allowed: [],
    )


def test_greeting_runs_actual_pipeline(monkeypatch):
    """Greeting should reach GENERAL_AI and generate a response."""

    generation_calls = []

    def fake_generation(request):
        generation_calls.append(request)

        return SimpleNamespace(
            response="Hello! How can I help you?",
            model="test-model",
            finish_reason="stop",
            usage={},
        )

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        fake_generation,
    )

    request = OrchestrationRequest(message="Hello")

    result = orchestrator.orchestrate(request)

    assert result.destination == "GENERAL_AI"
    assert result.intent.primary_intent == "GREETING"
    assert result.status == "response_generated"
    assert result.response == "Hello! How can I help you?"
    assert len(generation_calls) == 1


def test_product_pricing_routes_to_product_agent():
    """Pricing enquiries should route to PRODUCT_AGENT."""

    request = OrchestrationRequest(
        message="How much does the Pro plan cost?",
        domain="saas",
    )

    result = orchestrator.orchestrate(request)

    assert result.intent.primary_intent == "PRICING_ENQUIRY"
    assert result.destination == "PRODUCT_AGENT"
    assert result.status == "agent_routing_required"
    assert result.response is None


def test_order_tracking_routes_to_support_agent():
    """Order tracking should use actual intent and entity rules."""

    request = OrchestrationRequest(
        message="Where is my order ORD-12345?",
        domain="ecommerce",
        required_entities=["ORDER_ID"],
    )

    result = orchestrator.orchestrate(request)

    assert result.intent.primary_intent == "ORDER_TRACKING"
    assert result.destination == "SUPPORT_AGENT"
    assert result.status == "agent_routing_required"

    order_ids = [
        entity.value
        for entity in result.entities.entities
        if entity.entity_type == "ORDER_ID"
    ]

    assert "ORD-12345" in order_ids
    assert result.entities.requires_clarification is False


def test_explicit_human_request_routes_to_human_agent():
    """An explicit human request should take routing priority."""

    request = OrchestrationRequest(
        message="I need a human agent",
    )

    result = orchestrator.orchestrate(request)

    assert result.intent.primary_intent == "HUMAN_HANDOFF"
    assert result.routing.handoff_requested is True
    assert result.destination == "HUMAN_AGENT"
    assert result.status == "handoff_required"
    assert result.response is None


def test_missing_order_id_requires_clarification():
    """Order tracking without a required order ID should request clarification."""

    request = OrchestrationRequest(
        message="Track my order",
        domain="ecommerce",
        required_entities=["ORDER_ID"],
    )

    result = orchestrator.orchestrate(request)

    assert result.intent.primary_intent == "ORDER_TRACKING"
    assert result.entities.requires_clarification is True
    assert "ORDER_ID" in result.entities.missing_entities
    assert result.destination == "CLARIFICATION_REQUIRED"
    assert result.status == "clarification_required"
    assert result.response is not None