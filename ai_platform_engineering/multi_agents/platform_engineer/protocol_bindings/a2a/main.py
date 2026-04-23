# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
"""
A2A server entry point for the Platform Engineer supervisor.

Supports both single-node (all-in-one, in-process MCP tools) and distributed
(remote A2A agents) modes via the DISTRIBUTED_MODE environment variable.
"""

import json
import logging
import os
import urllib.error
import urllib.request
import httpx
from pathlib import Path
from dotenv import load_dotenv

from ai_platform_engineering.utils.logging_config import configure_logging
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware, agent_metrics

from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor
)

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import (
    BasePushNotificationSender,
    InMemoryPushNotificationConfigStore,
    InMemoryTaskStore,
)
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)


from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
    agent_name,
    agent_description,
    agent_skill_examples,
)
from ai_platform_engineering.multi_agents.platform_engineer import platform_registry

logger = logging.getLogger(__name__)


def _inject_llm_provider_env_vars() -> None:
    """Fetch decrypted LLM provider configs from the CAIPE UI env-export endpoint
    and inject them into os.environ for any vars not already set.

    Matches the DB-first, env-fallback pattern used by dynamic-agents: values
    that are already in this process's env are never overridden; DB-configured
    values fill in the gaps. This lets admins configure LLM providers once via
    the UI and have them picked up by the supervisor on the next restart,
    without hand-editing a Kubernetes Secret.

    Authentication: DYNAMIC_AGENTS_SERVICE_TOKEN (preferred) or NEXTAUTH_SECRET
    (fallback). Failures are non-fatal — the supervisor continues with whatever
    LLMFactory can build from the existing env (and fails loudly on first
    request if nothing is configured at all).
    """
    ui_url = os.environ.get("CAIPE_UI_URL", "").rstrip("/")
    if not ui_url:
        logger.debug("[LLM] CAIPE_UI_URL not set — skipping DB provider config injection")
        return

    secret = (
        os.environ.get("DYNAMIC_AGENTS_SERVICE_TOKEN")
        or os.environ.get("NEXTAUTH_SECRET")
        or ""
    )
    if not secret:
        logger.debug("[LLM] No service token — skipping DB provider config injection")
        return
    if not os.environ.get("DYNAMIC_AGENTS_SERVICE_TOKEN"):
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
        with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
            data = json.loads(resp.read())

        env_vars: dict[str, str] = data.get("env_vars", {})
        injected: list[str] = []
        for key, value in env_vars.items():
            # Treat empty strings as "unset" — manifest-injected secretKeyRef
            # values (e.g. caipe-llm-secrets.llm-provider="") would otherwise
            # block DB-configured values from reaching os.environ.
            if not os.environ.get(key) and value:
                os.environ[key] = value
                injected.append(key)

        if injected:
            logger.info("[LLM] Injected %d provider config(s) from DB: %s", len(injected), injected)
        else:
            logger.debug("[LLM] No DB provider configs to inject")

    except urllib.error.URLError as exc:
        logger.debug("[LLM] Could not reach CAIPE UI (%s) — using env vars only", exc)
    except Exception as exc:
        logger.warning("[LLM] Unexpected error during provider config injection: %s", exc)


def get_version():
    """Read version from package metadata or pyproject.toml."""
    try:
        from importlib.metadata import version
        return version("ai-platform-engineering")
    except Exception:
        pass

    try:
        current_file = Path(__file__)
        pyproject_path = current_file.parent.parent.parent.parent.parent.parent / "pyproject.toml"
        if pyproject_path.exists():
            import tomllib
            with open(pyproject_path, "rb") as f:
                pyproject_data = tomllib.load(f)
            return pyproject_data["project"]["version"]
    except Exception as e:
        logging.debug(f"Could not read version from pyproject.toml: {e}")

    return "0.0.0"


def get_agent_card(host: str, port: int, external_url: str = None):
    """Build agent card for A2A protocol."""
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

    tags = platform_registry.AGENT_NAMES

    skill = AgentSkill(
        id='ai_platform_engineer',
        name=agent_name,
        description=agent_description,
        tags=tags,
        examples=agent_skill_examples,
    )

    if external_url:
        agent_url = external_url
    else:
        agent_url = f'http://{host}:{port}/'

    return AgentCard(
        name=agent_name,
        description=agent_description,
        url=agent_url,
        version=get_version(),
        defaultInputModes=['text', 'text/plain'],
        defaultOutputModes=['text', 'text/plain'],
        capabilities=capabilities,
        skills=[skill],
    )


# Load environment variables from a .env file if present
load_dotenv()

# Configure logging to suppress noisy health check logs
configure_logging()

# Pull DB-configured LLM credentials from the UI before anything reads them.
# Must run before `AIPlatformEngineerA2AExecutor()` is constructed below,
# because the executor's eager `_startup_initialize` calls LLMFactory() and
# LLMFactory reads LLM_PROVIDER + provider-specific env vars from os.environ.
# Non-fatal on failure (best effort; existing env still works).
_inject_llm_provider_env_vars()

# Check environment variables for host and port if not provided via CLI
env_host = os.getenv('A2A_HOST')
env_port = os.getenv('A2A_PORT')
external_url = os.getenv('EXTERNAL_URL')

# Use CLI argument if provided, else environment variable, else default
host = env_host or 'localhost'
if env_port and env_port.strip():
    try:
        port = int(env_port)
    except ValueError:
        port = 8000
else:
    port = 8000

httpx_client = httpx.AsyncClient()

push_config_store = InMemoryPushNotificationConfigStore()
push_sender = BasePushNotificationSender(
    httpx_client=httpx_client,
    config_store=push_config_store
)

request_handler = DefaultRequestHandler(
    agent_executor=AIPlatformEngineerA2AExecutor(),
    task_store=InMemoryTaskStore(),
    push_config_store=push_config_store,
    push_sender=push_sender
)

# Build A2A Starlette app
a2a_server = A2AStarletteApplication(
    agent_card=get_agent_card(host, port, external_url),
    http_handler=request_handler
)

app = a2a_server.build()

################################################################################
# Eager initialisation — load MCP tools at startup, not on first request
################################################################################
_binding = request_handler.agent_executor.agent


async def _startup_initialize():
    logger.info("Initialising agent (loading MCP tools)...")
    try:
        await _binding.ensure_initialized()
        logger.info("Agent initialised successfully")
    except Exception:
        logger.exception("Agent initialisation failed — will retry on first request")


app.add_event_handler("startup", _startup_initialize)

################################################################################
# /tools endpoint – returns tool names per subagent from the running MAS
################################################################################


async def _tools_endpoint(request: Request) -> JSONResponse:
    """Return dynamically discovered tool names grouped by subagent."""
    try:
        if not _binding._initialized:
            await _binding.ensure_initialized()
        return JSONResponse({"tools": _binding._mas_instance.get_subagent_tools()})
    except Exception as e:
        logger.warning(f"/tools endpoint error: {e}")
        return JSONResponse({"tools": {}, "error": str(e)}, status_code=500)


app.routes.append(Route("/tools", _tools_endpoint, methods=["GET"]))

################################################################################
# Mount the skills middleware REST API alongside the A2A routes.
# We mount the FastAPI sub-app at "/" but APPEND it (default) so that
# existing A2A routes (/.well-known/*, task endpoints) are matched first.
# Only requests that don't match any A2A route fall through to the sub-app.
################################################################################
from fastapi import FastAPI as _FastAPI
from ai_platform_engineering.skills_middleware.router import router as _skills_router

_skills_api = _FastAPI()
_skills_api.include_router(_skills_router)
app.mount("/", _skills_api)

################################################################################
# Add authentication middleware if enabled
################################################################################
A2A_AUTH_OAUTH2 = os.getenv('A2A_AUTH_OAUTH2', 'false').lower() == 'true'
A2A_AUTH_SHARED_KEY = os.getenv('A2A_AUTH_SHARED_KEY')

if A2A_AUTH_SHARED_KEY and A2A_AUTH_OAUTH2:
    logger.info("Using dual authentication (shared key + OAuth2 JWT)")
    from ai_platform_engineering.utils.auth.dual_auth_middleware import DualAuthMiddleware
    app.add_middleware(
        DualAuthMiddleware,
        agent_card=get_agent_card(host, port, external_url),
        public_paths=['/.well-known/agent.json', '/.well-known/agent-card.json'],
    )
elif A2A_AUTH_SHARED_KEY:
    logger.info("Using shared key authentication")
    from ai_platform_engineering.utils.auth.shared_key_middleware import SharedKeyMiddleware
    app.add_middleware(
        SharedKeyMiddleware,
        agent_card=get_agent_card(host, port, external_url),
        public_paths=['/.well-known/agent.json', '/.well-known/agent-card.json'],
    )
elif A2A_AUTH_OAUTH2:
    logger.info("Using OAuth2 authentication")
    from ai_platform_engineering.utils.auth.oauth2_middleware import OAuth2Middleware
    app.add_middleware(
        OAuth2Middleware,
        agent_card=get_agent_card(host, port, external_url),
        public_paths=['/.well-known/agent.json', '/.well-known/agent-card.json'],
    )
else:
    logger.info("Using no authentication")

# Add CORSMiddleware to allow requests from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

################################################################################
# Add Prometheus metrics middleware
################################################################################
METRICS_ENABLED = os.getenv('METRICS_ENABLED', 'true').lower() == 'true'

if METRICS_ENABLED:
    logger.info("Enabling Prometheus metrics at /metrics endpoint")
    app.add_middleware(
        PrometheusMetricsMiddleware,
        excluded_paths=['/.well-known/agent.json', '/.well-known/agent-card.json', '/health', '/ready'],
        metrics_path='/metrics',
    )

    agent_metrics.set_agent_info(
        version=get_version(),
        routing_mode=os.getenv('ROUTING_MODE', 'DEEP_AGENT_PARALLEL_ORCHESTRATION'),
        enabled_agents=platform_registry.AGENT_NAMES,
    )
else:
    logger.info("Prometheus metrics disabled (METRICS_ENABLED=false)")
