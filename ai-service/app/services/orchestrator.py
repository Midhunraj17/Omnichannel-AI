"""Controlled orchestration with hybrid and contextual AI resolution."""

import logging

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

from app.schemas.orchestration import (
    OrchestrationRequest,
    OrchestrationResponse,
)

from app.schemas.response_generation import (
    ResponseGenerationRequest,
)

from app.schemas.routing import RoutingResponse

from app.services.context_manager import (
    build_conversation_context,
)

from app.services.entity_service import (
    extract_entities,
)

from app.services.intent_service import (
    classify_intent,
)

from app.services.response_generation import (
    generate_customer_response,
)

from app.services.routing_engine import (
    decide_route,
)

from app.services.ticket_triage import (
    triage_ticket,
)

from app.services.hybrid_decision_engine import (
    decide_hybrid_action,
)

from app.services.contextual_resolution import (
    resolve_context,
)


logger = logging.getLogger(__name__)


def _clarification_message(
    missing_entities: list[str],
) -> str:

    if not missing_entities:

        return (
            "Could you clarify what you need help with?"
        )

    readable = ", ".join(
        item.replace("_", " ").lower()
        for item in missing_entities
    )

    return (
        f"To help you accurately, "
        f"could you provide: {readable}?"
    )


def orchestrate(
    request: OrchestrationRequest,
) -> OrchestrationResponse:

    """Execute the hybrid AI and contextual resolution pipeline."""

    # -----------------------------------------------------
    # 1. CONVERSATION CONTEXT
    # -----------------------------------------------------

    context = build_conversation_context(

        current_message=request.message,

        history=[
            item.model_dump()
            for item in request.history
        ],

    )

    recent_messages = [
        item.content
        for item in context.messages[-10:]
    ]

    # -----------------------------------------------------
    # 2. INTENT CLASSIFICATION
    # -----------------------------------------------------

    intent_request = IntentClassificationRequest(

        message=request.message,

        context=IntentContext(

            previous_intent=None,

            conversation_summary=(
                request.conversation_summary
            ),

            recent_messages=recent_messages,

        ),

    )

    intent_result = IntentClassificationResponse.model_validate({

        "success": True,

        **classify_intent(intent_request),

    })

    # -----------------------------------------------------
    # 3. ENTITY EXTRACTION
    # -----------------------------------------------------

    entity_request = EntityExtractionRequest(

        message=request.message,

        domain=request.domain,

        required_entities=request.required_entities,

        context=EntityExtractionContext(

            conversation_summary=(
                request.conversation_summary
            ),

            recent_messages=recent_messages,

        ),

    )

    entity_result = EntityExtractionResponse.model_validate({

        "success": True,

        **extract_entities(entity_request),

    })

    # -----------------------------------------------------
    # 4. INITIAL ROUTING
    # -----------------------------------------------------

    routing_result = decide_route(
        intent_result
    )

    # -----------------------------------------------------
    # 5. TICKET TRIAGE
    # -----------------------------------------------------

    triage_result = triage_ticket(

        primary_intent=(
            intent_result.primary_intent
        ),

        intents=[
            item.name
            for item in intent_result.intents
        ],

        message=request.message,

        intent_confidence=(
            intent_result.confidence
        ),

        intent_method=(
            intent_result.classification_method
        ),

    )

    # -----------------------------------------------------
    # 6. HYBRID DECISION ENGINE
    # -----------------------------------------------------

    decision = decide_hybrid_action(

        intent=intent_result,

        entities=entity_result,

        routing=routing_result,

        ticket_triage=triage_result,

    )

    # -----------------------------------------------------
    # 7. CONTEXTUAL RESOLUTION ENGINE
    # -----------------------------------------------------

    contextual_result = resolve_context(

        current_message=request.message,

        history=context.messages[:-1],

        conversation_summary=request.conversation_summary,

        intent_result=intent_result,

        entity_result=entity_result,

    )

    # -----------------------------------------------------
    # 8. APPLY FINAL DECISION
    # -----------------------------------------------------

    destination = decision.destination

    if routing_result.destination != destination:

        routing_result = RoutingResponse.model_validate({

            **routing_result.model_dump(),

            "destination": destination,

            "requires_clarification": (
                decision.requires_clarification
            ),

            "handoff_requested": (
                decision.action == "HANDOFF"
            ),

            "confidence": decision.confidence,

            "reason": decision.reason[:300],

        })

    # -----------------------------------------------------
    # 9. COMMON RESPONSE METADATA
    # -----------------------------------------------------

    common = {

        "destination": destination,

        "intent": intent_result,

        "entities": entity_result,

        "routing": routing_result,

        "ticket_triage": triage_result,

        "hybrid_decision": decision,

        "contextual_resolution": contextual_result,

        "context_history_messages_included": (
            context.history_messages_included
        ),

        "context_total_messages": (
            context.total_messages
        ),

        "context_total_characters": (
            context.total_characters
        ),

        "context_truncated": (
            context.truncated
        ),

    }

    # -----------------------------------------------------
    # 10. HUMAN HANDOFF
    # -----------------------------------------------------

    if decision.action == "HANDOFF":

        return OrchestrationResponse(

            status="handoff_required",

            response=None,

            **common,

        )

    # -----------------------------------------------------
    # 11. SUPPORT / PRODUCT ROUTING
    # -----------------------------------------------------

    if decision.action in {
        "ROUTE_SUPPORT",
        "ROUTE_PRODUCT",
    }:

        return OrchestrationResponse(

            status="agent_routing_required",

            response=None,

            **common,

        )

    # -----------------------------------------------------
    # 12. CLARIFICATION
    # -----------------------------------------------------

    if decision.action == "CLARIFY":

        return OrchestrationResponse(

            status="clarification_required",

            response=_clarification_message(
                entity_result.missing_entities
            ),

            **common,

        )

    # -----------------------------------------------------
    # 13. RESPONSE GENERATION
    # -----------------------------------------------------

    history_for_response = [

        {

            "role": item.role,

            "content": item.content,

        }

        for item in context.messages[:-1]

        if item.role in {
            "user",
            "assistant",
        }

    ]

    response_request = ResponseGenerationRequest(

        message=request.message,

        history=history_for_response,

        domain=request.domain,

        conversation_summary=(
            request.conversation_summary
        ),

        contextual_context=(
            contextual_result.contextual_context
        ),

        # PHASE 5.9 — RAG CONTEXT FORWARDING

        knowledge_base_enabled=(
            request.knowledge_base_enabled
        ),

        knowledge_context=(
            request.knowledge_context
        ),

    )

    try:

        generated = generate_customer_response(
            response_request
        )

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

    # -----------------------------------------------------
    # 14. FINAL RESPONSE
    # -----------------------------------------------------

    return OrchestrationResponse(

        status="response_generated",

        response=generated.response,

        model=generated.model,

        finish_reason=generated.finish_reason,

        usage=generated.usage,

        **common,

    )