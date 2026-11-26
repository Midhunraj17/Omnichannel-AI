from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from app.schemas.entities import EntityDomain


MAX_MESSAGE_LENGTH = 10000
MAX_HISTORY_MESSAGES = 30
MAX_SUMMARY_LENGTH = 3000
MAX_CONTEXTUAL_CONTEXT_LENGTH = 8000


class ResponseGenerationRequest(BaseModel):

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=False,
    )

    message: str = Field(
        ...,
        max_length=MAX_MESSAGE_LENGTH,
    )

    history: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=MAX_HISTORY_MESSAGES,
    )

    domain: EntityDomain = "general"

    conversation_summary: str | None = Field(
        default=None,
        max_length=MAX_SUMMARY_LENGTH,
    )

    contextual_context: str | None = Field(
        default=None,
        max_length=MAX_CONTEXTUAL_CONTEXT_LENGTH,
    )

    @field_validator("message")
    @classmethod
    def validate_message_not_blank(
        cls,
        value: str,
    ) -> str:

        value = value.strip()

        if not value:
            raise ValueError(
                "message must contain non-whitespace text."
            )

        return value

    @field_validator("history", mode="before")
    @classmethod
    def normalize_history_items(
        cls,
        value: Any,
    ) -> Any:

        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError(
                "history must be a list of message objects."
            )

        normalized = []

        for idx, item in enumerate(value):

            if isinstance(item, BaseModel):

                normalized.append(
                    item.model_dump()
                )

            elif isinstance(item, Mapping):

                normalized.append(
                    dict(item)
                )

            else:

                raise ValueError(
                    f"history item at index {idx} "
                    "must be a mapping or message model."
                )

        return normalized

    @field_validator("conversation_summary")
    @classmethod
    def normalize_summary(
        cls,
        value: str | None,
    ) -> str | None:

        if value is None:
            return None

        value = value.strip()

        return value or None

    @field_validator("contextual_context")
    @classmethod
    def normalize_contextual_context(
        cls,
        value: str | None,
    ) -> str | None:

        if value is None:
            return None

        value = value.strip()

        return value or None


class ResponseGenerationResult(BaseModel):

    model_config = ConfigDict(
        extra="forbid",
    )

    success: bool

    response: str = Field(
        min_length=1,
    )

    model: str | None = None

    finish_reason: str | None = None

    usage: dict[str, Any] | None = None

    generation_method: str = "cohere_llm_service"