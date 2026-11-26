from pydantic import BaseModel, Field


class ContextualEntity(BaseModel):
    entity_type: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0.0, le=1.0)


class ContextualResolutionResult(BaseModel):
    success: bool = True

    contextual_context: str = Field(
        default="",
        max_length=8000,
    )

    active_entities: list[ContextualEntity] = Field(
        default_factory=list,
        max_length=50,
    )

    continuity_signals: list[str] = Field(
        default_factory=list,
        max_length=20,
    )

    context_messages_used: int = Field(
        default=0,
        ge=0,
    )

    context_truncated: bool = False

    resolution_method: str = "deterministic_context"