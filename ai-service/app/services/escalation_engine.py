from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schemas.escalation import (
    EscalationEvaluationRequest,
    EscalationEvaluationResult,
)


# =====================================================
# ESCALATION CONFIGURATION
# =====================================================

WARNING_THRESHOLD = 0.75

CRITICAL_ESCALATION_THRESHOLD = 3

HIGH_ESCALATION_THRESHOLD = 2

WARNING_ESCALATION_THRESHOLD = 1


# =====================================================
# PRIORITY NORMALIZATION
# =====================================================

PRIORITY_MAP = {

    "P1_CRITICAL": "P1",
    "urgent": "P1",

    "P2_HIGH": "P2",
    "high": "P2",

    "P3_NORMAL": "P3",
    "medium": "P3",

    "P4_LOW": "P4",
    "low": "P4",

}


SEVERITY_MAP = {

    "CRITICAL": "CRITICAL",
    "critical": "CRITICAL",

    "HIGH": "HIGH",
    "high": "HIGH",

    "MEDIUM": "MEDIUM",
    "medium": "MEDIUM",

    "LOW": "LOW",
    "low": "LOW",

}


# =====================================================
# ESCALATION TARGETS
# =====================================================

ESCALATION_TARGETS = {

    0: "NONE",

    1: "TEAM_SUPERVISOR",

    2: "SUPPORT_MANAGER",

    3: "CRITICAL_RESPONSE_TEAM",

}


# =====================================================
# TIME UTILITIES
# =====================================================

def _utc(value: datetime) -> datetime:

    if value.tzinfo is None or value.utcoffset() is None:

        raise ValueError(
            "Datetime must be timezone-aware."
        )

    return value.astimezone(timezone.utc)


def _remaining_minutes(
    due_at: datetime | None,
    now: datetime,
) -> int | None:

    if due_at is None:
        return None

    seconds = (
        _utc(due_at) - now
    ).total_seconds()

    # Negative values are retained to represent
    # the number of minutes overdue.

    if seconds >= 0:

        return int(
            seconds // 60
        )

    return -int(
        (-seconds) // 60
    )


def _is_breached(
    due_at: datetime | None,
    now: datetime,
) -> bool:

    if due_at is None:
        return False

    return _utc(due_at) <= now


def _calculate_warning_threshold(
    start_at: datetime,
    due_at: datetime,
) -> datetime:

    start = _utc(start_at)

    due = _utc(due_at)

    duration = due - start

    return start + (
        duration * WARNING_THRESHOLD
    )


# =====================================================
# SLA DEADLINE RESOLUTION
# =====================================================

def _resolve_first_response_deadline(
    request: EscalationEvaluationRequest,
) -> datetime | None:

    if request.first_response_at is not None:

        return None

    if request.first_response_sla_hours is None:

        return None

    return (
        _utc(request.created_at)
        + timedelta(
            hours=request.first_response_sla_hours
        )
    )


def _resolve_resolution_deadline(
    request: EscalationEvaluationRequest,
) -> datetime | None:

    if request.sla_due_at is not None:

        return _utc(request.sla_due_at)

    if request.resolution_sla_hours is None:

        return None

    return (
        _utc(request.created_at)
        + timedelta(
            hours=request.resolution_sla_hours
        )
    )


# =====================================================
# ESCALATION LEVEL DETERMINATION
# =====================================================

def _determine_priority_level(
    priority: str,
    severity: str,
    escalation_required: bool,
) -> tuple[int, list[str]]:

    level = 0

    reasons = []

    normalized_priority = PRIORITY_MAP[priority]

    normalized_severity = SEVERITY_MAP[severity]

    if normalized_priority == "P1":

        level = 3

        reasons.append(
            "CRITICAL_PRIORITY"
        )

    elif normalized_priority == "P2":

        level = 2

        reasons.append(
            "HIGH_PRIORITY"
        )

    if normalized_severity == "CRITICAL":

        level = max(
            level,
            3,
        )

        reasons.append(
            "CRITICAL_SEVERITY"
        )

    elif normalized_severity == "HIGH":

        level = max(
            level,
            2,
        )

        reasons.append(
            "HIGH_SEVERITY"
        )

    if escalation_required:

        reasons.append(
            "PRIORITY_ENGINE_ESCALATION_FLAG"
        )

    return level, reasons


# =====================================================
# ACTION GENERATION
# =====================================================

def _recommended_actions(
    *,
    level: int,
    first_response_breached: bool,
    resolution_breached: bool,
    warning_triggered: bool,
) -> list[str]:

    actions = []

    if warning_triggered:

        actions.append(
            "MONITOR_SLA"
        )

    if level >= 1:

        actions.append(
            "NOTIFY_TEAM_SUPERVISOR"
        )

    if level >= 2:

        actions.append(
            "NOTIFY_SUPPORT_MANAGER"
        )

    if level >= 3:

        actions.append(
            "NOTIFY_CRITICAL_RESPONSE_TEAM"
        )

    if first_response_breached:

        actions.append(
            "PRIORITIZE_FIRST_RESPONSE"
        )

    if resolution_breached:

        actions.append(
            "PRIORITIZE_RESOLUTION"
        )

    if level >= 2:

        actions.append(
            "REVIEW_AGENT_WORKLOAD"
        )

    if level >= 3:

        actions.append(
            "REVIEW_AGENT_REASSIGNMENT"
        )

    return list(
        dict.fromkeys(actions)
    )


# =====================================================
# MAIN ESCALATION ENGINE
# =====================================================

def evaluate_escalation(
    request: EscalationEvaluationRequest,
) -> EscalationEvaluationResult:

    """
    Evaluate ticket escalation requirements.

    This service:

    1. Evaluates ticket lifecycle status.
    2. Normalizes ticket priority and severity.
    3. Calculates first-response SLA.
    4. Calculates resolution SLA.
    5. Detects approaching SLA deadlines.
    6. Detects breached SLA deadlines.
    7. Determines escalation level.
    8. Generates recommended actions.
    9. Preserves escalation-level monotonicity.

    It does not modify the database or execute
    notifications, reassignment, or other actions.
    """

    # -------------------------------------------------
    # 1. CURRENT TIME
    # -------------------------------------------------

    now = _utc(
        request.now or datetime.now(timezone.utc)
    )

    # -------------------------------------------------
    # 2. TERMINAL TICKET STATES
    # -------------------------------------------------

    if request.status in {
        "resolved",
        "closed",
    }:

        return EscalationEvaluationResult(

            ticket_id=request.ticket_id,

            escalation_required=False,

            escalation_recommended=False,

            should_escalate=False,

            current_escalation_level=(
                request.current_escalation_level
            ),

            recommended_escalation_level=(
                request.current_escalation_level
            ),

            escalation_target="NONE",

            escalation_reason=(
                "Resolved or closed tickets are not escalated."
            ),

            reason_codes=[
                "TICKET_TERMINAL_STATE"
            ],

            first_response_sla_breached=False,

            resolution_sla_breached=False,

            first_response_sla_remaining_minutes=None,

            resolution_sla_remaining_minutes=None,

            recommended_actions=[],

            notification_recommended=False,

            reassignment_recommended=False,

            evaluation_timestamp=now,

        )

    # -------------------------------------------------
    # 3. SLA DEADLINES
    # -------------------------------------------------

    first_response_deadline = (
        _resolve_first_response_deadline(
            request
        )
    )

    resolution_deadline = (
        _resolve_resolution_deadline(
            request
        )
    )

    first_response_remaining = (
        _remaining_minutes(
            first_response_deadline,
            now,
        )
    )

    resolution_remaining = (
        _remaining_minutes(
            resolution_deadline,
            now,
        )
    )

    # -------------------------------------------------
    # 4. SLA BREACH DETECTION
    # -------------------------------------------------

    first_response_breached = (
        _is_breached(
            first_response_deadline,
            now,
        )
    )

    resolution_breached = (
        _is_breached(
            resolution_deadline,
            now,
        )
    )

    # -------------------------------------------------
    # 5. SLA WARNING DETECTION
    # -------------------------------------------------

    warning_triggered = False

    reason_codes = []

    if (
        first_response_deadline is not None
        and request.first_response_sla_hours is not None
    ):

        warning_at = _calculate_warning_threshold(

            request.created_at,

            first_response_deadline,

        )

        if (
            now >= warning_at
            and not first_response_breached
        ):

            warning_triggered = True

            reason_codes.append(
                "FIRST_RESPONSE_SLA_APPROACHING"
            )

    if (
        resolution_deadline is not None
        and request.resolution_sla_hours is not None
    ):

        warning_at = _calculate_warning_threshold(

            request.created_at,

            resolution_deadline,

        )

        if (
            now >= warning_at
            and not resolution_breached
        ):

            warning_triggered = True

            reason_codes.append(
                "RESOLUTION_SLA_APPROACHING"
            )

    # -------------------------------------------------
    # 6. SLA BREACH REASONS
    # -------------------------------------------------

    if first_response_breached:

        reason_codes.append(
            "FIRST_RESPONSE_SLA_BREACHED"
        )

    if resolution_breached:

        reason_codes.append(
            "RESOLUTION_SLA_BREACHED"
        )

    # -------------------------------------------------
    # 7. PRIORITY ESCALATION
    # -------------------------------------------------

    priority_level, priority_reasons = (
        _determine_priority_level(

            priority=request.priority,

            severity=request.severity,

            escalation_required=(
                request.escalation_required
            ),

        )
    )

    reason_codes.extend(
        priority_reasons
    )

    # -------------------------------------------------
    # 8. SLA-BASED ESCALATION
    # -------------------------------------------------

    sla_level = 0

    if warning_triggered:

        sla_level = max(
            sla_level,
            1,
        )

    if first_response_breached:

        sla_level = max(
            sla_level,
            2,
        )

    if resolution_breached:

        sla_level = max(
            sla_level,
            3,
        )

    # -------------------------------------------------
    # 9. FINAL ESCALATION LEVEL
    # -------------------------------------------------

    calculated_level = max(
        priority_level,
        sla_level,
        request.current_escalation_level,
    )

    calculated_level = min(
        calculated_level,
        CRITICAL_ESCALATION_THRESHOLD,
    )

    # -------------------------------------------------
    # 10. ESCALATION STATUS
    # -------------------------------------------------

    should_escalate = (
        calculated_level
        > request.current_escalation_level
    )

    escalation_recommended = (
        calculated_level > 0
    )

    escalation_required = (
        escalation_recommended
    )

    # -------------------------------------------------
    # 11. ACTION RECOMMENDATIONS
    # -------------------------------------------------

    actions = _recommended_actions(

        level=calculated_level,

        first_response_breached=(
            first_response_breached
        ),

        resolution_breached=(
            resolution_breached
        ),

        warning_triggered=(
            warning_triggered
        ),

    )

    # -------------------------------------------------
    # 12. REASON GENERATION
    # -------------------------------------------------

    if resolution_breached:

        reason = (
            "Resolution SLA has been breached. "
            "Critical escalation is recommended."
        )

    elif first_response_breached:

        reason = (
            "First-response SLA has been breached. "
            "Management escalation is recommended."
        )

    elif calculated_level == 3:

        reason = (
            "Critical priority or severity requires "
            "immediate critical escalation."
        )

    elif calculated_level == 2:

        reason = (
            "High-priority ticket requires management attention."
        )

    elif calculated_level == 1:

        reason = (
            "An SLA deadline is approaching. "
            "Supervisor monitoring is recommended."
        )

    else:

        reason = (
            "No escalation condition has been triggered."
        )

    # -------------------------------------------------
    # 13. FINAL RESULT
    # -------------------------------------------------

    return EscalationEvaluationResult(

        ticket_id=request.ticket_id,

        escalation_required=escalation_required,

        escalation_recommended=escalation_recommended,

        should_escalate=should_escalate,

        current_escalation_level=(
            request.current_escalation_level
        ),

        recommended_escalation_level=(
            calculated_level
        ),

        escalation_target=(
            ESCALATION_TARGETS[calculated_level]
        ),

        escalation_reason=reason,

        reason_codes=list(
            dict.fromkeys(reason_codes)
        ),

        first_response_sla_breached=(
            first_response_breached
        ),

        resolution_sla_breached=(
            resolution_breached
        ),

        first_response_sla_remaining_minutes=(
            first_response_remaining
        ),

        resolution_sla_remaining_minutes=(
            resolution_remaining
        ),

        recommended_actions=actions,

        notification_recommended=(
            should_escalate
        ),

        reassignment_recommended=(
            should_escalate
            and calculated_level >= 3
        ),

        evaluation_timestamp=now,

    )