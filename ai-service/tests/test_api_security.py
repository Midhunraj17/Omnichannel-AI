from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings


client = TestClient(app)

TEST_API_KEY = "test-internal-api-key"


def test_missing_api_key_returns_401(monkeypatch):
    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        TEST_API_KEY,
    )

    response = client.post(
        "/api/v1/intent/classify",
        json={"message": "Hello"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authentication credentials."


def test_invalid_api_key_returns_401(monkeypatch):
    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        TEST_API_KEY,
    )

    response = client.post(
        "/api/v1/intent/classify",
        headers={"Authorization": "Bearer wrong-api-key"},
        json={"message": "Hello"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid authentication credentials."


def test_valid_api_key_allows_request(monkeypatch):
    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        TEST_API_KEY,
    )

    response = client.post(
        "/api/v1/intent/classify",
        headers={"Authorization": f"Bearer {TEST_API_KEY}"},
        json={"message": "Hello"},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True


def test_missing_server_api_key_returns_503(monkeypatch):
    monkeypatch.setattr(
        settings,
        "AI_SERVICE_API_KEY",
        None,
    )

    response = client.post(
        "/api/v1/intent/classify",
        json={"message": "Hello"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Internal authentication is not configured."