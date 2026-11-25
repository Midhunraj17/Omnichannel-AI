from __future__ import annotations

import re
from collections.abc import Iterable

from app.schemas.ticket_triage import (
    TicketIssueClassification,
    TicketTriageResult,
)

from app.services.ticket_priority import (
    assess_ticket_priority,
)


# =========================================================
# INTENT MAPPING
# =========================================================

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


# =========================================================
# LABEL RULES
# =========================================================

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
        "crashing",
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


# =========================================================
# SENTIMENT RULES
# =========================================================

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


# =========================================================
# TEXT UTILITIES
# =========================================================

def _normalize(text: str) -> str:
    """Normalize text for deterministic keyword matching."""

    return re.sub(
        r"\s+",
        " ",
        text.casefold(),
    ).strip()


def _contains(text: str, phrase: str) -> bool:
    """Match a phrase without matching partial words."""

    pattern = re.escape(
        phrase.casefold()
    ).replace(
        r"\ ",
        r"\s+",
    )

    return re.search(
        rf"(?<!\w){pattern}(?!\w)",
        text,
    ) is not None


def _matching_terms(
    text: str,
    terms: Iterable[str],
) -> list[str]:
    """Return all matching terms."""

    return [
        term
        for term in terms
        if _contains(text, term)
    ]


# =========================================================
# SENTIMENT ANALYSIS
# =========================================================

def _sentiment(text: str) -> str:
    """Determine basic rule-based customer sentiment."""

    negative = _matching_terms(
        text,
        _NEGATIVE_TERMS,
    )

    positive = _matching_terms(
        text,
        _POSITIVE_TERMS,
    )

    if negative and len(negative) >= len(positive):
        return "NEGATIVE"

    if positive and not negative:
        return "POSITIVE"

    return "NEUTRAL"


# =========================================================
# LABEL EXTRACTION
# =========================================================

def _extract_labels(
    text: str,
    category: str | None = None,
) -> list[str]:
    """Extract deterministic labels from ticket content."""

    labels = []

    for label, terms in LABEL_RULES.items():

        if any(
            _contains(text, term)
            for term in terms
        ):
            labels.append(label)

    if category:

        category_label = category.casefold()

        if category_label not in labels:
            labels.append(category_label)

    # Remove duplicates while preserving insertion order.
    return list(dict.fromkeys(labels))[:20]


# =========================================================
# ISSUE CLASSIFICATION
# =========================================================

def _classify_issue(
    intent: str,
    intent_confidence: float,
    text: str,
) -> TicketIssueClassification:
    """Convert an intent into a structured issue classification."""

    category = CATEGORY_BY_INTENT.get(
        intent,
        "OTHER",
    )

    subcategory = SUBCATEGORY_BY_INTENT.get(
        intent,
        "general_support",
    )

    labels = _extract_labels(
        text,
        category,
    )

    confidence = max(
        0.0,
        min(1.0, intent_confidence),
    )

    if labels:
        confidence = min(
            0.99,
            confidence + 0.03,
        )

    if intent in {"UNKNOWN", "AMBIGUOUS"}:
        confidence = min(
            confidence,
            0.30,
        )

    return TicketIssueClassification(
        category=category,
        subcategory=subcategory,
        confidence=confidence,
        labels=labels,
    )


# =========================================================
# MAIN TICKET TRIAGE ENGINE
# =========================================================

def triage_ticket(
    *,
    primary_intent: str,
    intents: list[str] | None,
    message: str,
    intent_confidence: float = 0.90,
    intent_method: str = "rules",
) -> TicketTriageResult | None:
    """
    Perform hybrid ticket classification and priority assessment.

    Responsibilities:
        1. Validate support intents.
        2. Classify the primary issue.
        3. Identify additional issue categories.
        4. Assess customer sentiment.
        5. Calculate priority and severity.
        6. Determine SLA and escalation requirements.
        7. Flag tickets requiring human review.

    This engine does not create tickets, assign agents,
    or execute escalation actions.
    """

    # -----------------------------------------------------
    # 1. VALIDATE SUPPORT INTENTS
    # -----------------------------------------------------

    names = set(intents or [])

    names.add(primary_intent)

    support_names = names.intersection(
        SUPPORT_INTENTS
    )

    if not support_names:
        return None

    # -----------------------------------------------------
    # 2. NORMALIZE INPUT
    # -----------------------------------------------------

    text = _normalize(message or "")

    if primary_intent not in CATEGORY_BY_INTENT:

        primary_intent = sorted(
            support_names
        )[0]

    try:
        confidence = max(
            0.0,
            min(1.0, float(intent_confidence)),
        )

    except (TypeError, ValueError):
        confidence = 0.0

    # -----------------------------------------------------
    # 3. PRIMARY ISSUE CLASSIFICATION
    # -----------------------------------------------------

    primary_issue = _classify_issue(
        primary_intent,
        confidence,
        text,
    )

    # -----------------------------------------------------
    # 4. ADDITIONAL ISSUE CLASSIFICATION
    # -----------------------------------------------------

    additional_issues = []

    for intent in sorted(support_names):

        if intent == primary_intent:
            continue

        issue = _classify_issue(
            intent,
            confidence,
            text,
        )

        if issue.category != primary_issue.category:
            additional_issues.append(issue)

    issues = [
        primary_issue,
        *additional_issues,
    ][:10]

    # -----------------------------------------------------
    # 5. PRIORITY AND SEVERITY ASSESSMENT
    # -----------------------------------------------------

    assessment = assess_ticket_priority(
        message=text,
        category=primary_issue.category,
    )

    # -----------------------------------------------------
    # 6. HUMAN REVIEW REQUIREMENT
    # -----------------------------------------------------

    requires_human_review = (
        primary_issue.confidence < 0.60
        or primary_intent in {
            "UNKNOWN",
            "AMBIGUOUS",
        }
    )

    # -----------------------------------------------------
    # 7. CLASSIFICATION METHOD
    # -----------------------------------------------------

    method = (intent_method or "rules").casefold()

    classification_method = (
        "hybrid"
        if method == "cohere"
        else "rules"
    )

    # -----------------------------------------------------
    # 8. PRIORITY REASON GENERATION
    # -----------------------------------------------------

    reason = (
        f"Support intent classified as {primary_intent}. "
        f"Category: {primary_issue.category}. "
        f"Subcategory: {primary_issue.subcategory}. "
        f"Impact: {assessment.impact_level}/5. "
        f"Urgency: {assessment.urgency_level}/5. "
        f"Priority score: {assessment.priority_score}/100. "
        f"Priority: {assessment.priority}."
    )

    # -----------------------------------------------------
    # 9. FINAL TRIAGE RESULT
    # -----------------------------------------------------

    return TicketTriageResult(
        category=primary_issue.category,

        subcategory=primary_issue.subcategory,

        priority=assessment.priority,

        priority_score=assessment.priority_score,

        severity=assessment.severity,

        impact_level=assessment.impact_level,

        urgency_level=assessment.urgency_level,

        sentiment=_sentiment(text),

        urgency_signals=assessment.reason_codes,

        priority_reason_codes=assessment.reason_codes,

        reason=reason[:500],

        classification_method=classification_method,

        confidence=primary_issue.confidence,

        labels=_extract_labels(
            text,
            primary_issue.category,
        ),

        issues=issues,

        requires_human_review=requires_human_review,

        escalation_required=assessment.escalation_required,

        first_response_sla_hours=(
            assessment.first_response_sla_hours
        ),

        resolution_sla_hours=(
            assessment.resolution_sla_hours
        ),

        suggested_sla_hours=(
            assessment.suggested_sla_hours
        ),
    )
