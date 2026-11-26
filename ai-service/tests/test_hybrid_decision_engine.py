import pytest

from app.schemas.entities import EntityExtractionResponse

from app.schemas.intent import (
    IntentClassificationResponse,
)

from app.schemas.routing import RoutingResponse

from app.schemas.ticket_triage import (
    TicketTriageResult,
)

from app.services.hybrid_decision_engine import (
    decide_hybrid_action,
)


# =========================================================
# TEST FACTORIES
# =========================================================

def make_intent(
    name="GENERAL_QUESTION",
    confidence=0.95,
    handoff=False,
    clarification=False,
):

    return IntentClassificationResponse(

        primary_intent=name,

        intents=[
            {
                "name": name,
                "confidence": confidence,
            }
        ],

        confidence=confidence,

        classification_method="rules",

        handoff_requested=handoff,

        requires_clarification=clarification,

    )


def make_entities(
    missing=None,
    clarification=False,
):

    return EntityExtractionResponse(

        entities=[],

        missing_entities=missing or [],

        extraction_method="rules",

        requires_clarification=clarification,

    )


def make_routing(
    destination="GENERAL_AI",
    handoff=False,
    clarification=False,
):

    return RoutingResponse(

        destination=destination,

        confidence=0.95,

        matched_intents=["GENERAL_QUESTION"],

        reason="Test routing",

        requires_clarification=clarification,

        handoff_requested=handoff,

    )


def make_triage(
    human_review=False,
    escalation=False,
    confidence=0.90,
):

    return TicketTriageResult(

        category="TECHNICAL",

        subcategory="technical_failure",

        priority="P2_HIGH",

        priority_score=75,

        severity="HIGH",

        impact_level=4,

        urgency_level=4,

        sentiment="NEGATIVE",

        urgency_signals=[],

        priority_reason_codes=[],

        reason="Technical issue",

        classification_method="rules",

        confidence=confidence,

        labels=["technical"],

        issues=[],

        requires_human_review=human_review,

        escalation_required=escalation,

        first_response_sla_hours=4,

        resolution_sla_hours=12,

        suggested_sla_hours=4,

    )


# =========================================================
# TEST 1: GENERAL AI RESPONSE
# =========================================================

def test_general_question_selects_answer():

    result = decide_hybrid_action(

        intent=make_intent(),

        entities=make_entities(),

        routing=make_routing(),

        ticket_triage=None,

    )

    assert result.action == "ANSWER"

    assert result.destination == "GENERAL_AI"

    assert result.requires_clarification is False


# =========================================================
# TEST 2: EXPLICIT HUMAN HANDOFF
# =========================================================

def test_explicit_handoff_has_highest_precedence():

    result = decide_hybrid_action(

        intent=make_intent(
            name="HUMAN_HANDOFF",
            handoff=True,
        ),

        entities=make_entities(
            missing=["ORDER_ID"],
            clarification=True,
        ),

        routing=make_routing(
            destination="HUMAN_AGENT",
            handoff=True,
        ),

        ticket_triage=None,

    )

    assert result.action == "HANDOFF"

    assert result.destination == "HUMAN_AGENT"

    assert "EXPLICIT_HANDOFF" in result.reason_codes


# =========================================================
# TEST 3: MISSING ENTITY
# =========================================================

def test_missing_entity_selects_clarification():

    result = decide_hybrid_action(

        intent=make_intent(
            name="ORDER_TRACKING",
        ),

        entities=make_entities(
            missing=["ORDER_ID"],
            clarification=True,
        ),

        routing=make_routing(
            destination="SUPPORT_AGENT",
        ),

        ticket_triage=None,

    )

    assert result.action == "CLARIFY"

    assert result.requires_clarification is True

    assert result.destination == "CLARIFICATION_REQUIRED"


# =========================================================
# TEST 4: AMBIGUOUS INTENT
# =========================================================

def test_ambiguous_intent_selects_clarification():

    result = decide_hybrid_action(

        intent=make_intent(
            name="AMBIGUOUS",
            clarification=True,
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="CLARIFICATION_REQUIRED",
            clarification=True,
        ),

        ticket_triage=None,

    )

    assert result.action == "CLARIFY"


# =========================================================
# TEST 5: LOW CONFIDENCE
# =========================================================

def test_low_confidence_selects_clarification():

    result = decide_hybrid_action(

        intent=make_intent(
            name="REFUND_REQUEST",
            confidence=0.40,
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="CLARIFICATION_REQUIRED",
            clarification=True,
        ),

        ticket_triage=None,

    )

    assert result.action == "CLARIFY"

    assert result.confidence == 0.40

    assert (
        "LOW_INTENT_CONFIDENCE"
        in result.reason_codes
    )


# =========================================================
# TEST 6: SUPPORT ROUTING
# =========================================================

def test_support_request_selects_support_route():

    result = decide_hybrid_action(

        intent=make_intent(
            name="TECHNICAL_ISSUE",
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="SUPPORT_AGENT",
        ),

        ticket_triage=make_triage(),

    )

    assert result.action == "ROUTE_SUPPORT"

    assert result.destination == "SUPPORT_AGENT"

    assert result.ticket_creation_recommended is True


# =========================================================
# TEST 7: PRODUCT ROUTING
# =========================================================

def test_product_request_selects_product_route():

    result = decide_hybrid_action(

        intent=make_intent(
            name="PRODUCT_ENQUIRY",
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="PRODUCT_AGENT",
        ),

        ticket_triage=None,

    )

    assert result.action == "ROUTE_PRODUCT"

    assert result.destination == "PRODUCT_AGENT"


# =========================================================
# TEST 8: HUMAN REVIEW
# =========================================================

def test_human_review_signal_is_preserved():

    result = decide_hybrid_action(

        intent=make_intent(
            name="TECHNICAL_ISSUE",
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="SUPPORT_AGENT",
        ),

        ticket_triage=make_triage(
            human_review=True,
        ),

    )

    assert result.action == "ROUTE_SUPPORT"

    assert result.human_review_required is True

    assert (
        "HUMAN_REVIEW_REQUIRED"
        in result.reason_codes
    )


# =========================================================
# TEST 9: ESCALATION RECOMMENDATION
# =========================================================

def test_escalation_recommendation_is_preserved():

    result = decide_hybrid_action(

        intent=make_intent(
            name="TECHNICAL_ISSUE",
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="SUPPORT_AGENT",
        ),

        ticket_triage=make_triage(
            escalation=True,
        ),

    )

    assert result.escalation_recommended is True

    assert (
        "ESCALATION_RECOMMENDED"
        in result.reason_codes
    )


# =========================================================
# TEST 10: LOW TICKET CONFIDENCE
# =========================================================

def test_low_ticket_confidence_requires_human_review():

    result = decide_hybrid_action(

        intent=make_intent(
            name="TECHNICAL_ISSUE",
        ),

        entities=make_entities(),

        routing=make_routing(
            destination="SUPPORT_AGENT",
        ),

        ticket_triage=make_triage(
            confidence=0.35,
        ),

    )

    assert result.human_review_required is True

    assert (
        "LOW_CLASSIFICATION_CONFIDENCE"
        in result.reason_codes
    )


# =========================================================
# TEST 11: NO TRIAGE
# =========================================================

def test_general_request_without_triage():

    result = decide_hybrid_action(

        intent=make_intent(),

        entities=make_entities(),

        routing=make_routing(),

        ticket_triage=None,

    )

    assert result.ticket_creation_recommended is False

    assert result.escalation_recommended is False


# =========================================================
# TEST 12: SAFE FALLBACK
# =========================================================

def test_unsupported_destination_uses_safe_fallback():

    result = decide_hybrid_action(

        intent=make_intent(),

        entities=make_entities(),

        routing=make_routing(
            destination="CLARIFICATION_REQUIRED",
            clarification=True,
        ),

        ticket_triage=None,

    )

    assert result.action == "CLARIFY"

    assert result.requires_clarification is True


# =========================================================
# TEST 13: DECISION CONFIDENCE BOUNDS
# =========================================================

@pytest.mark.parametrize(
    "confidence",
    [
        0.0,
        0.25,
        0.60,
        0.85,
        1.0,
    ],
)
def test_decision_confidence_is_bounded(confidence):

    result = decide_hybrid_action(

        intent=make_intent(
            confidence=confidence,
        ),

        entities=make_entities(),

        routing=make_routing(),

        ticket_triage=None,

    )

    assert 0.0 <= result.confidence <= 1.0