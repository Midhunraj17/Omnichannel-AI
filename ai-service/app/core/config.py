import os

from dotenv import load_dotenv

load_dotenv()


class Settings:

    APP_NAME = os.getenv(
        "APP_NAME",
        "Omnichannel AI Service"
    )

    APP_VERSION = os.getenv(
        "APP_VERSION",
        "1.0.0"
    )

    ENVIRONMENT = os.getenv(
        "ENVIRONMENT",
        "development"
    )

    # Internal service authentication
    AI_SERVICE_API_KEY = os.getenv(
        "AI_SERVICE_API_KEY"
    )

    PORT = int(
        os.getenv("PORT", 8000)
    )

    # Cohere Configuration

    COHERE_API_KEY = os.getenv(
        "COHERE_API_KEY"
    )

    COHERE_CHAT_MODEL = os.getenv(
        "COHERE_CHAT_MODEL",
        "command-a-plus-05-2026"
    )

    COHERE_EMBED_MODEL = os.getenv(
        "COHERE_EMBED_MODEL",
        "embed-v5.0-pro"
    )

    COHERE_RERANK_MODEL = os.getenv(
        "COHERE_RERANK_MODEL",
        "rerank-v5.0-fast"
    )

    COHERE_EMBED_DIMENSION = int(
        os.getenv("COHERE_EMBED_DIMENSION", 1024)
    )

    # Cohere integration settings

    COHERE_TIMEOUT_SECONDS = float(
        os.getenv("COHERE_TIMEOUT_SECONDS", 30)
    )

    COHERE_MAX_RETRIES = int(
        os.getenv("COHERE_MAX_RETRIES", 2)
    )

    COHERE_RETRY_BASE_SECONDS = float(
        os.getenv("COHERE_RETRY_BASE_SECONDS", 0.5)
    )

    COHERE_RETRY_MAX_SECONDS = float(
        os.getenv("COHERE_RETRY_MAX_SECONDS", 4)
    )

    COHERE_MAX_TOKENS = int(
        os.getenv("COHERE_MAX_TOKENS", 800)
    )

    COHERE_TEMPERATURE = float(
        os.getenv("COHERE_TEMPERATURE", 0.3)
    )


settings = Settings()