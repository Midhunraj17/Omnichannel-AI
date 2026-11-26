from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.entities import (
    EntityDomain,
    EntityExtractionResponse,
)

from app.schemas.intent import (
    IntentClassificationResponse,
)

from app.schemas.routing import (
    RoutingDestination,
    RoutingResponse,
)

from app.schemas.ticket_triage import (
    TicketTriageResult,
)

from app.schemas.hybrid_decision import (
    HybridDecision,
)


class OrchestrationHistoryMessage(BaseModel):

    """A prior message supplied by the authenticated backend."""

    sender_type: Literal[
        "customer",
        "bot",
        "agent",
        "system",
    ]

    content: str = Field(
        min_length=1,
        max_length=10000,
    )

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(
        cls,
        value: str,
    ) -> str:

        value = value.strip()

        if not value:
            raise ValueError(
                "History message content must not be blank"
            )

        return value


class OrchestrationRequest(BaseModel):

    """Validated input for the AI orchestration pipeline."""

    message: str = Field(
        min_length=1,
        max_length=10000,
    )

    history: list[OrchestrationHistoryMessage] = Field(
        default_factory=list,
        max_length=100,
    )

    domain: EntityDomain = "general"

    required_entities: list[str] = Field(
        default_factory=list,
        max_length=30,
    )

    conversation_summary: str | None = Field(
        default=None,
        max_length=3000,
    )

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(
        cls,
        value: str,
    ) -> str:

        value = value.strip()

        if not value:
            raise ValueError(
                "message must not be blank"
            )

        return value

    @field_validator("required_entities")
    @classmethod
    def normalize_required_entities(
        cls,
        values: list[str],
    ) -> list[str]:

        return list(
            dict.fromkeys(
                value.strip().upper()
                for value in values
                if value.strip()
            )
        )


class OrchestrationResponse(BaseModel):

    success: bool = True

    status: Literal[
        "response_generated",
        "clarification_required",
        "handoff_required",
        "agent_routing_required",
        "generation_failed",
    ]

    destination: RoutingDestination

    intent: IntentClassificationResponse

    entities: EntityExtractionResponse

    routing: RoutingResponse

    ticket_triage: TicketTriageResult | None = None

    hybrid_decision: HybridDecision

    response: str | None = None

    model: str | None = None

    finish_reason: str | None = None

    usage: dict | None = None

    context_history_messages_included: int

    context_total_messages: int

    context_total_characters: int

    context_truncated: bool