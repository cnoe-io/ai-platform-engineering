# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
"""
Single-node A2A server entry point.

This module provides the A2A server configuration for single-node mode,
which uses the deepagents library for in-process MCP tool execution.
"""

import logging
import os
import httpx
from pathlib import Path
from dotenv import load_dotenv

from ai_platform_engineering.utils.logging_config import configure_logging
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware, agent_metrics

from starlette.middleware.cors import CORSMiddleware

# Import single-node specific executor
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor_single import (
    AIPlatformEngineerA2AExecutorSingle
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


logger = logging.getLogger(__name__)

# Agent metadata for single-node mode
AGENT_NAME = "AI Platform Engineer"
AGENT_DESCRIPTION = """AI Platform Engineer in single-node mode. 
Uses in-process MCP tools via stdio transport for unified deployment.
Supports self-service workflows with HITL forms for user input collection."""


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
    except Exception:
        pass

    return "0.0.0"


def get_agent_card(host: str, port: int, external_url: str = None):
    """Build agent card for A2A protocol."""
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

    # Tags for single-node mode include all in-process capabilities
    tags = ["single-node", "devops", "platform-engineering", "self-service"]

    skill = AgentSkill(
        id='ai_platform_engineer_single',
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        tags=tags,
        examples=[
            "Create a GitHub repository",
            "Deploy an application to ArgoCD",
            "Create an EC2 instance",
            "List my Jira tickets",
        ],
    )

    if external_url:
        agent_url = external_url
    else:
        agent_url = f'http://{host}:{port}/'

    return AgentCard(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
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
    agent_executor=AIPlatformEngineerA2AExecutorSingle(),
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
# Add authentication middleware if enabled
################################################################################
A2A_AUTH_OAUTH2 = os.getenv('A2A_AUTH_OAUTH2', 'false').lower() == 'true'
A2A_AUTH_SHARED_KEY = os.getenv('A2A_AUTH_SHARED_KEY')

if A2A_AUTH_SHARED_KEY:
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
METRICS_ENABLED = os.getenv('METRICS_ENABLED', 'false').lower() == 'true'

if METRICS_ENABLED:
    logger.info("Enabling Prometheus metrics at /metrics endpoint")
    app.add_middleware(
        PrometheusMetricsMiddleware,
        excluded_paths=['/.well-known/agent.json', '/.well-known/agent-card.json', '/health', '/ready'],
        metrics_path='/metrics',
    )

    agent_metrics.set_agent_info(
        version=get_version(),
        routing_mode='SINGLE_NODE_DEEP_AGENT',
        enabled_agents=['single-node'],
    )
else:
    logger.info("Prometheus metrics disabled (METRICS_ENABLED=false)")
