from app.services.ticket_triage import triage_ticket


def test_non_support_intent_has_no_ticket_triage():
    assert triage_ticket(
        primary_intent="GREETING",
        intents=["GREETING"],
        message="Hello",
    ) is None


def test_normal_order_status_is_normal_priority():
    result = triage_ticket(
        primary_intent="ORDER_STATUS",
        intents=["ORDER_STATUS"],
        message="Can you tell me my order status?",
    )
    assert result is not None
    assert result.category == "ORDER"
    assert result.priority == "P3_NORMAL"
    assert result.suggested_sla_hours == 24


def test_security_incident_is_critical():
    result = triage_ticket(
        primary_intent="ACCOUNT_ACCESS_ISSUE",
        intents=["ACCOUNT_ACCESS_ISSUE"],
        message="My account was hacked and there is unauthorized access.",
    )
    assert result is not None
    assert result.priority == "P1_CRITICAL"
    assert result.severity == "CRITICAL"
    assert result.priority_score >= 80


def test_complaint_with_urgent_signals_is_high_priority():
    result = triage_ticket(
        primary_intent="COMPLAINT",
        intents=["COMPLAINT"],
        message="I am frustrated. This is urgent and the service is unavailable.",
    )
    assert result is not None
    assert result.priority in {"P1_CRITICAL", "P2_HIGH"}
    assert result.sentiment == "NEGATIVE"
    assert result.urgency_signals


def test_score_is_bounded():
    result = triage_ticket(
        primary_intent="PAYMENT_ISSUE",
        intents=["PAYMENT_ISSUE"],
        message=("Fraud! Account hacked! Unauthorized access! Urgent! " * 10),
    )
    assert result is not None
    assert 0 <= result.priority_score <= 100
