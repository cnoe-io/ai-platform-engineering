"""Dynamic Agents FastAPI Application."""

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

from dynamic_agents.log_config import setup_logging

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

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
from dynamic_agents.routes import agents, builtin_tools, chat, conversations, health, llm_models, mcp_servers
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.mongo import get_mongo_service, reset_mongo_service
from dynamic_agents.services.seed_config import apply_seed_config


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

    # Apply seed configuration (agents and MCP servers from config.yaml)
    apply_seed_config(mongo, settings.seed_config_path)

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

    # Mount routes
    app.include_router(health.router)
    app.include_router(agents.router, prefix="/api/v1")
    app.include_router(builtin_tools.router, prefix="/api/v1")
    app.include_router(llm_models.router, prefix="/api/v1")
    app.include_router(mcp_servers.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")

    from dynamic_agents.routes import sandbox
    app.include_router(sandbox.router, prefix="/api/v1")

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
