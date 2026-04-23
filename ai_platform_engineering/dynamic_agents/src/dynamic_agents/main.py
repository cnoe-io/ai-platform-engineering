"""Dynamic Agents FastAPI Application."""

import asyncio
import os
from contextlib import asynccontextmanager

from dynamic_agents.log_config import setup_logging

# Setup logging before other imports that trigger cnoe-agent-utils
logger = setup_logging()


def fatal_exit(message: str) -> None:
    """Log a critical error and forcefully terminate the process.

    Uses os._exit(1) to bypass exception handlers and ensure immediate termination,
    which is necessary when running under uvicorn with reload mode.
    """
    logger.critical(message)
    os._exit(1)


# ruff: noqa: E402
# Imports must be after logging setup to ensure our format is used
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dynamic_agents.config import get_settings
from dynamic_agents.routes import assistant, builtin_tools, chat, conversations, health, mcp_servers
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.mongo import get_mongo_service, reset_mongo_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    settings = get_settings()
    logger.info("Starting Dynamic Agents service...")

    # MongoDB connection with retry logic
    max_retries = 5
    base_delay = 2  # seconds

    mongo = None
    for attempt in range(max_retries):
        mongo = get_mongo_service()
        if mongo._client is not None:
            logger.info(f"Connected to MongoDB: {settings.mongodb_database}")
            break

        if attempt < max_retries - 1:
            delay = base_delay * (2**attempt)  # 2, 4, 8, 16, 32 seconds
            logger.warning(f"MongoDB connection failed, retrying in {delay}s (attempt {attempt + 1}/{max_retries})...")
            await asyncio.sleep(delay)
            # Reset singleton to allow fresh connection attempt
            reset_mongo_service()
    else:
        # All retries exhausted - crash the service
        fatal_exit(f"Failed to connect to MongoDB after {max_retries} attempts. Service cannot start without MongoDB.")

    yield

    # Cleanup on shutdown
    logger.info("Shutting down Dynamic Agents service...")

    # Clear agent runtime cache
    cache = get_runtime_cache()
    await cache.clear()

    # Disconnect MongoDB
    mongo.disconnect()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Dynamic Agents Service",
        description="Create, configure, and run ephemeral AI agents dynamically",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Spec 102 Phase 8 / T103: validate incoming Bearer JWTs against
    # Keycloak and bind current_user_token so the MCP httpx factory can
    # forward the user identity to agentgateway. Mounted AFTER CORS so
    # CORS preflights are not auth-gated.
    from dynamic_agents.auth.jwt_middleware import JwtAuthMiddleware

    app.add_middleware(JwtAuthMiddleware)

    # Mount routes
    app.include_router(health.router)
    app.include_router(builtin_tools.router, prefix="/api/v1")
    app.include_router(mcp_servers.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")
    app.include_router(assistant.router, prefix="/api/v1")

    @app.get("/")
    async def root():
        """Root endpoint."""
        return {
            "service": "dynamic-agents",
            "version": "0.1.0",
            "docs": "/docs",
        }

    # Spec 102 Phase 11.2 — expose Prometheus metrics so the RBAC PDP
    # cache hit/miss + decision counters set in
    # ai_platform_engineering.utils.auth.metrics are scrapeable. The
    # endpoint is intentionally NOT auth-gated (matches supervisor's
    # /metrics convention; restrict via NetworkPolicy in production).
    try:
        from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
        from starlette.responses import Response

        @app.get("/metrics", include_in_schema=False)
        async def metrics() -> Response:
            return Response(
                content=generate_latest(),
                media_type=CONTENT_TYPE_LATEST,
            )
    except ImportError:
        logger.warning(
            "prometheus_client not installed; /metrics endpoint disabled"
        )

    return app


# Application instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "dynamic_agents.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
