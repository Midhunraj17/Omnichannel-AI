import pytest

from app.services.ticket_priority import (
    assess_ticket_priority,
    calculate_priority,
    determine_priority,
    determine_severity,
)


def test_priority_score_formula():

    assert calculate_priority(3, 3) == 46

    assert calculate_priority(4, 4) == 74

    assert calculate_priority(5, 5) == 100


def test_priority_score_rejects_invalid_impact():

    with pytest.raises(ValueError):
        calculate_priority(0, 3)


def test_priority_score_rejects_invalid_urgency():

    with pytest.raises(ValueError):
        calculate_priority(3, 6)


def test_priority_thresholds():

    assert determine_priority(90) == "P1_CRITICAL"

    assert determine_priority(60) == "P2_HIGH"

    assert determine_priority(45) == "P3_NORMAL"

    assert determine_priority(20) == "P4_LOW"


def test_severity_thresholds():

    assert determine_severity(5) == "CRITICAL"

    assert determine_severity(4) == "HIGH"

    assert determine_severity(3) == "MEDIUM"

    assert determine_severity(1) == "LOW"


def test_security_incident_escalates():

    result = assess_ticket_priority(
        message=(
            "My account was hacked. "
            "There is unauthorized access immediately."
        ),
        category="ACCOUNT",
    )

    assert result.impact_level == 5

    assert result.urgency_level == 5

    assert result.priority == "P1_CRITICAL"

    assert result.severity == "CRITICAL"

    assert result.escalation_required is True


def test_normal_order_request():

    result = assess_ticket_priority(
        message="Can you tell me my order status?",
        category="ORDER",
    )

    assert result.priority == "P3_NORMAL"

    assert result.severity == "LOW"

    assert result.escalation_required is False


def test_urgent_service_outage():

    result = assess_ticket_priority(
        message=(
            "The service is unavailable. "
            "This is urgent and we cannot work."
        ),
        category="SERVICE",
    )

    assert result.priority == "P1_CRITICAL"

    assert result.escalation_required is True


def test_low_urgency_request():

    result = assess_ticket_priority(
        message="No rush, please check this whenever possible.",
        category="OTHER",
    )

    assert result.urgency_level == 1

    assert result.priority == "P4_LOW"


def test_sla_for_critical_ticket():

    result = assess_ticket_priority(
        message="System is down immediately.",
        category="TECHNICAL",
    )

    assert result.first_response_sla_hours == 1

    assert result.resolution_sla_hours == 4

    assert result.suggested_sla_hours == 1


def test_sla_for_normal_ticket():

    result = assess_ticket_priority(
        message="Can you tell me my order status?",
        category="ORDER",
    )

    assert result.first_response_sla_hours == 24

    assert result.resolution_sla_hours == 72


def test_reason_codes_are_generated():

    result = assess_ticket_priority(
        message="My account was hacked urgently.",
        category="ACCOUNT",
    )

    assert result.reason_codes

    assert any(
        code.startswith("impact:")
        for code in result.reason_codes
    )

    assert any(
        code.startswith("urgency:")
        for code in result.reason_codes
    )