from app.services.ticket_triage import (
    triage_ticket,
)


def test_classifies_technical_issue():

    result = triage_ticket(

        primary_intent="TECHNICAL_ISSUE",

        intents=["TECHNICAL_ISSUE"],

        message="The application keeps crashing.",

    )

    assert result.category == "TECHNICAL"

    assert result.subcategory == "technical_failure"

    assert "technical" in result.labels


def test_classifies_product_issue():

    result = triage_ticket(

        primary_intent="PRODUCT_ISSUE",

        intents=["PRODUCT_ISSUE"],

        message="The product arrived damaged.",

    )

    assert result.category == "PRODUCT"

    assert result.subcategory == "product_defect"


def test_classifies_service_issue():

    result = triage_ticket(

        primary_intent="SERVICE_ISSUE",

        intents=["SERVICE_ISSUE"],

        message="The service is unavailable.",

    )

    assert result.category == "SERVICE"

    assert result.subcategory == "service_unavailable"


def test_classifies_order_cancellation():

    result = triage_ticket(

        primary_intent="CANCELLATION_REQUEST",

        intents=["CANCELLATION_REQUEST"],

        message="Please cancel my order.",

    )

    assert result.category == "ORDER"

    assert result.subcategory == "cancellation"


def test_classifies_customer_feedback():

    result = triage_ticket(

        primary_intent="FEEDBACK",

        intents=["FEEDBACK"],

        message="I appreciate your excellent service.",

    )

    assert result.category == "OTHER"

    assert result.subcategory == "customer_feedback"


def test_multiple_issues_are_limited():

    intents = [
        "PAYMENT_ISSUE",
        "REFUND_REQUEST",
        "ORDER_STATUS",
        "ACCOUNT_ACCESS_ISSUE",
        "TECHNICAL_ISSUE",
        "PRODUCT_ISSUE",
        "SERVICE_ISSUE",
        "COMPLAINT",
        "RETURN_REQUEST",
        "PASSWORD_RESET",
        "CANCELLATION_REQUEST",
    ]

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=intents,

        message="I have several problems.",

    )

    assert len(result.issues) <= 10


def test_confidence_never_exceeds_one():

    result = triage_ticket(

        primary_intent="PAYMENT_ISSUE",

        intents=["PAYMENT_ISSUE"],

        message="Payment failed.",

        intent_confidence=1.0,

    )

    assert result.confidence <= 1.0


def test_empty_intent_list():

    result = triage_ticket(

        primary_intent="ORDER_STATUS",

        intents=[],

        message="Where is my order?",

    )

    assert result is not None

    assert result.category == "ORDER"