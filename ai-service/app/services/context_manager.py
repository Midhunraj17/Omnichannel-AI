from collections.abc import Mapping, Sequence
from typing import Any

from app.schemas.context import ContextBuildResult, ContextMessage

_ROLE_MAP = {
    "customer": "user",
    "bot": "assistant",
    "agent": "assistant",
    "system": "system",
}
_MAX_MESSAGE_CHARACTERS = 4000

class ContextValidationError(ValueError):
    """Invalid conversation data supplied to the context builder."""

def _normalize_history_message(raw: Mapping[str, Any]) -> ContextMessage:
    if not isinstance(raw, Mapping):
        raise ContextValidationError("Each history item must be an object")
    sender_type = raw.get("sender_type")
    content = raw.get("content")
    if sender_type not in _ROLE_MAP:
        raise ContextValidationError(f"Unsupported sender_type: {sender_type!r}")
    if not isinstance(content, str) or not content.strip():
        raise ContextValidationError("History message content must be a non-empty string")
    return ContextMessage(
        role=_ROLE_MAP[sender_type],
        content=content.strip()[:_MAX_MESSAGE_CHARACTERS],
    )

def build_conversation_context(
    *,
    current_message: str,
    history: Sequence[Mapping[str, Any]] | None = None,
    max_messages: int = 20,
    max_total_characters: int = 16000,
) -> ContextBuildResult:
    """
    Build bounded LLM context from prior persisted messages and the current input.

    The caller must authenticate the user and authorize the conversation before
    retrieving and supplying history. This pure function performs no DB access.
    History must contain prior messages only; current_message is appended once.
    """
    if not isinstance(current_message, str) or not current_message.strip():
        raise ContextValidationError("current_message must be a non-empty string")
    if len(current_message.strip()) > _MAX_MESSAGE_CHARACTERS:
        raise ContextValidationError(
            f"current_message cannot exceed {_MAX_MESSAGE_CHARACTERS} characters"
        )
    if not 1 <= max_messages <= 50:
        raise ContextValidationError("max_messages must be between 1 and 50")
    if not 1000 <= max_total_characters <= 50000:
        raise ContextValidationError(
            "max_total_characters must be between 1000 and 50000"
        )

    normalized = [_normalize_history_message(item) for item in (history or [])]
    selected = normalized[-(max_messages - 1):] if max_messages > 1 else []
    current = ContextMessage(role="user", content=current_message.strip())

    remaining = max_total_characters - len(current.content)
    if remaining < 0:
        raise ContextValidationError("Current message exceeds the context budget")

    kept_reversed = []
    for message in reversed(selected):
        if len(message.content) <= remaining:
            kept_reversed.append(message)
            remaining -= len(message.content)

    included = list(reversed(kept_reversed))
    messages = included + [current]
    total_chars = sum(len(message.content) for message in messages)

    return ContextBuildResult(
        messages=messages,
        history_messages_included=len(included),
        total_messages=len(messages),
        total_characters=total_chars,
        truncated=len(included) < len(normalized),
    )
