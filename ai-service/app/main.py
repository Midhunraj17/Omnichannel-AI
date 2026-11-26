from fastapi import FastAPI, Depends

from app.core.config import settings
from app.core.security import verify_internal_api_key

from app.api.routes import (
    health,
    chat,
    intent,
    entities,
    routing,
    orchestrator,
    response_generation,
    escalation,
)


# --------------------------------------------------
# FastAPI Application
# --------------------------------------------------

IS_PRODUCTION = settings.ENVIRONMENT.lower() == "production"

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI Processing Service for Omnichannel Customer Support",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)


# --------------------------------------------------
# Public Routes
# --------------------------------------------------

# Health checks remain publicly accessible.
app.include_router(
    health.router,
    prefix="/api/v1",
    tags=["Health"],
)


# --------------------------------------------------
# Protected Internal AI Routes
# --------------------------------------------------

protected_routes = [
    (chat.router, "Chat"),
    (intent.router, "Intent Classification"),
    (entities.router, "Entity Extraction"),
    (routing.router, "Routing"),
    (orchestrator.router, "AI Orchestrator"),
    (response_generation.router, "Response Generation"),
    (escalation.router, "Ticket Escalation"),

]

for router, tag in protected_routes:
    app.include_router(
        router,
        prefix="/api/v1",
        tags=[tag],
        dependencies=[Depends(verify_internal_api_key)],
    )


# --------------------------------------------------
# Root Endpoint
# --------------------------------------------------

@app.get("/")
async def root():
    return {
        "success": True,
        "message": "Welcome to Omnichannel AI Service",
    }