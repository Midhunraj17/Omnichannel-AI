"""Pydantic schemas for Phase 3, Task 3.7 — Response Generation Engine.

Defines the request and response contracts for generating customer-facing
responses through the existing Cohere LLM integration while reusing the
established ``EntityDomain`` taxonomy from ``app.schemas.entities``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.entities import EntityDomain

MAX_MESSAGE_LENGTH = 10_000
MAX_HISTORY_MESSAGES = 30
MAX_SUMMARY_LENGTH = 3_000


class ResponseGenerationRequest(BaseModel):
    """Validated input contract for the Response Generation Engine.

    Notes
    -----
    - ``message`` is required and must contain non-whitespace text.
    - ``history`` accepts up to 30 normalized or sender-typed message items
      (either dictionaries or Pydantic models such as ``ContextMessage``).
    - ``domain`` strictly reuses ``EntityDomain`` from ``app.schemas.entities``.
    - ``conversation_summary`` is optional background context, capped at 3,000
      characters.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    message: str = Field(
        ...,
        max_length=MAX_MESSAGE_LENGTH,
        description=(
            "Current customer message to respond to. Must contain non-whitespace "
            "text and not exceed 10,000 characters."
        ),
    )
    history: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=MAX_HISTORY_MESSAGES,
        description=(
            "Recent conversation turns supplied by the trusted backend or "
            "Context Manager (maximum 30 messages)."
        ),
    )
    domain: EntityDomain = Field(
        default="general",
        description=(
            "Business domain used to select domain-specific response guidance. "
            "Controlled by EntityDomain."
        ),
    )
    conversation_summary: str | None = Field(
        default=None,
        max_length=MAX_SUMMARY_LENGTH,
        description=(
            "Optional contextual summary of prior conversation turns "
            "(maximum 3,000 characters)."
        ),
    )

    @field_validator("message")
    @classmethod
    def validate_message_not_blank(cls, value: str) -> str:
        """Reject empty or whitespace-only customer messages."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("message must contain non-whitespace text.")
        return stripped

    @field_validator("history", mode="before")
    @classmethod
    def normalize_history_items(cls, value: Any) -> Any:
        """Accept dict items or Pydantic model items (e.g., ContextMessage)."""
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("history must be a list of message objects.")

        normalized: list[dict[str, Any]] = []
        for idx, item in enumerate(value):
            if isinstance(item, BaseModel):
                normalized.append(item.model_dump())
            elif isinstance(item, Mapping):
                normalized.append(dict(item))
            else:
                raise ValueError(
                    f"history item at index {idx} must be a mapping or message model."
                )
        return normalized

    @field_validator("conversation_summary")
    @classmethod
    def normalize_summary(cls, value: str | None) -> str | None:
        """Normalize blank summaries to None while preserving bounded text."""
        if value is None:
            return None
        stripped = value.strip()
        return stripped if stripped else None


class ResponseGenerationResult(BaseModel):
    """Normalized output contract returned by the Response Generation Engine."""

    model_config = ConfigDict(extra="forbid")

    success: bool = Field(
        ...,
        description="Indicates whether customer response generation succeeded.",
    )
    response: str = Field(
        ...,
        min_length=1,
        description="Validated customer-facing response text.",
    )
    model: str | None = Field(
        default=None,
        description="Identifier of the Cohere model used to generate the response.",
    )
    finish_reason: str | None = Field(
        default=None,
        description="Provider finish reason returned by Cohere, if available.",
    )
    usage: dict[str, Any] | None = Field(
        default=None,
        description="Token usage metadata extracted by the existing LLM service.",
    )
    generation_method: str = Field(
        default="cohere_llm_service",
        description="Identifies the generation pathway used (existing Cohere service).",
    )
