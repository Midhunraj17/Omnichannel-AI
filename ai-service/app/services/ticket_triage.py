"""Deterministic support-ticket classification and priority scoring.

This module only produces triage metadata. It never creates tickets, contacts
customers, changes orders, or assigns agents. Those actions belong to the
authenticated backend workflow.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

from app.schemas.ticket_triage import TicketTriageResult

_CATEGORY_BY_INTENT = {
    "ORDER_TRACKING": "ORDER",
    "ORDER_STATUS": "ORDER",
    "CANCELLATION_REQUEST": "ORDER",
    "PAYMENT_ISSUE": "PAYMENT",
    "PAYMENT_STATUS": "PAYMENT",
    "REFUND_REQUEST": "REFUND",
    "RETURN_REQUEST": "RETURN",
    "ACCOUNT_ACCESS_ISSUE": "ACCOUNT",
    "PASSWORD_RESET": "ACCOUNT",
    "TECHNICAL_ISSUE": "TECHNICAL",
    "PRODUCT_ISSUE": "PRODUCT",
    "SERVICE_ISSUE": "SERVICE",
    "COMPLAINT": "COMPLAINT",
    "TICKET_CREATE": "OTHER",
    "TICKET_UPDATE": "OTHER",
    "TICKET_STATUS": "OTHER",
    "FEEDBACK": "OTHER",
}

_SUPPORT_INTENTS = set(_CATEGORY_BY_INTENT)

_CRITICAL_TERMS = (
    "account hacked", "data breach", "security breach", "fraud",
    "unauthorized access", "cannot access critical", "business is down",
    "system is down", "payment fraud",
)
_HIGH_TERMS = (
    "urgent", "immediately", "asap", "right now", "multiple times",
    "charged twice", "money deducted", "service unavailable",
    "completely broken", "cannot work", "deadline","service is unavailable",
)
_NEGATIVE_TERMS = (
    "angry", "disappointed", "terrible", "unacceptable", "frustrated",
    "upset", "worst", "broken", "failed", "not working", "complaint",
    "scam", "fraud", "poor service",
)
_POSITIVE_TERMS = ("thank you", "thanks", "great", "excellent", "happy", "appreciate")

_SLA_HOURS = {
    "P1_CRITICAL": 1,
    "P2_HIGH": 4,
    "P3_NORMAL": 24,
    "P4_LOW": 72,
}


def _contains(text: str, phrase: str) -> bool:
    pattern = re.escape(phrase).replace(r"\ ", r"\s+")
    return re.search(rf"(?<!\w){pattern}(?!\w)", text) is not None


def _matching_terms(text: str, terms: Iterable[str]) -> list[str]:
    return [term for term in terms if _contains(text, term)]


def _sentiment(text: str) -> str:
    negative = _matching_terms(text, _NEGATIVE_TERMS)
    positive = _matching_terms(text, _POSITIVE_TERMS)
    if negative and len(negative) >= len(positive):
        return "NEGATIVE"
    if positive and not negative:
        return "POSITIVE"
    return "NEUTRAL"


def triage_ticket(
    *,
    primary_intent: str,
    intents: list[str] | None,
    message: str,
) -> TicketTriageResult | None:
    """Return triage only when the classified request belongs to support.

    Scoring is explainable and bounded:
      base 25 + urgency signals + negative sentiment + critical security terms.
    Priority thresholds: P1 >= 80, P2 >= 60, P3 >= 30, otherwise P4.
    """
    names = set(intents or [])
    names.add(primary_intent)
    support_names = names.intersection(_SUPPORT_INTENTS)
    if not support_names:
        return None

    # Prefer the primary intent's category; otherwise use the first supported one.
    category = _CATEGORY_BY_INTENT.get(primary_intent)
    if category is None:
        category = _CATEGORY_BY_INTENT[sorted(support_names)[0]]

    text = re.sub(r"\s+", " ", message.casefold()).strip()
    critical = _matching_terms(text, _CRITICAL_TERMS)
    high = _matching_terms(text, _HIGH_TERMS)
    negative = _matching_terms(text, _NEGATIVE_TERMS)

    score = 30
    signals: list[str] = []

    if critical:
        score += 55
        signals.extend(f"critical:{term}" for term in critical)
    if high:
        score += min(30, 15 + (5 * (len(high) - 1)))
        signals.extend(f"urgent:{term}" for term in high)
    if negative:
        score += min(14, 8 + (2 * (len(negative) - 1)))
        signals.append("negative_customer_sentiment")

    # Complaints and payment failures need additional attention, but do not
    # become critical without an explicit critical-risk signal.
    if primary_intent in {"COMPLAINT", "PAYMENT_ISSUE"}:
        score += 12
        signals.append("sensitive_support_category")

    score = min(100, score)
    if score >= 80:
        priority, severity = "P1_CRITICAL", "CRITICAL"
    elif score >= 60:
        priority, severity = "P2_HIGH", "HIGH"
    elif score >= 30:
        priority, severity = "P3_NORMAL", "MEDIUM"
    else:
        priority, severity = "P4_LOW", "LOW"

    sentiment = _sentiment(text)
    reason_parts = [f"Support intent classified as {primary_intent}."]
    if signals:
        reason_parts.append("Signals: " + ", ".join(signals) + ".")
    else:
        reason_parts.append("No explicit urgency signals detected.")
    reason_parts.append(f"Rule-based priority score: {score}/100.")

    return TicketTriageResult(
        category=category,
        priority=priority,
        priority_score=score,
        severity=severity,
        sentiment=sentiment,
        urgency_signals=signals,
        reason=" ".join(reason_parts)[:500],
        suggested_sla_hours=_SLA_HOURS[priority],
    )
