import cohere
from app.core.config import settings


def create_cohere_client():
    """Create a Cohere v2 client with a bounded request timeout."""
    api_key = settings.COHERE_API_KEY
    if not api_key:
        raise RuntimeError("COHERE_API_KEY is not configured")

    return cohere.ClientV2(
        api_key=api_key,
        timeout=settings.COHERE_TIMEOUT_SECONDS,
        client_name="omnichannel-ai-support",
    )


_client = None


def get_cohere_client():
    """Create the SDK client lazily so importing the app does not require a key."""
    global _client
    if _client is None:
        _client = create_cohere_client()
    return _client


def set_cohere_client_for_testing(client):
    """Inject a fake client in unit tests."""
    global _client
    _client = client

class LazyCohereClient:
    """Backward-compatible lazy Cohere client proxy."""

    def __getattr__(self, name):
        return getattr(get_cohere_client(), name)


# Backward compatibility for existing services
cohere_client = LazyCohereClient()