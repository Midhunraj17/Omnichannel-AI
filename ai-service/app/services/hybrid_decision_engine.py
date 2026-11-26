"""Phase 4.5 - Hybrid AI Decision Engine.

Combines deterministic business rules with the outputs of the
existing AI classification, extraction, routing and triage engines.

This module recommends decisions only. It does not execute
business operations or access the database.
"""

from app.schemas.entities import EntityExtractionResponse
from app.schemas.intent import IntentClassificationResponse
from app.schemas.routing import RoutingResponse
from app.schemas.ticket_triage import TicketTriageResult

from app.schemas.hybrid_decision import HybridDecision


# =========================================================
# CONFIGURATION
# =========================================================

MIN_DECISION_CONFIDENCE = 0.60


# =========================================================
# REASON CODES
# =========================================================

EXPLICIT_HANDOFF = "EXPLICIT_HANDOFF"

MISSING_REQUIRED_ENTITY = "MISSING_REQUIRED_ENTITY"

LOW_INTENT_CONFIDENCE = "LOW_INTENT_CONFIDENCE"

AMBIGUOUS_INTENT = "AMBIGUOUS_INTENT"

SUPPORT_REQUEST = "SUPPORT_REQUEST"

PRODUCT_REQUEST = "PRODUCT_REQUEST"

GENERAL_ENQUIRY = "GENERAL_ENQUIRY"

LOW_CLASSIFICATION_CONFIDENCE = (
    "LOW_CLASSIFICATION_CONFIDENCE"
)

HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED"

ESCALATION_RECOMMENDED = "ESCALATION_RECOMMENDED"

TICKET_CREATION_RECOMMENDED = (
    "TICKET_CREATION_RECOMMENDED"
)


# =========================================================
# DECISION ENGINE
# =========================================================

def decide_hybrid_action(
    *,
    intent: IntentClassificationResponse,
    entities: EntityExtractionResponse,
    routing: RoutingResponse,
    ticket_triage: TicketTriageResult | None,
) -> HybridDecision:
    """Evaluate all existing AI engine outputs and select an action.

    Decision precedence:

        1. Explicit human handoff.
        2. Required entity clarification.
        3. Ambiguous or low-confidence classification.
        4. Support routing.
        5. Product routing.
        6. General AI response.

    Ticket priority and human-review signals are incorporated
    into the resulting decision metadata.

    No external service or database is called.
    """

    reason_codes: list[str] = []

    # -----------------------------------------------------
    # 1. COLLECT CONFIDENCE
    # -----------------------------------------------------

    confidence = max(
        0.0,
        min(
            1.0,
            float(intent.confidence),
        ),
    )

    # -----------------------------------------------------
    # 2. COLLECT TICKET METADATA
    # -----------------------------------------------------

    human_review_required = False

    escalation_recommended = False

    ticket_creation_recommended = False

    if ticket_triage is not None:

        human_review_required = (
            ticket_triage.requires_human_review
        )

        escalation_recommended = (
            ticket_triage.escalation_required
        )

        ticket_creation_recommended = True

        if human_review_required:

            reason_codes.append(
                HUMAN_REVIEW_REQUIRED
            )

        if escalation_recommended:

            reason_codes.append(
                ESCALATION_RECOMMENDED
            )

        reason_codes.append(
            TICKET_CREATION_RECOMMENDED
        )

    # -----------------------------------------------------
    # 3. EXPLICIT HUMAN HANDOFF
    # -----------------------------------------------------

    if (
        intent.handoff_requested
        or routing.handoff_requested
        or routing.destination == "HUMAN_AGENT"
    ):

        reason_codes.append(
            EXPLICIT_HANDOFF
        )

        return HybridDecision(

            action="HANDOFF",

            confidence=1.0,

            reason=(
                "The customer explicitly requested "
                "human assistance."
            ),

            reason_codes=reason_codes,

            human_review_required=True,

            escalation_recommended=(
                escalation_recommended
            ),

            ticket_creation_recommended=(
                ticket_creation_recommended
            ),

            selected_intent=intent.primary_intent,

            destination="HUMAN_AGENT",

            requires_clarification=False,

        )

    # -----------------------------------------------------
    # 4. REQUIRED ENTITY VALIDATION
    # -----------------------------------------------------

    if (
        entities.requires_clarification
        or entities.missing_entities
    ):

        reason_codes.append(
            MISSING_REQUIRED_ENTITY
        )

        return HybridDecision(

            action="CLARIFY",

            confidence=confidence,

            reason=(
                "Required customer information is missing. "
                "The system should request clarification "
                "before continuing."
            ),

            reason_codes=reason_codes,

            human_review_required=(
                human_review_required
            ),

            escalation_recommended=(
                escalation_recommended
            ),

            ticket_creation_recommended=(
                ticket_creation_recommended
            ),

            selected_intent=intent.primary_intent,

            destination="CLARIFICATION_REQUIRED",

            requires_clarification=True,

        )

    # -----------------------------------------------------
    # 5. AMBIGUOUS INTENT VALIDATION
    # -----------------------------------------------------

    if (
        intent.primary_intent in {
            "AMBIGUOUS",
            "UNKNOWN",
        }
        or intent.requires_clarification
    ):

        reason_codes.append(
            AMBIGUOUS_INTENT
        )

        return HybridDecision(

            action="CLARIFY",

            confidence=confidence,

            reason=(
                "The customer's intent could not be "
                "identified reliably."
            ),

            reason_codes=reason_codes,

            human_review_required=(
                human_review_required
            ),

            escalation_recommended=(
                escalation_recommended
            ),

            ticket_creation_recommended=(
                ticket_creation_recommended
            ),

            selected_intent=intent.primary_intent,

            destination="CLARIFICATION_REQUIRED",

            requires_clarification=True,

        )

    # -----------------------------------------------------
    # 6. LOW CONFIDENCE VALIDATION
    # -----------------------------------------------------

    if confidence < MIN_DECISION_CONFIDENCE:

        reason_codes.append(
            LOW_INTENT_CONFIDENCE
        )

        return HybridDecision(

            action="CLARIFY",

            confidence=confidence,

            reason=(
                "Intent confidence is below the "
                "configured decision threshold."
            ),

            reason_codes=reason_codes,

            human_review_required=(
                human_review_required
            ),

            escalation_recommended=(
                escalation_recommended
            ),

            ticket_creation_recommended=(
                ticket_creation_recommended
            ),

            selected_intent=intent.primary_intent,

            destination="CLARIFICATION_REQUIRED",

            requires_clarification=True,

        )

    # -----------------------------------------------------
    # 7. LOW TICKET CLASSIFICATION CONFIDENCE
    # -----------------------------------------------------

    if (
        ticket_triage is not None
        and ticket_triage.confidence < MIN_DECISION_CONFIDENCE
    ):

        human_review_required = True

        reason_codes.append(
            LOW_CLASSIFICATION_CONFIDENCE
        )

        if HUMAN_REVIEW_REQUIRED not in reason_codes:

            reason_codes.append(
                HUMAN_REVIEW_REQUIRED
            )

    # -----------------------------------------------------
    # 8. SUPPORT ROUTING
    # -----------------------------------------------------

    if routing.destination == "SUPPORT_AGENT":

        reason_codes.append(
            SUPPORT_REQUEST
        )

        return HybridDecision(

            action="ROUTE_SUPPORT",

            confidence=confidence,

            reason=(
                "The request requires customer support "
                "workflow processing."
            ),

            reason_codes=reason_codes,

            human_review_required=(
                human_review_required
            ),

            escalation_recommended=(
                escalation_recommended
            ),

            ticket_creation_recommended=(
                ticket_creation_recommended
            ),

            selected_intent=intent.primary_intent,

            destination="SUPPORT_AGENT",

            requires_clarification=False,

        )

    # -----------------------------------------------------
    # 9. PRODUCT ROUTING
    # -----------------------------------------------------

    if routing.destination == "PRODUCT_AGENT":

        reason_codes.append(
            PRODUCT_REQUEST
        )

        return HybridDecision(

            action="ROUTE_PRODUCT",

            confidence=confidence,

            reason=(
                "The request requires product or "
                "commercial information."
            ),

            reason_codes=reason_codes,

            human_review_required=False,

            escalation_recommended=False,

            ticket_creation_recommended=False,

            selected_intent=intent.primary_intent,

            destination="PRODUCT_AGENT",

            requires_clarification=False,

        )

    # -----------------------------------------------------
    # 10. GENERAL AI RESPONSE
    # -----------------------------------------------------

    if routing.destination == "GENERAL_AI":

        reason_codes.append(
            GENERAL_ENQUIRY
        )

        return HybridDecision(

            action="ANSWER",

            confidence=confidence,

            reason=(
                "The request can be handled by the "
                "general AI response engine."
            ),

            reason_codes=reason_codes,

            human_review_required=False,

            escalation_recommended=False,

            ticket_creation_recommended=False,

            selected_intent=intent.primary_intent,

            destination="GENERAL_AI",

            requires_clarification=False,

        )

    # -----------------------------------------------------
    # 11. SAFE FALLBACK
    # -----------------------------------------------------

    return HybridDecision(

        action="CLARIFY",

        confidence=confidence,

        reason=(
            "No supported decision rule matched the "
            "current orchestration results."
        ),

        reason_codes=[
            *reason_codes,
            "NO_MATCHING_DECISION_RULE",
        ],

        human_review_required=True,

        escalation_recommended=(
            escalation_recommended
        ),

        ticket_creation_recommended=(
            ticket_creation_recommended
        ),

        selected_intent=intent.primary_intent,

        destination="CLARIFICATION_REQUIRED",

        requires_clarification=True,

    )