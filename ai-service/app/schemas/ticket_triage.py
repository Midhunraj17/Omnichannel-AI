from typing import Literal

from pydantic import BaseModel, Field


TicketCategory = Literal[
    "ORDER",
    "PAYMENT",
    "REFUND",
    "RETURN",
    "ACCOUNT",
    "TECHNICAL",
    "PRODUCT",
    "SERVICE",
    "COMPLAINT",
    "OTHER",
]


TicketPriority = Literal[
    "P1_CRITICAL",
    "P2_HIGH",
    "P3_NORMAL",
    "P4_LOW",
]


TicketSentiment = Literal[
    "NEGATIVE",
    "NEUTRAL",
    "POSITIVE",
]


TicketSeverity = Literal[
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
]


ClassificationMethod = Literal[
    "rules",
    "hybrid",
]


class TicketIssueClassification(BaseModel):

    category: TicketCategory

    subcategory: str = Field(
        min_length=1,
        max_length=80
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0
    )

    labels: list[str] = Field(
        default_factory=list,
        max_length=20
    )


class TicketTriageResult(BaseModel):
    """
    Classification and priority assessment.

    This model describes the assessment only.
    It does not execute ticket assignment or escalation.
    """

    applicable: bool = True

    category: TicketCategory

    subcategory: str = Field(
        min_length=1,
        max_length=80
    )

    priority: TicketPriority

    priority_score: int = Field(
        ge=0,
        le=100
    )

    severity: TicketSeverity

    impact_level: int = Field(
        ge=1,
        le=5
    )

    urgency_level: int = Field(
        ge=1,
        le=5
    )

    sentiment: TicketSentiment

    urgency_signals: list[str] = Field(
        default_factory=list
    )

    priority_reason_codes: list[str] = Field(
        default_factory=list,
        max_length=30
    )

    reason: str = Field(
        min_length=1,
        max_length=500
    )

    classification_method: ClassificationMethod = "rules"

    confidence: float = Field(
        ge=0.0,
        le=1.0
    )

    labels: list[str] = Field(
        default_factory=list,
        max_length=20
    )

    issues: list[TicketIssueClassification] = Field(
        default_factory=list,
        max_length=10
    )

    requires_human_review: bool = False

    escalation_required: bool = False

    first_response_sla_hours: int = Field(
        ge=1,
        le=720
    )

    resolution_sla_hours: int = Field(
        ge=1,
        le=720
    )

    suggested_sla_hours: int = Field(
        ge=1,
        le=720
    )