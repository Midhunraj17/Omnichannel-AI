"""Advanced hybrid support-ticket classification and triage."""

from __future__ import annotations

import re

from collections.abc import Iterable

from app.schemas.ticket_triage import (
    TicketIssueClassification,
    TicketTriageResult,
)


# =====================================================
# INTENT → CATEGORY MAPPING
# =====================================================

CATEGORY_BY_INTENT = {

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
    "FEEDBACK": "OTHER",

    "TICKET_CREATE": "OTHER",
    "TICKET_UPDATE": "OTHER",
    "TICKET_STATUS": "OTHER",
}


SUPPORT_INTENTS = set(CATEGORY_BY_INTENT)


# =====================================================
# SUBCATEGORY TAXONOMY
# =====================================================

SUBCATEGORY_BY_INTENT = {

    "ORDER_TRACKING": "tracking",
    "ORDER_STATUS": "status",
    "CANCELLATION_REQUEST": "cancellation",

    "PAYMENT_ISSUE": "payment_failure",
    "PAYMENT_STATUS": "payment_status",

    "REFUND_REQUEST": "refund_request",
    "RETURN_REQUEST": "return_request",

    "ACCOUNT_ACCESS_ISSUE": "account_access",
    "PASSWORD_RESET": "password_reset",

    "TECHNICAL_ISSUE": "technical_failure",
    "PRODUCT_ISSUE": "product_defect",
    "SERVICE_ISSUE": "service_unavailable",

    "COMPLAINT": "service_complaint",
    "FEEDBACK": "customer_feedback",

    "TICKET_CREATE": "general_support",
    "TICKET_UPDATE": "ticket_update",
    "TICKET_STATUS": "ticket_status",
}


# =====================================================
# KEYWORD LABELS
# =====================================================

LABEL_RULES = {

    "payment": [
        "payment",
        "transaction",
        "charged",
        "money deducted",
    ],

    "refund": [
        "refund",
        "money back",
        "reimbursement",
    ],

    "delivery": [
        "delivery",
        "shipment",
        "shipping",
        "package",
    ],

    "order": [
        "order",
        "purchase",
        "tracking",
    ],

    "account": [
        "account",
        "login",
        "password",
        "authentication",
    ],

    "technical": [
        "bug",
        "crash",
        "error",
        "not working",
        "api",
    ],

    "product": [
        "product",
        "defective",
        "damaged",
        "broken",
    ],

    "service": [
        "service",
        "unavailable",
        "downtime",
    ],

    "complaint": [
        "complaint",
        "unacceptable",
        "disappointed",
    ],

}


# =====================================================
# PRIORITY SIGNALS
# =====================================================

_CRITICAL_TERMS = (
    "account hacked",
    "data breach",
    "security breach",
    "fraud",
    "unauthorized access",
    "business is down",
    "system is down",
    "payment fraud",
)

_HIGH_TERMS = (
    "urgent",
    "immediately",
    "asap",
    "right now",
    "multiple times",
    "charged twice",
    "money deducted",
    "service unavailable",
    "completely broken",
    "cannot work",
    "deadline",
    "service is unavailable",
)

_NEGATIVE_TERMS = (
    "angry",
    "disappointed",
    "terrible",
    "unacceptable",
    "frustrated",
    "upset",
    "worst",
    "broken",
    "failed",
    "not working",
    "complaint",
    "scam",
    "fraud",
    "poor service",
)

_POSITIVE_TERMS = (
    "thank you",
    "thanks",
    "great",
    "excellent",
    "happy",
    "appreciate",
)


_SLA_HOURS = {

    "P1_CRITICAL": 1,
    "P2_HIGH": 4,
    "P3_NORMAL": 24,
    "P4_LOW": 72,

}


# =====================================================
# TEXT UTILITIES
# =====================================================

def _normalize(text: str) -> str:

    return re.sub(
        r"\s+",
        " ",
        text.casefold()
    ).strip()


def _contains(text: str, phrase: str) -> bool:

    pattern = re.escape(
        phrase.casefold()
    ).replace(
        r"\ ",
        r"\s+"
    )

    return re.search(
        rf"(?<!\w){pattern}(?!\w)",
        text
    ) is not None


def _matching_terms(
    text: str,
    terms: Iterable[str]
) -> list[str]:

    return [
        term
        for term in terms
        if _contains(text, term)
    ]


# =====================================================
# SENTIMENT CLASSIFICATION
# =====================================================

def _sentiment(text: str) -> str:

    negative = _matching_terms(
        text,
        _NEGATIVE_TERMS
    )

    positive = _matching_terms(
        text,
        _POSITIVE_TERMS
    )

    if negative and len(negative) >= len(positive):

        return "NEGATIVE"

    if positive and not negative:

        return "POSITIVE"

    return "NEUTRAL"


# =====================================================
# LABEL EXTRACTION
# =====================================================

def _extract_labels(
    text: str,
    category: str | None = None
) -> list[str]:

    labels = []

    # Extract keyword-based labels.

    for label, terms in LABEL_RULES.items():

        if any(
            _contains(text, term)
            for term in terms
        ):

            labels.append(label)

    # Add the classification category as a label.

    if category:

        category_label = category.casefold()

        if category_label not in labels:

            labels.append(category_label)

    # Remove duplicates while preserving order.

    return list(dict.fromkeys(labels))[:20]


# =====================================================
# CATEGORY CLASSIFICATION
# =====================================================

def _classify_issue(
    intent: str,
    intent_confidence: float,
    text: str,
) -> TicketIssueClassification:

    category = CATEGORY_BY_INTENT.get(
        intent,
        "OTHER"
    )

    subcategory = SUBCATEGORY_BY_INTENT.get(
        intent,
        "general_support"
    )

    labels = _extract_labels(
        text,
        category
    )

    confidence = max(
        0.0,
        min(1.0, intent_confidence)
    )

    # A recognized intent provides the base category.
    # Explicit keyword matches strengthen the result.

    if labels:

        confidence = min(
            0.99,
            confidence + 0.03
        )

    if intent in {"UNKNOWN", "AMBIGUOUS"}:

        confidence = min(
            confidence,
            0.30
        )

    return TicketIssueClassification(

        category=category,

        subcategory=subcategory,

        confidence=confidence,

        labels=labels

    )


# =====================================================
# MAIN CLASSIFICATION ENGINE
# =====================================================

def triage_ticket(
    *,
    primary_intent: str,
    intents: list[str] | None,
    message: str,
    intent_confidence: float = 0.90,
    intent_method: str = "rules",
) -> TicketTriageResult | None:

    """
    Classify a support request.

    Classification combines:

      1. Intent classification output.
      2. Deterministic support taxonomy.
      3. Keyword-based labels.
      4. Confidence estimation.
      5. Priority and severity scoring.

    If the upstream intent classifier used Cohere,
    the classification method is reported as hybrid.

    No business action is executed here.
    """

    # -------------------------------------------------
    # 1. IDENTIFY SUPPORT INTENTS
    # -------------------------------------------------

    names = set(intents or [])

    names.add(primary_intent)

    support_names = names.intersection(
        SUPPORT_INTENTS
    )

    if not support_names:

        return None

    text = _normalize(message)


    # -------------------------------------------------
    # 2. PRIMARY ISSUE
    # -------------------------------------------------

    primary_category = CATEGORY_BY_INTENT.get(
        primary_intent
    )

    if primary_category is None:

        primary_intent = sorted(support_names)[0]

        primary_category = CATEGORY_BY_INTENT[
            primary_intent
        ]


    # -------------------------------------------------
    # 3. CONFIDENCE
    # -------------------------------------------------

    try:

        confidence = max(
            0.0,
            min(1.0, float(intent_confidence))
        )

    except (TypeError, ValueError):

        confidence = 0.0


    # -------------------------------------------------
    # 4. PRIMARY CLASSIFICATION
    # -------------------------------------------------

    primary_issue = _classify_issue(

        primary_intent,

        confidence,

        text

    )


    # -------------------------------------------------
    # 5. MULTI-ISSUE CLASSIFICATION
    # -------------------------------------------------

    additional_issues = []

    for intent in sorted(support_names):

        if intent == primary_intent:

            continue

        issue = _classify_issue(

            intent,

            confidence,

            text

        )

        # Avoid duplicate categories.

        if issue.category != primary_issue.category:

            additional_issues.append(issue)

    issues = [
        primary_issue,
        *additional_issues
    ][:10]


    # -------------------------------------------------
    # 6. PRIORITY SCORING
    # -------------------------------------------------

    critical = _matching_terms(
        text,
        _CRITICAL_TERMS
    )

    high = _matching_terms(
        text,
        _HIGH_TERMS
    )

    negative = _matching_terms(
        text,
        _NEGATIVE_TERMS
    )

    score = 30

    signals = []

    # Critical signals.

    if critical:

        score += 55

        signals.extend(
            f"critical:{term}"
            for term in critical
        )

    # High urgency signals.

    if high:

        score += min(
            30,
            15 + 5 * (len(high) - 1)
        )

        signals.extend(
            f"urgent:{term}"
            for term in high
        )

    # Negative sentiment signals.

    if negative:

        score += min(
            14,
            8 + 2 * (len(negative) - 1)
        )

        signals.append(
            "negative_customer_sentiment"
        )

    # Sensitive support categories.

    if primary_intent in {
        "COMPLAINT",
        "PAYMENT_ISSUE"
    }:

        score += 12

        signals.append(
            "sensitive_support_category"
        )

    score = min(
        100,
        score
    )


    # -------------------------------------------------
    # 7. PRIORITY AND SEVERITY
    # -------------------------------------------------

    if score >= 80:

        priority = "P1_CRITICAL"

        severity = "CRITICAL"

    elif score >= 60:

        priority = "P2_HIGH"

        severity = "HIGH"

    elif score >= 30:

        priority = "P3_NORMAL"

        severity = "MEDIUM"

    else:

        priority = "P4_LOW"

        severity = "LOW"


    # -------------------------------------------------
    # 8. HUMAN REVIEW
    # -------------------------------------------------

    requires_human_review = (

        primary_issue.confidence < 0.60

        or primary_intent in {
            "UNKNOWN",
            "AMBIGUOUS"
        }

    )


    # -------------------------------------------------
    # 9. CLASSIFICATION METHOD
    # -------------------------------------------------

    classification_method = (

        "hybrid"

        if intent_method.casefold() == "cohere"

        else "rules"

    )


    # -------------------------------------------------
    # 10. REASON GENERATION
    # -------------------------------------------------

    reason_parts = [

        f"Support intent classified as {primary_intent}.",

        f"Category: {primary_category}.",

        f"Subcategory: {primary_issue.subcategory}.",

    ]

    if signals:

        reason_parts.append(
            "Signals: " + ", ".join(signals) + "."
        )

    else:

        reason_parts.append(
            "No explicit urgency signals detected."
        )

    reason_parts.append(
        f"Priority score: {score}/100."
    )


    # -------------------------------------------------
    # 11. FINAL RESULT
    # -------------------------------------------------

    return TicketTriageResult(

        category=primary_issue.category,

        subcategory=primary_issue.subcategory,

        priority=priority,

        priority_score=score,

        severity=severity,

        sentiment=_sentiment(text),

        urgency_signals=signals,

        reason=" ".join(reason_parts)[:500],

        classification_method=classification_method,

        confidence=primary_issue.confidence,

        labels=_extract_labels(
            text,
            primary_issue.category
        ),

        issues=issues,

        requires_human_review=requires_human_review,

        suggested_sla_hours=_SLA_HOURS[priority],

    )