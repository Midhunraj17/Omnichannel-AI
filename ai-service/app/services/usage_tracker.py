"""Cohere usage normalization adapter."""


def _read(obj, key, default=None):
    if obj is None:
        return default

    if isinstance(obj, dict):
        return obj.get(key, default)

    return getattr(obj, key, default)


def extract_usage(response):
    # Current Cohere V2 SDK exposes usage directly.
    usage = _read(response, "usage")

    # Backward compatibility with older response structures.
    if usage is None:
        usage = _read(response, "meta")

    billed = _read(usage, "billed_units")
    tokens = _read(usage, "tokens")

    def number(source, key):
        value = _read(source, key, 0)
        return int(value or 0)

    return {
        "input_tokens": number(tokens, "input_tokens"),
        "output_tokens": number(tokens, "output_tokens"),
        "billed_input_tokens": number(billed, "input_tokens"),
        "billed_output_tokens": number(billed, "output_tokens"),
    }