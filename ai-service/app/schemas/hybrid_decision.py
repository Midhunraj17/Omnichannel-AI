from typing import Literal

from pydantic import BaseModel, Field


DecisionAction = Literal[
    "ANSWER",
    "CLARIFY",
    "HANDOFF",
    "ROUTE_SUPPORT",
    "ROUTE_PRODUCT",
]


class HybridDecision(BaseModel):
    """Final decision produced by the hybrid decision engine."""

    action: DecisionAction

    confidence: float = Field(
        ge=0.0,
        le=1.0,
    )

    reason: str = Field(
        min_length=1,
        max_length=500,
    )

    reason_codes: list[str] = Field(
        default_factory=list,
        max_length=30,
    )

    human_review_required: bool = False

    escalation_recommended: bool = False

    ticket_creation_recommended: bool = False

    selected_intent: str

    destination: str

    requires_clarification: bool = False