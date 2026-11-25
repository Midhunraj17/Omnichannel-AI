from app.services.entity_rules import extract_rule_entities


def by_type(items, entity_type):
    return [item for item in items if item["entity_type"] == entity_type]


def test_extract_email_and_phone():
    items = extract_rule_entities("Email me at alien@example.com or call +91 98765 43210")
    assert by_type(items, "EMAIL_ADDRESS")[0]["normalized_value"] == "alien@example.com"
    assert by_type(items, "PHONE_NUMBER")


def test_extract_order_and_coupon():
    items = extract_rule_entities("My order ID is ORD-12345 and coupon SAVE20")
    assert by_type(items, "ORDER_ID")[0]["value"] == "ORD-12345"
    assert by_type(items, "COUPON_CODE")[0]["value"] == "SAVE20"


def test_extract_amount_currency_date_time_quantity():
    items = extract_rule_entities("I need 2 items for ₹1,299 on 18/11/2026 at 6:30 PM")
    assert by_type(items, "AMOUNT")
    assert by_type(items, "CURRENCY")[0]["normalized_value"] == "INR"
    assert by_type(items, "DATE")[0]["value"] == "18/11/2026"
    assert by_type(items, "TIME")
    assert by_type(items, "QUANTITY")[0]["normalized_value"] == "2"


def test_all_rule_entities_are_unverified_candidates():
    items = extract_rule_entities("Order ORD-12345")
    assert items
    assert all(item["validation_status"] == "unverified" for item in items)
