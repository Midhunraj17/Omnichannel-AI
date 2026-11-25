from app.schemas.intent import IntentClassificationResponse
from app.schemas.routing import RoutingResponse

# Conservative threshold: low-confidence intent predictions should not be
# routed into a business workflow without clarification.
MIN_ROUTING_CONFIDENCE = 0.60

_HANDOFF_INTENTS = {"HUMAN_HANDOFF"}

_PRODUCT_INTENTS = {
    "PRODUCT_ENQUIRY",
    "PRICING_ENQUIRY",
    "PRODUCT_COMPARISON",
    "AVAILABILITY_CHECK",
    "FEATURE_ENQUIRY",
    "PURCHASE_INTENT",
    # A service enquiry is a commercial enquiry about the business's offering.
    "SERVICE_ENQUIRY",
}

_SUPPORT_INTENTS = {
    "ORDER_TRACKING",
    "ORDER_STATUS",
    "PAYMENT_ISSUE",
    "PAYMENT_STATUS",
    "CANCELLATION_REQUEST",
    "ACCOUNT_ACCESS_ISSUE",
    "PASSWORD_RESET",
    "TECHNICAL_ISSUE",
    "PRODUCT_ISSUE",
    "SERVICE_ISSUE",
    "COMPLAINT",
    "TICKET_CREATE",
    "TICKET_STATUS",
    "RETURN_REQUEST",
    "REFUND_REQUEST",
    "TICKET_UPDATE",
    "FEEDBACK",
}

_GENERAL_INTENTS = {
    "GREETING",
    "GOODBYE",
    "THANKS",
    "GENERAL_QUESTION",
    "OUT_OF_SCOPE",
}

# When a message contains multiple actionable intents, prioritize an existing
# support issue over a commercial/product enquiry, then general conversation.
_DESTINATION_PRIORITY = {
    "SUPPORT_AGENT": 0,
    "PRODUCT_AGENT": 1,
    "GENERAL_AI": 2,
}


def _destination_for_intent(intent_name: str) -> str | None:
    if intent_name in _PRODUCT_INTENTS:
        return "PRODUCT_AGENT"
    if intent_name in _SUPPORT_INTENTS:
        return "SUPPORT_AGENT"
    if intent_name in _GENERAL_INTENTS:
        return "GENERAL_AI"
    return None


def decide_route(
    classification: IntentClassificationResponse,
) -> RoutingResponse:
    """Return a deterministic destination; this function never calls an LLM."""
    intent_names = [item.name for item in classification.intents]
    matched = list(dict.fromkeys(intent_names))
    handoff = (
        classification.handoff_requested
        or classification.primary_intent in _HANDOFF_INTENTS
        or any(name in _HANDOFF_INTENTS for name in intent_names)
    )

    if handoff:
        return RoutingResponse(
            destination="HUMAN_AGENT",
            confidence=1.0,
            matched_intents=matched,
            reason="A human handoff was explicitly requested.",
            handoff_requested=True,
        )

    if (
        classification.requires_clarification
        or classification.primary_intent in {"AMBIGUOUS", "UNKNOWN"}
    ):
        return RoutingResponse(
            destination="CLARIFICATION_REQUIRED",
            confidence=classification.confidence,
            matched_intents=matched,
            reason="The intent is ambiguous or unsupported; clarification is required.",
            requires_clarification=True,
        )

    candidates: list[tuple[int, str, float, str]] = []
    confidence_by_name = {item.name: item.confidence for item in classification.intents}

    for name in matched:
        destination = _destination_for_intent(name)
        if destination is None:
            continue
        priority = _DESTINATION_PRIORITY[destination]
        candidates.append((priority, destination, confidence_by_name[name], name))

    if not candidates:
        return RoutingResponse(
            destination="CLARIFICATION_REQUIRED",
            confidence=classification.confidence,
            matched_intents=matched,
            reason="No routing rule matches the classified intent.",
            requires_clarification=True,
        )

    candidates.sort(key=lambda item: (item[0], -item[2]))
    _, destination, selected_confidence, selected_intent = candidates[0]

    if selected_confidence < MIN_ROUTING_CONFIDENCE:
        return RoutingResponse(
            destination="CLARIFICATION_REQUIRED",
            confidence=selected_confidence,
            matched_intents=matched,
            reason=(
                f"Confidence for {selected_intent} is below the "
                f"{MIN_ROUTING_CONFIDENCE:.2f} routing threshold."
            ),
            requires_clarification=True,
        )

    return RoutingResponse(
        destination=destination,
        confidence=selected_confidence,
        matched_intents=matched,
        reason=f"Routed to {destination} based on intent {selected_intent}.",
    )
