from types import SimpleNamespace

import pytest

from app.services import llm_service
from app.services.prompt_manager import build_chat_messages
from app.services.usage_tracker import extract_usage


class FakeClient:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def chat(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def fake_response(text="Hello!", status="COMPLETE"):
    return SimpleNamespace(
        message=SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)]
        ),
        finish_reason=status,
        meta=SimpleNamespace(
            tokens=SimpleNamespace(input_tokens=10, output_tokens=5),
            billed_units=SimpleNamespace(input_tokens=8, output_tokens=5),
        ),
    )


def test_prompt_builder_adds_system_and_current_user_message():
    messages = build_chat_messages(
        "  Where is my order? ",
        history=[{"role": "assistant", "content": "I can help."}],
    )
    assert messages[0]["role"] == "system"
    assert messages[-1] == {"role": "user", "content": "Where is my order?"}
    assert len(messages) == 3


def test_prompt_builder_rejects_invalid_history_role():
    with pytest.raises(ValueError):
        build_chat_messages("Hello", history=[{"role": "system", "content": "bad"}])


def test_prompt_builder_rejects_empty_message():
    with pytest.raises(ValueError):
        build_chat_messages("  ")


def test_usage_extraction():
    usage = extract_usage(fake_response())
    assert usage == {
        "input_tokens": 10,
        "output_tokens": 5,
        "billed_input_tokens": 8,
        "billed_output_tokens": 5,
    }


def test_generate_response_with_metadata(monkeypatch):
    client = FakeClient(response=fake_response("Order received."))
    monkeypatch.setattr(llm_service, "get_cohere_client", lambda: client)
    result = llm_service.generate_response_with_metadata("Hello")
    assert result["response"] == "Order received."
    assert result["usage"]["input_tokens"] == 10
    assert len(client.calls) == 1


def test_generate_response_backward_compatibility(monkeypatch):
    client = FakeClient(response=fake_response("Legacy response."))
    monkeypatch.setattr(llm_service, "get_cohere_client", lambda: client)
    assert llm_service.generate_response("Hello") == "Legacy response."


def test_non_retryable_error_is_wrapped(monkeypatch):
    client = FakeClient(error=ValueError("bad request"))
    monkeypatch.setattr(llm_service, "get_cohere_client", lambda: client)
    monkeypatch.setattr(llm_service.settings, "COHERE_MAX_RETRIES", 2)
    with pytest.raises(llm_service.LLMServiceError):
        llm_service.generate_response("Hello")
    assert len(client.calls) == 1


def test_retryable_error_retries_then_succeeds(monkeypatch):
    class TemporaryError(Exception):
        status_code = 503

    class FlakyClient:
        def __init__(self):
            self.calls = 0

        def chat(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                raise TemporaryError("temporary")
            return fake_response("Recovered.")

    client = FlakyClient()
    monkeypatch.setattr(llm_service, "get_cohere_client", lambda: client)
    monkeypatch.setattr(llm_service.settings, "COHERE_MAX_RETRIES", 1)
    monkeypatch.setattr(llm_service.settings, "COHERE_RETRY_BASE_SECONDS", 0)
    monkeypatch.setattr(llm_service.settings, "COHERE_RETRY_MAX_SECONDS", 0)
    monkeypatch.setattr(llm_service.time, "sleep", lambda _: None)
    assert llm_service.generate_response("Hello") == "Recovered."
    assert client.calls == 2


def test_missing_text_content_raises_safe_error(monkeypatch):
    response = SimpleNamespace(
        message=SimpleNamespace(content=[SimpleNamespace(type="tool_call")]),
        finish_reason="TOOL_CALL",
        meta=None,
    )
    monkeypatch.setattr(
        llm_service, "get_cohere_client", lambda: FakeClient(response=response)
    )
    with pytest.raises(llm_service.LLMServiceError):
        llm_service.generate_response("Hello")
