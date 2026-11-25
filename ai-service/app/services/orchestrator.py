"""Controlled orchestration across the existing AI engines.

This service makes routing and response-generation decisions only. It does
not execute business operations or assign tickets/agents.
"""
import logging
logger = logging.getLogger(__name__)


from app.schemas.context import ContextMessage
from app.schemas.entities import (
    EntityExtractionContext,
    EntityExtractionRequest,
    EntityExtractionResponse,
)
from app.schemas.intent import (
    IntentClassificationRequest,
    IntentClassificationResponse,
    IntentContext,
)
from app.schemas.orchestration import OrchestrationRequest, OrchestrationResponse
from app.schemas.response_generation import ResponseGenerationRequest
from app.schemas.routing import RoutingResponse
from app.services.context_manager import build_conversation_context
from app.services.entity_service import extract_entities
from app.services.intent_service import classify_intent
from app.services.response_generation import generate_customer_response
from app.services.routing_engine import decide_route


def _clarification_message(missing_entities: list[str]) -> str:
    if not missing_entities:
        return "Could you clarify what you need help with?"
    readable = ", ".join(item.replace("_", " ").lower() for item in missing_entities)
    return f"To help you accurately, could you provide: {readable}?"


def orchestrate(request: OrchestrationRequest) -> OrchestrationResponse:
    """Run context -> intent -> entities -> routing -> permitted response."""

    context = build_conversation_context(
        current_message=request.message,
        history=[item.model_dump() for item in request.history],
    )

    # Adapt the Context Manager's role/content representation to the
    # context contracts expected by the intent and entity engines.
    recent_messages = [item.content for item in context.messages[-10:]]
    intent_request = IntentClassificationRequest(
        message=request.message,
        context=IntentContext(
            previous_intent=None,
            conversation_summary=request.conversation_summary,
            recent_messages=recent_messages,
        ),
    )
    intent_result = IntentClassificationResponse.model_validate(
        {"success": True, **classify_intent(intent_request)}
    )

    entity_request = EntityExtractionRequest(
        message=request.message,
        domain=request.domain,
        required_entities=request.required_entities,
        context=EntityExtractionContext(
            conversation_summary=request.conversation_summary,
            recent_messages=recent_messages,
        ),
    )
    entity_result = EntityExtractionResponse.model_validate(
        {"success": True, **extract_entities(entity_request)}
    )

    routing_result = decide_route(intent_result)

    # Missing required entities should trigger clarification unless an
    # explicit human handoff has already taken priority.
    if entity_result.requires_clarification and not routing_result.handoff_requested:
        routing_result = RoutingResponse.model_validate({
            **routing_result.model_dump(),
            "destination": "CLARIFICATION_REQUIRED",
            "requires_clarification": True,
            "reason": "Required information is missing from the customer message.",
        })

    destination = routing_result.destination

    common = {
        "destination": destination,
        "intent": intent_result,
        "entities": entity_result,
        "routing": routing_result,
        "context_history_messages_included": context.history_messages_included,
        "context_total_messages": context.total_messages,
        "context_total_characters": context.total_characters,
        "context_truncated": context.truncated,
    }

    if destination == "HUMAN_AGENT":
        return OrchestrationResponse(
            status="handoff_required",
            response=None,
            **common,
        )

    if destination in {"PRODUCT_AGENT", "SUPPORT_AGENT"}:
        return OrchestrationResponse(
            status="agent_routing_required",
            response=None,
            **common,
        )

    if destination == "CLARIFICATION_REQUIRED":
        return OrchestrationResponse(
            status="clarification_required",
            response=_clarification_message(entity_result.missing_entities),
            **common,
        )

    # Only GENERAL_AI reaches Cohere response generation. Business-specific
    # requests must be handled by authorized product/support backend services.
    history_for_response = [
    {"role": item.role, "content": item.content}
    for item in context.messages[:-1]
    if item.role in {"user", "assistant"}
]

    response_request = ResponseGenerationRequest(
    message=request.message,
    history=history_for_response,
    domain=request.domain,
    conversation_summary=request.conversation_summary,
    )

    try:
        generated = generate_customer_response(response_request)

    except Exception as error:
        logger.exception(
            "Response generation failed: %s",
            type(error).__name__,
        )

        return OrchestrationResponse(
            success=False,
            status="generation_failed",
            response=(
                "I'm temporarily unable to generate a response. "
                "Please try again in a moment or request assistance "
                "from our support team."
            ),
            model=None,
            finish_reason="error",
            usage=None,
            **common,
        )

    return OrchestrationResponse(
        status="response_generated",
        response=generated.response,
        model=generated.model,
        finish_reason=generated.finish_reason,
        usage=generated.usage,
        **common,
    )