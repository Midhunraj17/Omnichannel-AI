from unittest.mock import patch

from app.schemas.intent import IntentClassificationRequest
from app.services.intent_service import classify_intent, _normalise_result


def test_rule_path_does_not_call_cohere():
    request = IntentClassificationRequest(message="Hi")
    with patch("app.services.intent_service._classify_with_cohere") as cohere:
        result = classify_intent(request)
    cohere.assert_not_called()
    assert result["primary_intent"] == "GREETING"


def test_cohere_result_is_restricted_to_allowed_intents():
    result = _normalise_result({
        "primary_intent": "MADE_UP_INTENT",
        "intents": [{"name": "MADE_UP_INTENT", "confidence": 0.99}],
        "confidence": 0.99,
    })
    assert result["primary_intent"] == "UNKNOWN"
    assert result["intents"][0]["name"] == "UNKNOWN"


def test_cohere_multiple_intents_are_preserved():
    result = _normalise_result({
        "primary_intent": "REFUND_REQUEST",
        "intents": [
            {"name": "REFUND_REQUEST", "confidence": 0.91},
            {"name": "COMPLAINT", "confidence": 0.84},
        ],
        "confidence": 0.91,
    })
    assert [item["name"] for item in result["intents"]] == ["REFUND_REQUEST", "COMPLAINT"]
