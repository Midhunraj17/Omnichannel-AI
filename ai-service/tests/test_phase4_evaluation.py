from types import SimpleNamespace

import pytest

from app.schemas.orchestration import OrchestrationRequest
from app.services import entity_service, orchestrator


@pytest.fixture(autouse=True)
def disable_external_entity_calls(monkeypatch):
    monkeypatch.setattr(
        entity_service,
        "_cohere_extract",
        lambda request, allowed: [],
    )


def fake_generation(request):
    return SimpleNamespace(
        response="Evaluation response.",
        model="evaluation-model",
        finish_reason="stop",
        usage={},
    )


@pytest.mark.parametrize(
    "message, domain, required_entities, expected_intent, expected_status, expected_destination",
    [
        (
            "Hello",
            "general",
            [],
            "GREETING",
            "response_generated",
            "GENERAL_AI",
        ),
        (
            "Where is my order ORD-12345?",
            "ecommerce",
            ["ORDER_ID"],
            "ORDER_TRACKING",
            "agent_routing_required",
            "SUPPORT_AGENT",
        ),
        (
            "How much does the Pro plan cost?",
            "saas",
            [],
            "PRICING_ENQUIRY",
            "agent_routing_required",
            "PRODUCT_AGENT",
        ),
        (
            "I need a human agent",
            "general",
            [],
            "HUMAN_HANDOFF",
            "handoff_required",
            "HUMAN_AGENT",
        ),
        (
            "Track my order",
            "ecommerce",
            ["ORDER_ID"],
            "ORDER_TRACKING",
            "clarification_required",
            "CLARIFICATION_REQUIRED",
        ),
    ],
)
def test_phase4_orchestration_evaluation(
    monkeypatch,
    message,
    domain,
    required_entities,
    expected_intent,
    expected_status,
    expected_destination,
):
    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        fake_generation,
    )

    request = OrchestrationRequest(
        message=message,
        domain=domain,
        required_entities=required_entities,
    )

    result = orchestrator.orchestrate(request)

    assert result.success is True

    assert result.intent.primary_intent == expected_intent

    assert result.status == expected_status

    assert result.destination == expected_destination


def test_human_handoff_does_not_generate_llm_response(monkeypatch):
    generation_calls = []

    def unexpected_generation(request):
        generation_calls.append(request)

        raise AssertionError(
            "LLM generation must not execute during human handoff."
        )

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        unexpected_generation,
    )

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            message="I want to speak with a human agent."
        )
    )

    assert result.status == "handoff_required"

    assert result.destination == "HUMAN_AGENT"

    assert result.response is None

    assert generation_calls == []


def test_support_routing_does_not_generate_customer_answer(
    monkeypatch,
):
    generation_calls = []

    def unexpected_generation(request):
        generation_calls.append(request)

        raise AssertionError(
            "Customer response generation must not run for agent routing."
        )

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        unexpected_generation,
    )

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            message="Where is my order ORD-12345?",
            domain="ecommerce",
            required_entities=["ORDER_ID"],
        )
    )

    assert result.status == "agent_routing_required"

    assert result.destination == "SUPPORT_AGENT"

    assert result.response is None

    assert generation_calls == []


def test_general_query_generates_customer_response(monkeypatch):
    calls = []

    def controlled_generation(request):
        calls.append(request)

        return SimpleNamespace(
            response="Controlled evaluation answer.",
            model="evaluation-model",
            finish_reason="stop",
            usage={},
        )

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        controlled_generation,
    )

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            message="Hello, how are you?"
        )
    )

    assert result.status == "response_generated"

    assert result.destination == "GENERAL_AI"

    assert result.response == "Controlled evaluation answer."

    assert len(calls) == 1


def test_response_generation_failure_returns_safe_fallback(
    monkeypatch,
):
    def fail_generation(request):
        raise RuntimeError("Simulated provider failure")

    monkeypatch.setattr(
        orchestrator,
        "generate_customer_response",
        fail_generation,
    )

    result = orchestrator.orchestrate(
        OrchestrationRequest(
            message="Hello"
        )
    )

    assert result.success is False

    assert result.status == "generation_failed"

    assert result.response is not None

    assert "temporarily unable" in result.response.lower()

    assert "Simulated provider failure" not in result.response


def test_invalid_message_is_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        OrchestrationRequest(message="   ")


def test_excessive_history_is_rejected():
    from pydantic import ValidationError

    history = [
        {
            "sender_type": "customer",
            "content": "Previous message",
        }
        for _ in range(101)
    ]

    with pytest.raises(ValidationError):
        OrchestrationRequest(
            message="Hello",
            history=history,
        )