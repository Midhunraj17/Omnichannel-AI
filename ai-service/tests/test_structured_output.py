from unittest.mock import Mock

import pytest
from pydantic import BaseModel, Field

from app.services import structured_output_service


class IntentResponse(BaseModel):
    intent: str
    confidence: float = Field(ge=0, le=1)
    requires_human: bool


def test_structured_response_success(monkeypatch):

    fake_response = Mock()

    fake_response.message.content = [
        Mock(
            type="text",
            text='{"intent":"ORDER_STATUS","confidence":0.94,"requires_human":false}'
        )
    ]

    fake_client = Mock()
    fake_client.chat.return_value = fake_response

    monkeypatch.setattr(
        structured_output_service,
        "get_cohere_client",
        lambda: fake_client
    )

    monkeypatch.setattr(
        structured_output_service.settings,
        "COHERE_CHAT_MODEL",
        "test-model"
    )

    result = structured_output_service.generate_structured_response(
        user_message="Where is my order?",
        response_schema=IntentResponse
    )

    assert result.intent == "ORDER_STATUS"
    assert result.confidence == 0.94
    assert result.requires_human is False


def test_invalid_json_response(monkeypatch):

    fake_response = Mock()

    fake_response.message.content = [
        Mock(
            type="text",
            text='{"intent":"ORDER_STATUS","confidence":5,"requires_human":false}'
        )
    ]

    fake_client = Mock()
    fake_client.chat.return_value = fake_response

    monkeypatch.setattr(
        structured_output_service,
        "get_cohere_client",
        lambda: fake_client
    )

    with pytest.raises(
        structured_output_service.StructuredOutputError
    ):
        structured_output_service.generate_structured_response(
            user_message="Check my order",
            response_schema=IntentResponse
        )


def test_empty_user_message():

    with pytest.raises(ValueError):
        structured_output_service.generate_structured_response(
            user_message=" ",
            response_schema=IntentResponse
        )