from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

ContextRole = Literal["system", "user", "assistant"]

class ContextMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: ContextRole
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message content cannot be blank")
        return value

class ContextBuildResult(BaseModel):
    messages: list[ContextMessage]
    history_messages_included: int
    total_messages: int
    total_characters: int
    truncated: bool
