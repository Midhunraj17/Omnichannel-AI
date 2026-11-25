import re
from typing import Any

# Deterministic extraction is deliberately conservative. Values are candidates,
# not proof that a record exists or belongs to the current customer.
PATTERNS: list[tuple[str, re.Pattern[str], int]] = [
    ("EMAIL_ADDRESS", re.compile(r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.I), 0),
    ("PHONE_NUMBER", re.compile(r"(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\d[\s.-]?){7,14}\d(?!\w)", re.I), 0),
    (
    "ORDER_ID",
    re.compile(
        r"\b(?:order\s+(?:id|number|no\.?)\s+(?:is\s+)?)?(ORD[-_][A-Z0-9][A-Z0-9_-]{2,})\b",
        re.I
    ),
    1,
),
    ("TICKET_ID", re.compile(r"\b(?:ticket|case)\s*(?:id|number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{2,})\b", re.I), 1),
    ("TRACKING_NUMBER", re.compile(r"\btracking\s*(?:number|no\.?|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{5,})\b", re.I), 1),
    ("COUPON_CODE", re.compile(r"\b(?:coupon|promo(?:tion)?\s*code)\s*[:#-]?\s*([A-Z0-9_-]{3,})\b", re.I), 1),
    ("SERIAL_NUMBER", re.compile(r"\bserial\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{3,})\b", re.I), 1),
    ("MODEL_NUMBER", re.compile(r"\bmodel\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{2,})\b", re.I), 1),
    ("SUBSCRIPTION_ID", re.compile(r"\bsubscription\s*(?:id|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{3,})\b", re.I), 1),
    ("ACCOUNT_ID", re.compile(r"\baccount\s*(?:id|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{3,})\b", re.I), 1),
    ("ERROR_CODE", re.compile(r"\b(?:error|code)\s*(?:code)?\s*[:#-]?\s*([A-Z]{1,8}[-_]\d{2,}|\d{3,})\b", re.I), 1),
]

AMOUNT_RE = re.compile(r"(?<!\w)(₹|INR\s?|Rs\.?\s?|\$|USD\s?|€|EUR\s?|£|GBP\s?)\s*([0-9]+(?:,[0-9]{3})*(?:\.\d{1,2})?)(?!\w)", re.I)
QUANTITY_RE = re.compile(r"\b(?:quantity|qty|order|buy|need|want)\s*(?:of)?\s*(\d{1,4})\s*(?:x|pieces?|items?)?\b", re.I)
DATE_RE = re.compile(r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b")
TIME_RE = re.compile(r"\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:AM|PM)?\b|\b(?:1[0-2]|0?[1-9])\s*(?:AM|PM)\b", re.I)


def _entity(entity_type: str, value: str, normalized: str | None = None) -> dict[str, Any]:
    return {
        "entity_type": entity_type,
        "value": value.strip(),
        "normalized_value": normalized,
        "confidence": 0.99,
        "extraction_method": "rules",
        "validation_status": "unverified",
    }


def extract_rule_entities(message: str, domain: str = "general") -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(item: dict[str, Any]) -> None:
        key = (item["entity_type"], item["value"].casefold())
        if key not in seen:
            found.append(item)
            seen.add(key)

    for entity_type, pattern, group in PATTERNS:
        for match in pattern.finditer(message):
            value = match.group(group) if group else match.group(0)
            normalized = value.strip().lower() if entity_type == "EMAIL_ADDRESS" else value.strip()
            add(_entity(entity_type, value, normalized))

    for match in AMOUNT_RE.finditer(message):
        currency = match.group(1).strip()
        amount = match.group(2).replace(",", "")
        add(_entity("AMOUNT", match.group(0), f"{currency} {amount}".strip()))
        currency_name = {"₹": "INR", "$": "USD", "€": "EUR", "£": "GBP"}.get(currency, currency.upper().replace(".", "").strip())
        add(_entity("CURRENCY", currency, currency_name))

    for match in QUANTITY_RE.finditer(message):
        add(_entity("QUANTITY", match.group(1), str(int(match.group(1)))))
    for match in DATE_RE.finditer(message):
        add(_entity("DATE", match.group(0)))
    for match in TIME_RE.finditer(message):
        add(_entity("TIME", match.group(0).strip()))

    return found
