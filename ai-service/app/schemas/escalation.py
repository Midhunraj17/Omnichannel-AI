from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


TicketStatus = Literal[
    "open",
    "in_progress",
    "pending",
    "resolved",
    "closed",
]

EscalationPriority = Literal[
    "P1_CRITICAL",
    "P2_HIGH",
    "P3_NORMAL",
    "P4_LOW",
    "urgent",
    "high",
    "medium",
    "low",
]

EscalationSeverity = Literal[
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
    "critical",
    "high",
    "medium",
    "low",
]


class EscalationEvaluationRequest(BaseModel):

    model_config = ConfigDict(
        extra="forbid",
    )

    ticket_id: str = Field(
        min_length=1,
        max_length=100,
    )

    status: TicketStatus

    priority: EscalationPriority

    severity: EscalationSeverity

    created_at: datetime

    first_response_at: datetime | None = None

    sla_due_at: datetime | None = None

    first_response_sla_hours: int | None = Field(
        default=None,
        ge=1,
        le=720,
    )

    resolution_sla_hours: int | None = Field(
        default=None,
        ge=1,
        le=720,
    )

    escalation_required: bool = False

    current_escalation_level: int = Field(
        default=0,
        ge=0,
        le=3,
    )

    now: datetime | None = None

    @field_validator(
        "created_at",
        "first_response_at",
        "sla_due_at",
        "now",
    )
    @classmethod
    def validate_timezone(
        cls,
        value: datetime | None,
    ) -> datetime | None:

        if value is None:
            return None

        if value.tzinfo is None or value.utcoffset() is None:

            raise ValueError(
                "Datetime values must include timezone information."
            )

        return value


class EscalationEvaluationResult(BaseModel):

    success: bool = True

    ticket_id: str

    escalation_required: bool

    escalation_recommended: bool

    should_escalate: bool

    current_escalation_level: int

    recommended_escalation_level: int

    escalation_target: Literal[
        "NONE",
        "TEAM_SUPERVISOR",
        "SUPPORT_MANAGER",
        "CRITICAL_RESPONSE_TEAM",
    ]

    escalation_reason: str

    reason_codes: list[str] = Field(
        default_factory=list,
        max_length=30,
    )

    first_response_sla_breached: bool

    resolution_sla_breached: bool

    first_response_sla_remaining_minutes: int | None

    resolution_sla_remaining_minutes: int | None

    recommended_actions: list[str] = Field(
        default_factory=list,
        max_length=20,
    )

    notification_recommended: bool = False

    reassignment_recommended: bool = False

    evaluation_timestamp: datetime