from app.services.intent_rules import classify_with_rules


def test_greeting_is_classified_by_rules():
    result = classify_with_rules("Hello there!")
    assert result["primary_intent"] == "GREETING"
    assert result["classification_method"] == "rules"


def test_explicit_human_request_sets_handoff_flag():
    result = classify_with_rules("Please connect me to a human agent")
    assert result["primary_intent"] == "HUMAN_HANDOFF"
    assert result["handoff_requested"] is True


def test_order_tracking_is_classified():
    result = classify_with_rules("Where is my order?")
    assert result["primary_intent"] == "ORDER_TRACKING"


def test_unmatched_message_is_delegated_to_semantic_classifier():
    assert classify_with_rules("The item I received does not match the photo") is None


def test_hi_is_not_detected_inside_another_word():
    assert classify_with_rules("This product is great") is None


def test_multiple_rule_intents_are_preserved():
    result = classify_with_rules("I want a refund and I want to complain")
    assert result["primary_intent"] == "REFUND_REQUEST"
    assert {item["name"] for item in result["intents"]} == {"REFUND_REQUEST", "COMPLAINT"}
