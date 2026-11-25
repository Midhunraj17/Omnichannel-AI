from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.intent import IntentClassificationResponse, IntentName

RoutingDestination = Literal[
    "PRODUCT_AGENT",
    "SUPPORT_AGENT",
    "GENERAL_AI",
    "HUMAN_AGENT",
    "CLARIFICATION_REQUIRED",
]


class RoutingRequest(BaseModel):
    """Routing input produced by the Intent Classification Engine."""
    classification: IntentClassificationResponse


class RoutingResponse(BaseModel):
    success: bool = True
    destination: RoutingDestination
    confidence: float = Field(ge=0.0, le=1.0)
    matched_intents: list[IntentName] = Field(default_factory=list)
    reason: str = Field(min_length=1, max_length=300)
    requires_clarification: bool = False
    handoff_requested: bool = False
