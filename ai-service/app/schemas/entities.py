from typing import Literal
from pydantic import BaseModel, Field, field_validator

EntityDomain = Literal["general", "ecommerce", "product", "saas", "service"]
EntityMethod = Literal["rules", "cohere", "hybrid", "none"]


class EntityExtractionContext(BaseModel):
    conversation_summary: str | None = Field(default=None, max_length=3000)
    recent_messages: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("recent_messages")
    @classmethod
    def limit_recent_messages(cls, values: list[str]) -> list[str]:
        return [value[:2000] for value in values]


class EntityExtractionRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)
    domain: EntityDomain = "general"
    required_entities: list[str] = Field(default_factory=list, max_length=30)
    context: EntityExtractionContext | None = None

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message must not be blank")
        return value

    @field_validator("required_entities")
    @classmethod
    def clean_required_entities(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(v.strip().upper() for v in values if v.strip()))


class ExtractedEntity(BaseModel):
    entity_type: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=500)
    normalized_value: str | None = Field(default=None, max_length=500)
    confidence: float = Field(ge=0.0, le=1.0)
    extraction_method: Literal["rules", "cohere"]
    validation_status: Literal["unverified"] = "unverified"


class EntityExtractionResponse(BaseModel):
    success: bool = True
    entities: list[ExtractedEntity]
    missing_entities: list[str]
    extraction_method: EntityMethod
    requires_clarification: bool = False
