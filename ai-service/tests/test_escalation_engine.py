from datetime import datetime, timedelta, timezone

import pytest

from app.schemas.escalation import (
    EscalationEvaluationRequest,
)

from app.services.escalation_engine import (
    evaluate_escalation,
)


NOW = datetime(
    2026, 11, 26, 12, 0,
    tzinfo=timezone.utc,
)


def create_request(**overrides):

    data = {

        "ticket_id": "ticket-001",

        "status": "open",

        "priority": "P3_NORMAL",

        "severity": "MEDIUM",

        "created_at": NOW - timedelta(hours=1),

        "first_response_sla_hours": 4,

        "resolution_sla_hours": 24,

        "escalation_required": False,

        "current_escalation_level": 0,

        "now": NOW,

    }

    data.update(overrides)

    return EscalationEvaluationRequest(**data)


def test_normal_ticket_does_not_escalate():

    result = evaluate_escalation(
        create_request()
    )

    assert result.should_escalate is False

    assert result.recommended_escalation_level == 0

    assert result.escalation_target == "NONE"


def test_critical_priority_triggers_level_three():

    result = evaluate_escalation(

        create_request(
            priority="P1_CRITICAL",
            severity="CRITICAL",
        )

    )

    assert result.should_escalate is True

    assert result.recommended_escalation_level == 3

    assert (
        result.escalation_target
        == "CRITICAL_RESPONSE_TEAM"
    )


def test_high_priority_triggers_level_two():

    result = evaluate_escalation(

        create_request(
            priority="P2_HIGH",
            severity="HIGH",
        )

    )

    assert result.recommended_escalation_level == 2

    assert (
        result.escalation_target
        == "SUPPORT_MANAGER"
    )


def test_first_response_sla_warning_triggers_level_one():

    created = NOW - timedelta(hours=3, minutes=30)

    result = evaluate_escalation(

        create_request(
            created_at=created,
            first_response_sla_hours=4,
            resolution_sla_hours=24,
        )

    )

    assert result.recommended_escalation_level == 1

    assert "FIRST_RESPONSE_SLA_APPROACHING" in (
        result.reason_codes
    )


def test_first_response_sla_breach_triggers_level_two():

    created = NOW - timedelta(hours=5)

    result = evaluate_escalation(

        create_request(
            created_at=created,
            first_response_sla_hours=4,
            resolution_sla_hours=24,
        )

    )

    assert result.first_response_sla_breached is True

    assert result.recommended_escalation_level == 2

    assert "FIRST_RESPONSE_SLA_BREACHED" in (
        result.reason_codes
    )


def test_resolution_sla_breach_triggers_level_three():

    created = NOW - timedelta(hours=30)

    result = evaluate_escalation(

        create_request(
            created_at=created,
            first_response_at=created + timedelta(minutes=30),
            first_response_sla_hours=4,
            resolution_sla_hours=24,
        )

    )

    assert result.resolution_sla_breached is True

    assert result.recommended_escalation_level == 3

    assert "RESOLUTION_SLA_BREACHED" in (
        result.reason_codes
    )


def test_resolved_ticket_is_not_escalated():

    result = evaluate_escalation(

        create_request(
            status="resolved",
            priority="P1_CRITICAL",
            severity="CRITICAL",
        )

    )

    assert result.should_escalate is False

    assert result.escalation_recommended is False

    assert result.recommended_actions == []

    assert "TICKET_TERMINAL_STATE" in (
        result.reason_codes
    )


def test_closed_ticket_is_not_escalated():

    result = evaluate_escalation(

        create_request(
            status="closed",
            priority="P1_CRITICAL",
            severity="CRITICAL",
        )

    )

    assert result.should_escalate is False

    assert result.escalation_target == "NONE"


def test_first_response_sla_stops_after_agent_response():

    created = NOW - timedelta(hours=5)

    result = evaluate_escalation(

        create_request(
            created_at=created,
            first_response_at=created + timedelta(hours=1),
            first_response_sla_hours=4,
            resolution_sla_hours=24,
        )

    )

    assert result.first_response_sla_breached is False

    assert result.first_response_sla_remaining_minutes is None


def test_resolution_deadline_uses_sla_due_at():

    result = evaluate_escalation(

        create_request(
            created_at=NOW - timedelta(hours=5),
            first_response_at=NOW - timedelta(hours=4),
            sla_due_at=NOW + timedelta(hours=2),
            resolution_sla_hours=24,
        )

    )

    assert result.resolution_sla_breached is False

    assert result.resolution_sla_remaining_minutes == 120


def test_escalation_level_never_decreases():

    result = evaluate_escalation(

        create_request(
            current_escalation_level=2,
        )

    )

    assert result.recommended_escalation_level == 2

    assert result.should_escalate is False


def test_escalation_level_increases_from_existing_level():

    result = evaluate_escalation(

        create_request(
            priority="P1_CRITICAL",
            severity="CRITICAL",
            current_escalation_level=1,
        )

    )

    assert result.recommended_escalation_level == 3

    assert result.should_escalate is True


def test_existing_database_priority_values_are_supported():

    result = evaluate_escalation(

        create_request(
            priority="urgent",
            severity="critical",
        )

    )

    assert result.recommended_escalation_level == 3


def test_sla_remaining_minutes_are_calculated():

    result = evaluate_escalation(

        create_request(
            created_at=NOW - timedelta(hours=1),
            first_response_sla_hours=4,
        )

    )

    assert result.first_response_sla_remaining_minutes == 180


def test_reassignment_is_recommended_only_for_critical_escalation():

    result = evaluate_escalation(

        create_request(
            priority="P1_CRITICAL",
            severity="CRITICAL",
        )

    )

    assert result.reassignment_recommended is True


def test_normal_ticket_does_not_recommend_reassignment():

    result = evaluate_escalation(
        create_request()
    )

    assert result.reassignment_recommended is False


def test_missing_sla_deadlines_do_not_create_false_breaches():

    result = evaluate_escalation(

        create_request(
            first_response_sla_hours=None,
            resolution_sla_hours=None,
            sla_due_at=None,
        )

    )

    assert result.first_response_sla_breached is False

    assert result.resolution_sla_breached is False


def test_timezone_naive_datetime_is_rejected():

    with pytest.raises(
        ValueError,
        match="timezone",
    ):

        create_request(
            created_at=datetime(2026, 11, 26, 10, 0)
        )


def test_pending_ticket_remains_eligible_for_escalation():

    result = evaluate_escalation(

        create_request(
            status="pending",
            priority="P1_CRITICAL",
            severity="CRITICAL",
        )

    )

    assert result.recommended_escalation_level == 3


def test_notification_is_recommended_when_level_increases():

    result = evaluate_escalation(

        create_request(
            priority="P2_HIGH",
            severity="HIGH",
        )

    )

    assert result.notification_recommended is True

    assert result.should_escalate is True


def test_notification_is_not_repeated_when_level_is_unchanged():

    result = evaluate_escalation(

        create_request(
            priority="P2_HIGH",
            severity="HIGH",
            current_escalation_level=2,
        )

    )

    assert result.notification_recommended is False

    assert result.should_escalate is False