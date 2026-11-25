import json
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

from app.services.cohere_client import get_cohere_client
from app.core.config import settings


T = TypeVar("T", bound=BaseModel)


class StructuredOutputError(Exception):
    """Raised when structured AI output cannot be generated or validated."""


def generate_structured_response(
    user_message: str,
    response_schema: Type[T],
    system_prompt: str = "Return accurate information using the required JSON structure.",
) -> T:
    """
    Generate a structured JSON response using Cohere
    and validate it against a Pydantic model.
    """

    if not user_message or not user_message.strip():
        raise ValueError("User message cannot be empty.")

    if not issubclass(response_schema, BaseModel):
        raise TypeError("response_schema must be a Pydantic model.")

    schema = response_schema.model_json_schema()

    messages = [
        {
            "role": "system",
            "content": (
                f"{system_prompt}\n"
                "Return only information that follows the required JSON schema. "
                "Do not invent facts."
            ),
        },
        {
            "role": "user",
            "content": (
                "Generate a JSON object following the required schema.\n\n"
                f"Request: {user_message}"
            ),
        },
    ]

    try:
        client = get_cohere_client()

        response = client.chat(
            model=settings.COHERE_CHAT_MODEL,
            messages=messages,
            response_format={
                "type": "json_object",
                "schema": schema,
            },
            max_tokens=settings.COHERE_MAX_TOKENS,
            temperature=0,
        )

        content = response.message.content

        text_content = next(
            (
                item.text
                for item in content
                if getattr(item, "type", None) == "text"
            ),
            None,
        )

        if not text_content:
            raise StructuredOutputError(
                "Cohere returned an empty structured response."
            )

        try:
            result = response_schema.model_validate_json(text_content)
        except (ValidationError, ValueError) as exc:
            raise StructuredOutputError(
                "Generated response failed schema validation."
            ) from exc

        return result

    except StructuredOutputError:
        raise

    except Exception as exc:
        raise StructuredOutputError(
            "Failed to generate structured response."
        ) from exc