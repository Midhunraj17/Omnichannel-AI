"""High-precision, deterministic intent rules. Unknown messages go to Cohere."""

import re

# Transactional and explicit handoff rules are evaluated before broad categories.
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("HUMAN_HANDOFF", ("human agent", "real person", "talk to a person", "speak to an agent", "connect me to support", "representative", "live agent")),
    ("PASSWORD_RESET", ("reset my password", "forgot my password", "can't log in", "cannot log in", "password reset")),
    ("TICKET_STATUS", ("ticket status", "status of my ticket", "track my ticket", "support request status")),
    ("TICKET_CREATE", ("create a ticket", "raise a ticket", "open a ticket", "lodge a ticket", "log a complaint")),
    ("TICKET_UPDATE", ("update my ticket", "reopen my ticket", "add to my ticket", "close my ticket")),
    ("ORDER_TRACKING", ("track my order", "where is my order", "track order", "shipment tracking", "tracking my parcel")),
    ("ORDER_STATUS", ("order status", "status of my order", "has my order shipped", "did my order ship")),
    ("REFUND_REQUEST", ("request a refund", "want a refund", "get my money back", "refund my order")),
    ("RETURN_REQUEST", ("return this", "return my order", "want to return", "send it back")),
    ("CANCELLATION_REQUEST", ("cancel my order", "cancel the order", "cancel my subscription", "cancel my booking")),
    ("PAYMENT_ISSUE", ("payment failed", "payment failure", "charged twice", "double charged", "payment declined")),
    ("PAYMENT_STATUS", ("payment status", "was my payment successful", "did payment go through")),
    ("COMPLAINT", ("i want to complain", "file a complaint", "very disappointed", "unacceptable service")),
    ("PRICING_ENQUIRY", ("how much does", "what is the price", "pricing", "cost of", "how much is")),
    ("PRODUCT_COMPARISON", ("compare", "difference between", "which is better", "versus", "vs")),
    ("AVAILABILITY_CHECK", ("is it available", "availability", "in stock", "available now", "do you have")),
    ("PURCHASE_INTENT", ("i want to buy", "i'd like to buy", "i would like to purchase", "place an order", "buy this")),
    ("FEATURE_ENQUIRY", ("does it support", "does it have", "what features", "features of")),
    ("PRODUCT_ISSUE", ("product is broken", "not working properly", "defective product", "damaged product", "product stopped working")),
    ("SERVICE_ISSUE", ("service was poor", "technician did not", "appointment was missed", "service not completed")),
    ("ACCOUNT_ACCESS_ISSUE", ("can't access my account", "cannot access my account", "account locked", "login issue")),
]

_SOCIAL_EXACT: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("GREETING", ("hi", "hi there", "hello", "hello there", "hey", "hey there", "good morning", "good afternoon", "good evening")),
    ("THANKS", ("thanks", "thank you", "thx", "appreciate it")),
    ("GOODBYE", ("bye", "goodbye", "see you", "talk later")),
)


def _contains_phrase(text: str, phrase: str) -> bool:
    phrase = phrase.strip()
    pattern = re.escape(phrase).replace(r"\ ", r"\s+")
    return re.search(rf"(?<!\w){pattern}(?!\w)", text) is not None


def classify_with_rules(message: str) -> dict | None:
    text = re.sub(r"\s+", " ", message.casefold()).strip()
    text = re.sub(r"[.!?]+$", "", text).strip()

    # Social-only rules match the complete message to avoid treating "this" as "hi".
    for intent, phrases in _SOCIAL_EXACT:
        if any(text == phrase for phrase in phrases):
            return {
                "primary_intent": intent,
                "intents": [{"name": intent, "confidence": 0.96}],
                "confidence": 0.96,
                "classification_method": "rules",
                "handoff_requested": False,
                "requires_clarification": False,
            }

    matches: list[str] = []
    for intent, phrases in _RULES:
        if any(_contains_phrase(text, phrase) for phrase in phrases):
            matches.append(intent)

    if not matches:
        return None

    primary = matches[0]
    confidence = 0.94 if len(matches) == 1 else 0.88
    return {
        "primary_intent": primary,
        "intents": [{"name": name, "confidence": confidence} for name in matches],
        "confidence": confidence,
        "classification_method": "rules",
        "handoff_requested": "HUMAN_HANDOFF" in matches,
        "requires_clarification": False,
    }
