import pytest

from app.schemas.intent import IntentClassificationResponse, IntentItem
from app.services.routing_engine import decide_route


def make_classification(
    primary="GENERAL_QUESTION",
    intents=None,
    confidence=0.95,
    handoff=False,
    clarification=False,
):
    if intents is None:
        intents = [{"name": primary, "confidence": confidence}]
    return IntentClassificationResponse(
        primary_intent=primary,
        intents=[IntentItem(**item) for item in intents],
        confidence=confidence,
        classification_method="rules",
        handoff_requested=handoff,
        requires_clarification=clarification,
    )


@pytest.mark.parametrize(
    ("intent", "expected"),
    [
        ("PRODUCT_ENQUIRY", "PRODUCT_AGENT"),
        ("PRICING_ENQUIRY", "PRODUCT_AGENT"),
        ("PRODUCT_COMPARISON", "PRODUCT_AGENT"),
        ("AVAILABILITY_CHECK", "PRODUCT_AGENT"),
        ("FEATURE_ENQUIRY", "PRODUCT_AGENT"),
        ("PURCHASE_INTENT", "PRODUCT_AGENT"),
        ("SERVICE_ENQUIRY", "PRODUCT_AGENT"),
        ("ORDER_TRACKING", "SUPPORT_AGENT"),
        ("ORDER_STATUS", "SUPPORT_AGENT"),
        ("PAYMENT_ISSUE", "SUPPORT_AGENT"),
        ("REFUND_REQUEST", "SUPPORT_AGENT"),
        ("RETURN_REQUEST", "SUPPORT_AGENT"),
        ("COMPLAINT", "SUPPORT_AGENT"),
        ("TECHNICAL_ISSUE", "SUPPORT_AGENT"),
        ("TICKET_STATUS", "SUPPORT_AGENT"),
        ("GREETING", "GENERAL_AI"),
        ("GOODBYE", "GENERAL_AI"),
        ("THANKS", "GENERAL_AI"),
        ("GENERAL_QUESTION", "GENERAL_AI"),
        ("OUT_OF_SCOPE", "GENERAL_AI"),
    ],
)
def test_intent_routes_to_expected_destination(intent, expected):
    result = decide_route(make_classification(primary=intent))
    assert result.destination == expected
    assert result.requires_clarification is False
    assert result.handoff_requested is False


def test_explicit_handoff_flag_has_highest_priority():
    classification = make_classification(
        primary="REFUND_REQUEST",
        handoff=True,
    )
    result = decide_route(classification)
    assert result.destination == "HUMAN_AGENT"
    assert result.handoff_requested is True


def test_human_handoff_intent_routes_to_human():
    classification = make_classification(primary="HUMAN_HANDOFF")
    result = decide_route(classification)
    assert result.destination == "HUMAN_AGENT"


def test_ambiguous_intent_requires_clarification():
    classification = make_classification(
        primary="AMBIGUOUS",
        clarification=True,
    )
    result = decide_route(classification)
    assert result.destination == "CLARIFICATION_REQUIRED"
    assert result.requires_clarification is True


def test_unknown_intent_requires_clarification():
    result = decide_route(make_classification(primary="UNKNOWN"))
    assert result.destination == "CLARIFICATION_REQUIRED"


def test_low_confidence_requires_clarification():
    result = decide_route(
        make_classification(
            primary="REFUND_REQUEST",
            confidence=0.45,
        )
    )
    assert result.destination == "CLARIFICATION_REQUIRED"
    assert result.requires_clarification is True


def test_support_takes_priority_over_product_for_multi_intent():
    classification = make_classification(
        primary="PRODUCT_ENQUIRY",
        intents=[
            {"name": "PRODUCT_ENQUIRY", "confidence": 0.98},
            {"name": "REFUND_REQUEST", "confidence": 0.80},
        ],
    )
    result = decide_route(classification)
    assert result.destination == "SUPPORT_AGENT"
    assert set(result.matched_intents) == {"PRODUCT_ENQUIRY", "REFUND_REQUEST"}


def test_product_takes_priority_over_general_for_multi_intent():
    classification = make_classification(
        primary="GREETING",
        intents=[
            {"name": "GREETING", "confidence": 0.99},
            {"name": "PRODUCT_ENQUIRY", "confidence": 0.90},
        ],
    )
    result = decide_route(classification)
    assert result.destination == "PRODUCT_AGENT"


def test_unmapped_intent_requires_clarification():
    classification = make_classification(
        primary="AMBIGUOUS",
        intents=[],
    )
    # Pydantic permits an empty intents list; primary AMBIGUOUS still requests clarification.
    result = decide_route(classification)
    assert result.destination == "CLARIFICATION_REQUIRED"


def test_response_contains_a_reason_and_bounded_confidence():
    result = decide_route(make_classification(primary="ORDER_STATUS"))
    assert result.reason
    assert 0.0 <= result.confidence <= 1.0
