# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
"""
A2A server entry point for the Platform Engineer supervisor.

Supports both single-node (all-in-one, in-process MCP tools) and distributed
(remote A2A agents) modes via the DISTRIBUTED_MODE environment variable.
"""

import logging
import os
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
