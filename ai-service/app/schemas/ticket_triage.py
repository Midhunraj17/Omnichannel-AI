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
    Classification and triage metadata.

    This schema does not execute business operations,
    create tickets, or assign support agents.
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

    severity: Literal[
        "CRITICAL",
        "HIGH",
        "MEDIUM",
        "LOW"
    ]

    sentiment: TicketSentiment

    urgency_signals: list[str] = Field(
        default_factory=list
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

    suggested_sla_hours: int = Field(
        ge=1,
        le=720
    )