"""Dynamic Agents FastAPI Application."""

import asyncio
import json
import os
import urllib.error
import urllib.request
from contextlib import asynccontextmanager

from dynamic_agents.log_config import setup_logging

# Setup logging before other imports that trigger cnoe-agent-utils
logger = setup_logging()

# Tracks env var keys that were injected from the DB (not set by the k8s manifest).
# Only these keys are eligible for credential refresh — IaC-set vars are never
# overridden. Populated during startup injection and checked on refresh calls.
_db_injected_keys: set[str] = set()


def fatal_exit(message: str) -> None:
    """Log a critical error and forcefully terminate the process.

    Uses os._exit(1) to bypass exception handlers and ensure immediate termination,
    which is necessary when running under uvicorn with reload mode.
    """
    logger.critical(message)
    os._exit(1)


def _inject_llm_provider_env_vars(*, allow_refresh: bool = False) -> bool:
    """Fetch decrypted LLM provider configs from the CAIPE UI env-export endpoint
    and inject them into os.environ.

    Implements the DB-first, env-fallback pattern:
      - On startup (allow_refresh=False): only injects vars not already set in the
        process environment. IaC-set vars (k8s secretKeyRef) always take precedence.
      - On refresh (allow_refresh=True): re-fetches from the DB and updates any key
        that was previously injected from the DB (tracked in _db_injected_keys).
        IaC-set keys are never overridden regardless.

    Authentication uses DYNAMIC_AGENTS_SERVICE_TOKEN (preferred) or
    NEXTAUTH_SECRET (fallback). Failures are non-fatal.

    Returns:
        True if any env var was newly injected or updated, False otherwise.
    """
    settings = get_settings()
    ui_url = settings.caipe_ui_url.rstrip("/")

    secret = (
        settings.dynamic_agents_service_token
        or os.environ.get("NEXTAUTH_SECRET")
        or ""
    )
    if not secret:
        logger.debug("[LLM] No service token — skipping DB provider config injection")
        return False
    if not settings.dynamic_agents_service_token:
        logger.warning(
            "[LLM] Using NEXTAUTH_SECRET as env-export credential. "
            "Set DYNAMIC_AGENTS_SERVICE_TOKEN to a dedicated credential."
        )

    endpoint = f"{ui_url}/api/admin/llm-providers/env-export"
    try:
        req = urllib.request.Request(
            endpoint,
            headers={"Authorization": f"Bearer {secret}"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())

        env_vars: dict[str, str] = data.get("env_vars", {})
        injected: list[str] = []
        updated: list[str] = []

        for key, value in env_vars.items():
            # Treat empty strings as "unset" — manifest-injected secretKeyRef
            # values (e.g. caipe-llm-secrets.llm-provider="") would otherwise
            # block DB-configured values from reaching os.environ.
            if not value:
                continue

            current = os.environ.get(key)

            if not current:
                # Not set at all — inject from DB and track it as DB-owned.
                os.environ[key] = value
                _db_injected_keys.add(key)
                injected.append(key)
            elif allow_refresh and key in _db_injected_keys and current != value:
                # Previously injected from DB and the value has changed — refresh it.
                # IaC-set keys (not in _db_injected_keys) are never touched here.
                os.environ[key] = value
                updated.append(key)

        if injected:
            logger.info("[LLM] Injected %d provider config(s) from DB: %s", len(injected), injected)
        if updated:
            logger.info("[LLM] Refreshed %d provider credential(s) from DB: %s", len(updated), updated)
        if not injected and not updated:
            logger.debug("[LLM] No DB provider configs to inject or refresh")

        return bool(injected or updated)

    except urllib.error.URLError as exc:
        logger.debug("[LLM] Could not reach CAIPE UI (%s) — using env vars only", exc)
        return False
    except Exception as exc:
        logger.warning("[LLM] Unexpected error during provider config injection: %s", exc)
        return False


# ruff: noqa: E402
# Imports must be after logging setup to ensure our format is used
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dynamic_agents.config import get_settings
from dynamic_agents.metrics import PrometheusHTTPMiddleware
from dynamic_agents.routes import admin, assistant, builtin_tools, chat, conversations, health, mcp_servers, middleware
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
            delay = base_delay * (2**attempt)
            logger.warning(
                f"MongoDB connection failed, retrying in {delay}s "
                f"(attempt {attempt + 1}/{max_retries})..."
            )
            await asyncio.sleep(delay)
            reset_mongo_service()
    else:
        fatal_exit(
            f"Failed to connect to MongoDB after {max_retries} attempts. "
            "Service cannot start without MongoDB."
        )

    # Inject DB-configured LLM provider API keys into env (non-fatal if UI unreachable)
    _inject_llm_provider_env_vars()

    yield

    # Cleanup on shutdown
    logger.info("Shutting down Dynamic Agents service...")
    cache = get_runtime_cache()
    await cache.clear()
    mongo.disconnect()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Dynamic Agents Service",
        description="Ephemeral AI agent runtime — config owned by Next.js gateway",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(PrometheusHTTPMiddleware)

    app.include_router(health.router)
    app.include_router(admin.router, prefix="/api/v1")
    app.include_router(builtin_tools.router, prefix="/api/v1")
    app.include_router(mcp_servers.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")
    app.include_router(assistant.router, prefix="/api/v1")
    app.include_router(middleware.router, prefix="/api/v1")

    @app.get("/")
    async def root():
        return {"service": "dynamic-agents", "version": "0.1.0", "docs": "/docs"}

    return app


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
