"""Cohere Chat integration with bounded retry and normalized output."""

import random
import time

from app.core.config import settings
from app.services.cohere_client import get_cohere_client
from app.services.prompt_manager import build_chat_messages
from app.services.usage_tracker import extract_usage


class LLMServiceError(RuntimeError):
    """Safe application-level error for Cohere failures."""


def _status_code(error):
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None) or getattr(error, "status_code", None)


def _is_retryable(error):
    status = _status_code(error)
    if status in {408, 425, 429, 500, 502, 503, 504}:
        return True
    # Network/timeout exceptions from the SDK's HTTP transport.
    name = type(error).__name__.lower()
    return any(token in name for token in ("timeout", "connection", "network"))


def _extract_text(response):
    message = getattr(response, "message", None)
    content = getattr(message, "content", None) or []
    for item in content:
        if getattr(item, "type", None) == "text":
            text = getattr(item, "text", None)
            if isinstance(text, str) and text.strip():
                return text.strip()
    raise LLMServiceError("Cohere returned no text content")


def generate_response_with_metadata(
    user_message,
    history=None,
    system_prompt=None,
):
    messages = build_chat_messages(
        user_message=user_message,
        history=history,
        system_prompt=system_prompt,
    )

    client = get_cohere_client()
    attempts = settings.COHERE_MAX_RETRIES + 1

    for attempt in range(attempts):
        try:
            response = client.chat(
                model=settings.COHERE_CHAT_MODEL,
                messages=messages,
                max_tokens=settings.COHERE_MAX_TOKENS,
                temperature=settings.COHERE_TEMPERATURE,
            )
            print("\n========== COHERE DEBUG ==========")
            print("Response type:", type(response))
            print("Response metadata:")
            print(getattr(response, "meta", None))
            print("Response usage:")
            print(getattr(response, "usage", None))
            if hasattr(response, "model_dump"):
                print("Full response fields:")
                print(response.model_dump().keys())
            print("==================================\n")
            return {
                "response": _extract_text(response),
                "model": settings.COHERE_CHAT_MODEL,
                "finish_reason": getattr(response, "finish_reason", None),
                "usage": extract_usage(response),
            }
        except LLMServiceError:
            raise
        except Exception as error:
            if attempt >= attempts - 1 or not _is_retryable(error):
                raise LLMServiceError(
                    "Language model service is temporarily unavailable"
                ) from error
            delay = settings.COHERE_RETRY_BASE_SECONDS * (2 ** attempt)
            delay = min(delay, settings.COHERE_RETRY_MAX_SECONDS)
            time.sleep(delay + random.uniform(0, delay * 0.1))


def generate_response(user_message):
    """Backward-compatible string response used by the existing chat route."""
    return generate_response_with_metadata(user_message)["response"]
