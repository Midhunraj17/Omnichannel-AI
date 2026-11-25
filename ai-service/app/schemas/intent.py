from typing import Literal

from pydantic import BaseModel, Field, field_validator


IntentName = Literal[
    "GREETING", "GOODBYE", "THANKS", "GENERAL_QUESTION", "OUT_OF_SCOPE",
    "PRODUCT_ENQUIRY", "SERVICE_ENQUIRY", "PRICING_ENQUIRY",
    "PRODUCT_COMPARISON", "AVAILABILITY_CHECK", "FEATURE_ENQUIRY",
    "PURCHASE_INTENT", "ORDER_TRACKING", "ORDER_STATUS", "PAYMENT_ISSUE",
    "PAYMENT_STATUS", "CANCELLATION_REQUEST", "ACCOUNT_ACCESS_ISSUE",
    "PASSWORD_RESET", "TECHNICAL_ISSUE", "PRODUCT_ISSUE", "SERVICE_ISSUE",
    "COMPLAINT", "TICKET_CREATE", "TICKET_STATUS", "RETURN_REQUEST",
    "REFUND_REQUEST", "HUMAN_HANDOFF", "TICKET_UPDATE", "FEEDBACK",
    "UNKNOWN", "AMBIGUOUS",
]


class IntentContext(BaseModel):
    """Optional context from the caller; do not place secrets here."""
    previous_intent: str | None = Field(default=None, max_length=80)
    conversation_summary: str | None = Field(default=None, max_length=3000)
    recent_messages: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("recent_messages")
    @classmethod
    def validate_recent_messages(cls, values: list[str]) -> list[str]:
        return [value[:2000] for value in values]


class IntentClassificationRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)
    context: IntentContext | None = None

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message must not be blank")
        return value


class IntentItem(BaseModel):
    name: IntentName
    confidence: float = Field(ge=0.0, le=1.0)


class IntentClassificationResponse(BaseModel):
    success: bool = True
    primary_intent: IntentName
    intents: list[IntentItem]
    confidence: float = Field(ge=0.0, le=1.0)
    classification_method: Literal["rules", "cohere", "fallback"]
    handoff_requested: bool = False
    requires_clarification: bool = False
