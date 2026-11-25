import pytest

from app.services.context_manager import ContextValidationError, build_conversation_context

def test_normalizes_roles_and_appends_current_message():
    history = [
        {"sender_type": "customer", "content": "Hello"},
        {"sender_type": "bot", "content": "Hi"},
        {"sender_type": "agent", "content": "I can help"},
    ]
    result = build_conversation_context(current_message="Track my order", history=history)
    assert [(m.role, m.content) for m in result.messages] == [
        ("user", "Hello"), ("assistant", "Hi"),
        ("assistant", "I can help"), ("user", "Track my order")
    ]
    assert result.history_messages_included == 3

def test_keeps_latest_history_within_message_limit():
    history = [{"sender_type": "customer", "content": f"msg-{i}"} for i in range(6)]
    result = build_conversation_context(
        current_message="now", history=history, max_messages=3
    )
    assert [m.content for m in result.messages] == ["msg-4", "msg-5", "now"]
    assert result.truncated is True

def test_respects_character_budget_and_keeps_current_message():
    history = [
        {"sender_type": "customer", "content": "A" * 700},
        {"sender_type": "bot", "content": "B" * 700},
        {"sender_type": "customer", "content": "C" * 700},
    ]
    result = build_conversation_context(
        current_message="current", history=history, max_total_characters=1500
    )
    assert result.messages[-1].content == "current"
    assert result.total_characters <= 1500
    assert result.truncated is True

def test_rejects_unknown_sender_type():
    with pytest.raises(ContextValidationError, match="Unsupported sender_type"):
        build_conversation_context(
            current_message="Hello",
            history=[{"sender_type": "admin", "content": "private"}],
        )

def test_rejects_blank_history_content():
    with pytest.raises(ContextValidationError, match="non-empty string"):
        build_conversation_context(
            current_message="Hello",
            history=[{"sender_type": "customer", "content": "  "}],
        )

def test_rejects_blank_current_message():
    with pytest.raises(ContextValidationError, match="current_message"):
        build_conversation_context(current_message=" ", history=[])

def test_current_message_is_added_once():
    result = build_conversation_context(
        current_message="Need help",
        history=[{"sender_type": "customer", "content": "Earlier"}],
    )
    assert sum(m.role == "user" and m.content == "Need help" for m in result.messages) == 1

def test_rejects_invalid_limits():
    with pytest.raises(ContextValidationError, match="max_messages"):
        build_conversation_context(current_message="Hi", history=[], max_messages=0)

def test_empty_history_is_valid():
    result = build_conversation_context(current_message="First message", history=[])
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
    assert result.truncated is False
