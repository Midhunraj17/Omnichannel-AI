"""Deterministic ticket impact, urgency, priority and SLA engine."""

from __future__ import annotations

import re

from collections.abc import Iterable
from dataclasses import dataclass


# =====================================================
# IMPACT TAXONOMY
# =====================================================

CRITICAL_IMPACT_TERMS = (
    "data breach",
    "security breach",
    "account hacked",
    "account was hacked",
    "hacked account",
    "account compromised",
    "account taken over",
    "unauthorized access",
    "unauthorised access",
    "payment fraud",
    "business is down",
    "system is down",
    "production is down",
    "all users affected",
    "data loss",
)

HIGH_IMPACT_TERMS = (
    "service unavailable",
    "service is unavailable",
    "multiple customers",
    "multiple users",
    "entire team",
    "charged twice",
    "completely broken",
    "cannot work",
    "cannot access",
    "application keeps crashing",
)

MEDIUM_IMPACT_TERMS = (
    "not working",
    "failed",
    "crashing",
    "damaged",
    "broken",
    "payment failed",
    "login problem",
)


# =====================================================
# URGENCY TAXONOMY
# =====================================================

CRITICAL_URGENCY_TERMS = (
    "immediately",
    "right now",
    "asap",
    "urgent",
    "emergency",
    "critical",
    "deadline today",
)

HIGH_URGENCY_TERMS = (
    "today",
    "time sensitive",
    "cannot proceed",
    "blocked",
    "deadline",
    "multiple times",
    "soon",
)

LOW_URGENCY_TERMS = (
    "whenever possible",
    "no rush",
    "not urgent",
    "when convenient",
)


# =====================================================
# CATEGORY DEFAULT IMPACT
# =====================================================

CATEGORY_DEFAULT_IMPACT = {

    "ORDER": 2,
    "PAYMENT": 3,
    "REFUND": 2,
    "RETURN": 2,
    "ACCOUNT": 3,
    "TECHNICAL": 3,
    "PRODUCT": 2,
    "SERVICE": 3,
    "COMPLAINT": 3,
    "OTHER": 2,

}


# =====================================================
# SLA CONFIGURATION
# =====================================================

PRIORITY_CONFIG = {

    "P1_CRITICAL": {
        "first_response": 1,
        "resolution": 4,
    },

    "P2_HIGH": {
        "first_response": 4,
        "resolution": 12,
    },

    "P3_NORMAL": {
        "first_response": 24,
        "resolution": 72,
    },

    "P4_LOW": {
        "first_response": 72,
        "resolution": 120,
    },

}


VALID_CATEGORIES = frozenset(
    CATEGORY_DEFAULT_IMPACT
)


# =====================================================
# RESULT MODEL
# =====================================================

@dataclass(frozen=True)
class PriorityAssessment:

    impact_level: int

    urgency_level: int

    priority_score: int

    priority: str

    severity: str

    first_response_sla_hours: int

    resolution_sla_hours: int

    escalation_required: bool

    reason_codes: list[str]

    suggested_sla_hours: int


# =====================================================
# TEXT UTILITIES
# =====================================================

def _normalize(text: str) -> str:

    if not isinstance(text, str):
        raise TypeError("Ticket message must be a string.")

    return re.sub(
        r"\s+",
        " ",
        text.casefold()
    ).strip()


def _contains(
    text: str,
    phrase: str,
) -> bool:

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
    terms: Iterable[str],
) -> list[str]:

    return [
        term
        for term in terms
        if _contains(text, term)
    ]


# =====================================================
# NEGATION HANDLING
# =====================================================

_NEGATION_PATTERN = re.compile(
    r"\b(?:not|no|never|without|isn't|aren't|wasn't|weren't|"
    r"don't|doesn't|didn't|cannot|can't)\b",
    re.IGNORECASE,
)


def _is_negated(
    text: str,
    phrase: str,
) -> bool:

    """
    Check whether a matching phrase is preceded
    by a negation within a short context window.
    """

    pattern = re.compile(
        rf"(?<!\w){re.escape(phrase).replace(r'\ ', r'\s+')}(?!\w)",
        re.IGNORECASE,
    )

    for match in pattern.finditer(text):

        preceding_text = text[
            max(0, match.start() - 35):
            match.start()
        ]

        if _NEGATION_PATTERN.search(preceding_text):

            return True

    return False


def _matching_unnegated_terms(
    text: str,
    terms: Iterable[str],
) -> list[str]:

    return [
        term
        for term in terms
        if (
            _contains(text, term)
            and not _is_negated(text, term)
        )
    ]


# =====================================================
# IMPACT ASSESSMENT
# =====================================================

def assess_impact(
    text: str,
    category: str,
) -> tuple[int, list[str]]:

    """Estimate business impact on a 1–5 scale."""

    critical = _matching_unnegated_terms(
        text,
        CRITICAL_IMPACT_TERMS
    )

    high = _matching_unnegated_terms(
        text,
        HIGH_IMPACT_TERMS
    )

    medium = _matching_unnegated_terms(
        text,
        MEDIUM_IMPACT_TERMS
    )

    if critical:

        return 5, [
            f"impact:critical:{term}"
            for term in critical
        ]

    if high:

        return 4, [
            f"impact:high:{term}"
            for term in high
        ]

    if medium:

        return 3, [
            f"impact:medium:{term}"
            for term in medium
        ]

    normalized_category = category.upper()

    default = CATEGORY_DEFAULT_IMPACT.get(
        normalized_category,
        CATEGORY_DEFAULT_IMPACT["OTHER"]
    )

    return default, [
        f"impact:category_default:{normalized_category.lower()}"
    ]


# =====================================================
# URGENCY ASSESSMENT
# =====================================================

def assess_urgency(
    text: str,
) -> tuple[int, list[str]]:

    """Estimate time sensitivity on a 1–5 scale."""

    # Explicit low-urgency statements take precedence.
    # Example: "This is not urgent."

    low = _matching_terms(
        text,
        LOW_URGENCY_TERMS
    )

    if low:

        return 1, [
            f"urgency:low:{term}"
            for term in low
        ]

    critical = _matching_unnegated_terms(
        text,
        CRITICAL_URGENCY_TERMS
    )

    high = _matching_unnegated_terms(
        text,
        HIGH_URGENCY_TERMS
    )

    if critical:

        return 5, [
            f"urgency:critical:{term}"
            for term in critical
        ]

    if high:

        return 4, [
            f"urgency:high:{term}"
            for term in high
        ]

    return 3, [
        "urgency:normal"
    ]


# =====================================================
# PRIORITY CALCULATION
# =====================================================

def calculate_priority(
    impact_level: int,
    urgency_level: int,
) -> int:

    """Calculate a bounded priority score."""

    if not 1 <= impact_level <= 5:

        raise ValueError(
            "Impact must be between 1 and 5."
        )

    if not 1 <= urgency_level <= 5:

        raise ValueError(
            "Urgency must be between 1 and 5."
        )

    return min(
        100,
        10 + (4 * impact_level * urgency_level)
    )


# =====================================================
# PRIORITY DETERMINATION
# =====================================================

def determine_priority(
    score: int,
) -> str:

    if not isinstance(score, int) or isinstance(score, bool):

        raise ValueError(
            "Priority score must be an integer."
        )

    if not 0 <= score <= 100:

        raise ValueError(
            "Priority score must be between 0 and 100."
        )

    if score >= 80:

        return "P1_CRITICAL"

    if score >= 60:

        return "P2_HIGH"

    if score >= 30:

        return "P3_NORMAL"

    return "P4_LOW"


# =====================================================
# SEVERITY DETERMINATION
# =====================================================

def determine_severity(
    impact_level: int,
) -> str:

    if not isinstance(impact_level, int) or isinstance(impact_level, bool):

        raise ValueError(
            "Impact level must be an integer."
        )

    if not 1 <= impact_level <= 5:

        raise ValueError(
            "Impact must be between 1 and 5."
        )

    if impact_level == 5:

        return "CRITICAL"

    if impact_level == 4:

        return "HIGH"

    if impact_level == 3:

        return "MEDIUM"

    return "LOW"


# =====================================================
# MAIN PRIORITY ENGINE
# =====================================================

def assess_ticket_priority(
    *,
    message: str,
    category: str,
) -> PriorityAssessment:

    """
    Perform deterministic ticket priority assessment.

    Pipeline:

        1. Normalize message.
        2. Assess business impact.
        3. Assess urgency.
        4. Calculate priority score.
        5. Determine priority.
        6. Determine severity.
        7. Resolve SLA configuration.
        8. Determine escalation requirements.
        9. Generate reason codes.

    This engine does not execute business actions.
    """

    # -------------------------------------------------
    # 1. INPUT VALIDATION
    # -------------------------------------------------

    if not isinstance(message, str):

        raise TypeError(
            "Ticket message must be a string."
        )

    if not isinstance(category, str):

        raise TypeError(
            "Ticket category must be a string."
        )

    # -------------------------------------------------
    # 2. NORMALIZATION
    # -------------------------------------------------

    text = _normalize(message)

    normalized_category = category.strip().upper()

    # -------------------------------------------------
    # 3. IMPACT ASSESSMENT
    # -------------------------------------------------

    impact, impact_reasons = assess_impact(
        text,
        normalized_category
    )

    # -------------------------------------------------
    # 4. URGENCY ASSESSMENT
    # -------------------------------------------------

    urgency, urgency_reasons = assess_urgency(
        text
    )

    # -------------------------------------------------
    # 5. PRIORITY SCORE
    # -------------------------------------------------

    score = calculate_priority(
    impact,
    urgency
)

# Critical business-impact override.
# Security incidents and other critical-impact events
# must receive P1 regardless of explicit urgency wording.

    if impact == 5:

        score = max(score, 80)

        priority = "P1_CRITICAL"

    else:

        priority = determine_priority(score)    

    # -------------------------------------------------
    # 6. PRIORITY
    # -------------------------------------------------

    priority = determine_priority(
        score
    )

    # -------------------------------------------------
    # 7. SEVERITY
    # -------------------------------------------------

    severity = determine_severity(
        impact
    )

    # -------------------------------------------------
    # 8. SLA CONFIGURATION
    # -------------------------------------------------

    sla = PRIORITY_CONFIG[priority]

    # -------------------------------------------------
    # 9. ESCALATION
    # -------------------------------------------------

    escalation_required = (
        priority in {
            "P1_CRITICAL",
            "P2_HIGH",
        }
        or impact == 5
    )

    # -------------------------------------------------
    # 10. REASON CODES
    # -------------------------------------------------

    reason_codes = [

        *impact_reasons,

        *urgency_reasons,

        f"priority:{priority.lower()}",

        f"severity:{severity.lower()}",

    ]

    if escalation_required:

        reason_codes.append(
            "escalation:required"
        )

    # -------------------------------------------------
    # 11. FINAL RESULT
    # -------------------------------------------------

    return PriorityAssessment(

        impact_level=impact,

        urgency_level=urgency,

        priority_score=score,

        priority=priority,

        severity=severity,

        first_response_sla_hours=sla[
            "first_response"
        ],

        resolution_sla_hours=sla[
            "resolution"
        ],

        escalation_required=escalation_required,

        reason_codes=reason_codes,

        suggested_sla_hours=sla[
            "first_response"
        ],

    )