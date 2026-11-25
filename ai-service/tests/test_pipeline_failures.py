from app.schemas.orchestration import OrchestrationRequest
from app.services import entity_service, orchestrator
import pytest
from pydantic import ValidationError
from app.schemas.orchestration import OrchestrationRequest
from app.schemas.intent import IntentClassificationResponse, IntentItem
from app.services.routing_engine import decide_route


def test_low_confidence_intent_requires_clarification():
    classification = IntentClassificationResponse(
        primary_intent="ORDER_TRACKING",
        intents=[
            IntentItem(
                name="ORDER_TRACKING",
                confidence=0.45,
            )
        ],
        confidence=0.45,
        classification_method="rules",
        handoff_requested=False,
        requires_clarification=False,
    )

    result = decide_route(classification)

    assert result.destination == "CLARIFICATION_REQUIRED"
    assert result.requires_clarification is True


def test_confidence_at_threshold_allows_routing():
    classification = IntentClassificationResponse(
        primary_intent="ORDER_TRACKING",
        intents=[
            IntentItem(
                name="ORDER_TRACKING",
                confidence=0.60,
            )
        ],
        confidence=0.60,
        classification_method="rules",
        handoff_requested=False,
        requires_clarification=False,
    )

    result = decide_route(classification)

    assert result.destination == "SUPPORT_AGENT"
    assert result.requires_clarification is False

def test_empty_message_is_rejected():
    with pytest.raises(ValidationError):
        OrchestrationRequest(message="")


def test_excessively_long_message_is_rejected():
    with pytest.raises(ValidationError):
        OrchestrationRequest(message="A" * 10001)


def test_pipeline_survives_cohere_entity_failure(monkeypatch):
    """Rule-based extraction should work when Cohere is unavailable."""

    def simulate_cohere_failure(request, allowed):
        raise RuntimeError("Cohere API unavailable")

    monkeypatch.setattr(
        entity_service,
        "_cohere_extract",
        simulate_cohere_failure,
    )

    request = OrchestrationRequest(
        message="Where is my order ORD-12345?",
        domain="ecommerce",
        required_entities=["ORDER_ID"],
    )

    result = orchestrator.orchestrate(request)

    assert result.destination == "SUPPORT_AGENT"
    assert result.status == "agent_routing_required"

    order_ids = [
        entity.value
        for entity in result.entities.entities
        if entity.entity_type == "ORDER_ID"
    ]

    assert "ORD-12345" in order_ids
    assert result.entities.requires_clarification is False
def test_entity_extraction_fails_gracefully_when_all_methods_fail(monkeypatch):
    from app.schemas.entities import EntityExtractionRequest
    from app.services import entity_service

    def simulate_cohere_failure(request, allowed):
        raise RuntimeError("Cohere API unavailable")

    monkeypatch.setattr(
        entity_service,
        "_cohere_extract",
        simulate_cohere_failure,
    )

    request = EntityExtractionRequest(
        message="I need help with something",
        domain="ecommerce",
        required_entities=["ORDER_ID"],
    )

    with pytest.raises(RuntimeError, match="Entity extraction is temporarily unavailable"):
        entity_service.extract_entities(request)

def test_response_generation_failure_returns_safe_fallback(monkeypatch):
    from app.services import orchestrator
    from app.schemas.orchestration import OrchestrationRequest

    def simulate_generation_failure(request):
        raise RuntimeError("Cohere API unavailable")

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        simulate_generation_failure,
    )

    request = OrchestrationRequest(message="Hello")

    result = orchestrator.orchestrate(request)

    assert result.success is False
    assert result.status == "generation_failed"
    assert result.destination == "GENERAL_AI"
    assert result.response is not None
    assert "temporarily unable" in result.response
    assert "Cohere API unavailable" not in result.response
    assert result.model is None
    assert result.usage is None