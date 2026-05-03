"""Dynamic Agents FastAPI Application."""

import asyncio
import os
from contextlib import asynccontextmanager

import dotenv

dotenv.load_dotenv()  # Ensure .env is in os.environ before any boto3/httpx clients are created

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
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from dynamic_agents.config import get_settings
from dynamic_agents.metrics import PrometheusHTTPMiddleware
from dynamic_agents.routes import assistant, builtin_tools, chat, conversations, health, mcp_servers, middleware
from dynamic_agents.services.mongo import get_mongo_service, reset_mongo_service
from dynamic_agents.services.runtime_cache import RuntimeCapacityError, RuntimeInitError, get_runtime_cache


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

    # Start runtime cache background sweep
    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)
    cache.start()

    yield

    # Cleanup on shutdown
    logger.info("Shutting down Dynamic Agents service...")

    # Stop sweep and clear agent runtime cache
    await cache.stop()

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

    # Add Prometheus metrics middleware (serves /metrics, tracks request duration)
    app.add_middleware(PrometheusHTTPMiddleware)

    # Mount routes
    app.include_router(health.router)
    app.include_router(builtin_tools.router, prefix="/api/v1")
    app.include_router(mcp_servers.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")
    app.include_router(assistant.router, prefix="/api/v1")
    app.include_router(middleware.router, prefix="/api/v1")

    @app.exception_handler(RuntimeInitError)
    async def runtime_init_error_handler(request: Request, exc: RuntimeInitError):
        """Return a 503 with a descriptive message when runtime initialization fails."""
        return JSONResponse(
            status_code=503,
            content={
                "detail": str(exc),
                "agent_id": exc.agent_id,
                "error_type": type(exc.cause).__name__,
            },
        )

    @app.exception_handler(RuntimeCapacityError)
    async def runtime_capacity_error_handler(request: Request, exc: RuntimeCapacityError):
        """Return a 503 when the runtime cache is at capacity."""
        return JSONResponse(
            status_code=503,
            content={
                "error": "agent_busy",
                "message": "This agent is at capacity right now. Please try again in a moment.",
                "retry_after_seconds": 5,
            },
            headers={"Retry-After": "5"},
        )

    @app.get("/")
    async def root():
        """Root endpoint."""
        return {
            "service": "dynamic-agents",
            "version": "0.1.0",
            "docs": "/docs",
        }

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
