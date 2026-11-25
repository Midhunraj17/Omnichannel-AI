import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings


bearer_scheme = HTTPBearer(auto_error=False)


async def verify_internal_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    """
    Verify that the request originates from an authorized internal service.
    """

    expected_api_key = settings.AI_SERVICE_API_KEY

    # Fail closed if the server has not been configured with a secret.
    if not expected_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal authentication is not configured.",
        )

    # Reject missing or invalid authentication schemes.
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Compare credentials securely.
    if not secrets.compare_digest(
        credentials.credentials,
        expected_api_key,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True