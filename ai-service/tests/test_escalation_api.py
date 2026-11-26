import pytest

from fastapi.testclient import TestClient

from app.main import app
from app.core.security import verify_internal_api_key


@pytest.fixture(autouse=True)
def bypass_internal_auth(monkeypatch):
    """
    Bypass authentication only during this test module's
    individual tests.

    pytest automatically restores the original dependency
    override after each test.
    """

    monkeypatch.setitem(
        app.dependency_overrides,
        verify_internal_api_key,
        lambda: True,
    )


client = TestClient(app)


def test_escalation_endpoint_returns_evaluation():

    payload = {
        "ticket_id": "ticket-api-001",
        "status": "open",
        "priority": "P1_CRITICAL",
        "severity": "CRITICAL",
        "created_at": "2026-11-26T10:00:00Z",
        "first_response_sla_hours": 1,
        "resolution_sla_hours": 4,
        "escalation_required": True,
        "current_escalation_level": 0,
        "now": "2026-11-26T12:00:00Z",
    }

    response = client.post(
        "/api/v1/tickets/escalation/evaluate",
        json=payload,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["success"] is True
    assert body["should_escalate"] is True

    assert body["recommended_escalation_level"] == 3

    assert (
        body["escalation_target"]
        == "CRITICAL_RESPONSE_TEAM"
    )


def test_escalation_endpoint_rejects_invalid_priority():

    payload = {
        "ticket_id": "ticket-api-002",
        "status": "open",
        "priority": "SUPER_URGENT",
        "severity": "HIGH",
        "created_at": "2026-11-26T10:00:00Z",
    }

    response = client.post(
        "/api/v1/tickets/escalation/evaluate",
        json=payload,
    )

    assert response.status_code == 422


def test_escalation_endpoint_rejects_missing_ticket_id():

    payload = {
        "status": "open",
        "priority": "P3_NORMAL",
        "severity": "MEDIUM",
        "created_at": "2026-11-26T10:00:00Z",
    }

    response = client.post(
        "/api/v1/tickets/escalation/evaluate",
        json=payload,
    )

    assert response.status_code == 422


def test_escalation_endpoint_rejects_naive_datetime():

    payload = {
        "ticket_id": "ticket-api-003",
        "status": "open",
        "priority": "P3_NORMAL",
        "severity": "MEDIUM",
        "created_at": "2026-11-26T10:00:00",
    }

    response = client.post(
        "/api/v1/tickets/escalation/evaluate",
        json=payload,
    )

    assert response.status_code == 422