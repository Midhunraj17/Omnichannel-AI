from app.services.ticket_triage import triage_ticket


def test_non_support_intent_has_no_ticket_triage():

    result = triage_ticket(

        primary_intent="GREETING",

        intents=["GREETING"],

        message="Hello",

    )

    assert result is None


def test_normal_order_status():

    result = triage_ticket(

        primary_intent="ORDER_STATUS",

        intents=["ORDER_STATUS"],

        message="Can you tell me my order status?",

    )

    assert result is not None

    assert result.category == "ORDER"

    assert result.subcategory == "status"

    assert result.priority == "P3_NORMAL"

    assert result.suggested_sla_hours == 24


def test_security_incident_is_critical():

    result = triage_ticket(

        primary_intent="ACCOUNT_ACCESS_ISSUE",

        intents=["ACCOUNT_ACCESS_ISSUE"],

        message=(
            "My account was hacked "
            "and there is unauthorized access."
        ),

    )

    assert result.priority == "P1_CRITICAL"

    assert result.severity == "CRITICAL"

    assert result.priority_score >= 80


def test_urgent_complaint():

    result = triage_ticket(

        primary_intent="COMPLAINT",

        intents=["COMPLAINT"],

        message=(
            "I am frustrated. This is urgent "
            "and the service is unavailable."
        ),

    )

    assert result.priority in {
        "P1_CRITICAL",
        "P2_HIGH"
    }

    assert result.sentiment == "NEGATIVE"


def test_score_is_bounded():

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=["PAYMENT_ISSUE"],

        message=(
            "Fraud! Account hacked! "
            "Unauthorized access! Urgent! " * 10
        ),

    )

    assert 0 <= result.priority_score <= 100


def test_payment_subcategory():

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=["PAYMENT_ISSUE"],

        message="My payment failed.",

    )

    assert result.category == "PAYMENT"

    assert result.subcategory == "payment_failure"

    assert "payment" in result.labels


def test_refund_subcategory():

    result = triage_ticket(

        primary_intent="REFUND_REQUEST",

        intents=["REFUND_REQUEST"],

        message="I want my money back.",

    )

    assert result.category == "REFUND"

    assert result.subcategory == "refund_request"


def test_account_subcategory():

    result = triage_ticket(

        primary_intent="PASSWORD_RESET",

        intents=["PASSWORD_RESET"],

        message="I forgot my password.",

    )

    assert result.category == "ACCOUNT"

    assert result.subcategory == "password_reset"


def test_classification_confidence():

    result = triage_ticket(

        primary_intent="ORDER_TRACKING",

        intents=["ORDER_TRACKING"],

        message="Track my order.",

        intent_confidence=0.95,

    )

    assert result.confidence >= 0.90


def test_human_review_for_low_confidence():

    result = triage_ticket(

        primary_intent="ORDER_TRACKING",

        intents=["ORDER_TRACKING"],

        message="Track my order.",

        intent_confidence=0.30,

    )

    assert result.requires_human_review is True


def test_hybrid_method_when_cohere_used():

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=["PAYMENT_ISSUE"],

        message="Payment failed.",

        intent_method="cohere",

    )

    assert result.classification_method == "hybrid"


def test_rules_method_when_rules_used():

    result = triage_ticket(

        primary_intent="ORDER_STATUS",

        intents=["ORDER_STATUS"],

        message="Where is my order?",

        intent_method="rules",

    )

    assert result.classification_method == "rules"


def test_multiple_support_intents():

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=[
            "PAYMENT_ISSUE",
            "REFUND_REQUEST",
        ],

        message=(
            "My payment failed and "
            "I want a refund."
        ),

    )

    assert result.category == "PAYMENT"

    assert len(result.issues) == 2

    categories = {
        issue.category
        for issue in result.issues
    }

    assert categories == {
        "PAYMENT",
        "REFUND"
    }


def test_labels_are_unique():

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=["PAYMENT_ISSUE"],

        message=(
            "Payment failed. "
            "The transaction failed."
        ),

    )

    assert len(result.labels) == len(
        set(result.labels)
    )


def test_unknown_support_intent_fallback():

    result = triage_ticket(

        primary_intent="TICKET_CREATE",

        intents=["TICKET_CREATE"],

        message="I need some help.",

        intent_confidence=0.45,

    )

    assert result.category == "OTHER"

    assert result.requires_human_review is True