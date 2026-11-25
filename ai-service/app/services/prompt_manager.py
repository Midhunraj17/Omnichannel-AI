"""Centralized prompts used by the Cohere integration."""

CUSTOMER_SUPPORT_SYSTEM_PROMPT = """
You are the AI assistant for a customer-support platform.
Be clear, helpful, concise, and professional.
Use only information provided in the conversation and trusted context.
If required information is missing, ask a focused clarification question.
Never invent order status, payment status, refund approval, inventory,
account details, or actions performed.
Never claim that you executed a business action. Authorized backend tools
must perform and verify business operations.
If the request needs a human or cannot be safely resolved, say so clearly.
""".strip()


def build_chat_messages(user_message: str, history=None, system_prompt=None):
    """Build validated Cohere Chat v2 messages, preserving supplied history."""
    if not isinstance(user_message, str) or not user_message.strip():
        raise ValueError("user_message must be a non-empty string")

    messages = [{
        "role": "system",
        "content": system_prompt or CUSTOMER_SUPPORT_SYSTEM_PROMPT,
    }]

    for item in history or []:
        if not isinstance(item, dict):
            raise ValueError("Each history message must be a dictionary")
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"}:
            raise ValueError("History roles must be 'user' or 'assistant'")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("History message content must be non-empty")
        messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_message.strip()})
    return messages
