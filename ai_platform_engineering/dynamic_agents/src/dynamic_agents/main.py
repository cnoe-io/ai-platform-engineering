"""Dynamic Agents FastAPI Application."""

import logging
import sys
from contextlib import asynccontextmanager


# Configure logging for dynamic_agents BEFORE importing cnoe-agent-utils
# This prevents cnoe-agent-utils from capturing our logs with their format
def _setup_logging() -> logging.Logger:
    """Configure logging for the dynamic_agents package.

    Sets up a dedicated handler for the 'dynamic_agents' logger that:
    - Uses our own format with [dynamic_agents] prefix
    - Does not propagate to root logger (avoids cnoe-agent-utils format)
    """
    # Create logger for our package
    pkg_logger = logging.getLogger("dynamic_agents")
    pkg_logger.setLevel(logging.INFO)

    # Only add handler if not already configured (avoid duplicates on reload)
    if not pkg_logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setLevel(logging.INFO)
        formatter = logging.Formatter(
            "%(asctime)s %(levelname)s [dynamic_agents] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        pkg_logger.addHandler(handler)

    # Don't propagate to root logger (cnoe-agent-utils configures root with [llm_factory])
    pkg_logger.propagate = False

    return pkg_logger


# Setup logging before other imports that trigger cnoe-agent-utils
logger = _setup_logging()

# ruff: noqa: E402
# Imports must be after logging setup to ensure our format is used
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dynamic_agents.config import get_settings
from dynamic_agents.routes import agents, chat, health, mcp_servers
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.mongo import get_mongo_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    settings = get_settings()
    logger.info("Starting Dynamic Agents service...")

    # Initialize MongoDB connection
    mongo = get_mongo_service()
    if mongo._client is None:
        logger.error("Failed to connect to MongoDB")
    else:
        logger.info(f"Connected to MongoDB: {settings.mongodb_database}")

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
    app.include_router(mcp_servers.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")

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
