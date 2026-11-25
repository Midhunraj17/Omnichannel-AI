from typing import Literal

from pydantic import BaseModel, Field

TicketCategory = Literal[
    "ORDER", "PAYMENT", "REFUND", "RETURN", "ACCOUNT",
    "TECHNICAL", "PRODUCT", "SERVICE", "COMPLAINT", "OTHER"
]
TicketPriority = Literal["P1_CRITICAL", "P2_HIGH", "P3_NORMAL", "P4_LOW"]
TicketSentiment = Literal["NEGATIVE", "NEUTRAL", "POSITIVE"]


class TicketTriageResult(BaseModel):
    """Deterministic triage metadata; it does not create or assign a ticket."""
    applicable: bool = True
    category: TicketCategory
    priority: TicketPriority
    priority_score: int = Field(ge=0, le=100)
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    sentiment: TicketSentiment
    urgency_signals: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=1, max_length=500)
    classification_method: Literal["rules"] = "rules"
    suggested_sla_hours: int = Field(ge=1, le=720)
