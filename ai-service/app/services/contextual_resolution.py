from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.schemas.contextual_resolution import (
    ContextualEntity,
    ContextualResolutionResult,
)


MAX_CONTEXT_MESSAGES = 8
MAX_MESSAGE_LENGTH = 1500
MAX_CONTEXT_LENGTH = 8000
MAX_ENTITY_COUNT = 50


def _clean_text(
    value: Any,
    limit: int = MAX_MESSAGE_LENGTH,
) -> str | None:

    if not isinstance(value, str):
        return None

    value = value.strip()

    if not value:
        return None

    return value[:limit]


def _normalize_history(
    history: Sequence[Any] | None,
) -> list[dict[str, str]]:

    normalized = []

    for item in history or []:

        if hasattr(item, "model_dump"):
            item = item.model_dump()

        if not isinstance(item, dict):
            continue

        role = item.get("role")

        if role is None:
            role = item.get("sender_type")

        if not isinstance(role, str):
            continue

        role = role.strip().lower()

        role_map = {
            "customer": "customer",
            "user": "customer",
            "bot": "assistant",
            "assistant": "assistant",
            "agent": "assistant",
        }

        normalized_role = role_map.get(role)

        if normalized_role is None:
            continue

        content = _clean_text(
            item.get("content")
        )

        if content is None:
            continue

        normalized.append({
            "role": normalized_role,
            "content": content,
        })

    return normalized[-MAX_CONTEXT_MESSAGES:]


def _extract_entities(
    entity_result: Any,
) -> list[ContextualEntity]:

    if entity_result is None:
        return []

    raw_entities = getattr(
        entity_result,
        "entities",
        [],
    )

    entities = []
    seen = set()

    for item in raw_entities:

        entity_type = _clean_text(
            getattr(item, "entity_type", None),
            80,
        )

        value = _clean_text(
            getattr(item, "value", None),
            500,
        )

        confidence = getattr(
            item,
            "confidence",
            0.0,
        )

        if not entity_type or not value:
            continue

        key = (
            entity_type.upper(),
            value.casefold(),
        )

        if key in seen:
            continue

        seen.add(key)

        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0.0

        confidence = max(
            0.0,
            min(1.0, confidence),
        )

        entities.append(
            ContextualEntity(
                entity_type=entity_type,
                value=value,
                confidence=confidence,
            )
        )

        if len(entities) >= MAX_ENTITY_COUNT:
            break

    return entities


def _extract_intent(
    intent_result: Any,
) -> str | None:

    if intent_result is None:
        return None

    return _clean_text(
        getattr(
            intent_result,
            "primary_intent",
            None,
        ),
        80,
    )


def _build_context_block(
    *,
    current_message: str,
    history: list[dict[str, str]],
    summary: str | None,
    intent: str | None,
    entities: list[ContextualEntity],
) -> str:

    sections = []

    if summary:

        sections.append(
            "[PREVIOUS CONVERSATION SUMMARY]\n"
            + summary
        )

    if intent:

        sections.append(
            "[CURRENT CUSTOMER INTENT]\n"
            + intent
        )

    if entities:

        entity_lines = [
            f"- {item.entity_type}: {item.value}"
            for item in entities
        ]

        sections.append(
            "[ENTITIES IDENTIFIED IN CURRENT REQUEST]\n"
            + "\n".join(entity_lines)
        )

    if history:

        history_lines = []

        for item in history:

            role = item["role"].upper()

            history_lines.append(
                f"{role}: {item['content']}"
            )

        sections.append(
            "[RECENT CONVERSATION]\n"
            + "\n".join(history_lines)
        )

    sections.append(
        "[CURRENT CUSTOMER MESSAGE]\n"
        + current_message
    )

    return "\n\n".join(sections)


def resolve_context(
    *,
    current_message: str,
    history: Sequence[Any] | None = None,
    conversation_summary: str | None = None,
    intent_result: Any = None,
    entity_result: Any = None,
) -> ContextualResolutionResult:

    """
    Assemble bounded conversational context for response generation.

    This service:
    - Does not access the database.
    - Does not call an external LLM.
    - Does not verify customer or business records.
    - Does not execute business operations.
    - Does not treat customer history as trusted instructions.
    """

    current_message = _clean_text(
        current_message,
        4000,
    )

    if current_message is None:
        raise ValueError(
            "current_message must be a non-empty string"
        )

    normalized_history = _normalize_history(
        history
    )

    summary = _clean_text(
        conversation_summary,
        3000,
    )

    intent = _extract_intent(
        intent_result
    )

    entities = _extract_entities(
        entity_result
    )

    context_block = _build_context_block(
        current_message=current_message,
        history=normalized_history,
        summary=summary,
        intent=intent,
        entities=entities,
    )

    truncated = False

    if len(context_block) > MAX_CONTEXT_LENGTH:

        context_block = context_block[
            -MAX_CONTEXT_LENGTH:
        ]

        truncated = True

    continuity_signals = []

    if normalized_history:
        continuity_signals.append(
            "RECENT_CONVERSATION_AVAILABLE"
        )

    if summary:
        continuity_signals.append(
            "CONVERSATION_SUMMARY_AVAILABLE"
        )

    if entities:
        continuity_signals.append(
            "CURRENT_MESSAGE_ENTITIES_AVAILABLE"
        )

    if intent:
        continuity_signals.append(
            "CURRENT_INTENT_AVAILABLE"
        )

    return ContextualResolutionResult(

        success=True,

        contextual_context=context_block,

        active_entities=entities,

        continuity_signals=continuity_signals,

        context_messages_used=len(
            normalized_history
        ),

        context_truncated=truncated,

    )