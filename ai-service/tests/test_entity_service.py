from app.schemas.entities import EntityExtractionRequest
from app.services import entity_service


def test_required_entities_are_reported_missing(monkeypatch):
    monkeypatch.setattr(entity_service, "_cohere_extract", lambda request, allowed: [])
    result = entity_service.extract_entities(EntityExtractionRequest(
        message="Email me at test@example.com",
        domain="general",
        required_entities=["EMAIL_ADDRESS", "PERSON_NAME"],
    ))
    assert result["missing_entities"] == ["PERSON_NAME"]
    assert result["requires_clarification"] is True


def test_rule_only_entities_do_not_need_cohere_for_general_contact(monkeypatch):
    # This case is intentionally mocked at the semantic boundary; it verifies merge/output logic.
    monkeypatch.setattr(entity_service, "_cohere_extract", lambda request, allowed: [])
    result = entity_service.extract_entities(EntityExtractionRequest(
        message="Contact test@example.com",
        domain="general",
    ))
    assert any(e["entity_type"] == "EMAIL_ADDRESS" for e in result["entities"])
