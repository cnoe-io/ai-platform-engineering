# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import logging

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()
logging.debug("A2A tracing disabled using cnoe-agent-utils")

# =====================================================
# Now safe to import a2a modules
# =====================================================

import httpx

from starlette.middleware.cors import CORSMiddleware

from ai_platform_engineering.multi_agents.incident_engineer.protocol_bindings.a2a.agent_executor import AIIncidentEngineerA2AExecutor # type: ignore[import-untyped]
from dotenv import load_dotenv

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill,
)


from ai_platform_engineering.multi_agents.incident_engineer.prompts import (
  agent_name,
  agent_description,
  agent_skill_examples
)

load_dotenv()

def get_agent_card(host: str, port: int):
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

  skill = AgentSkill(
    id='ai_incident_engineer',
    name=agent_name,
    description=agent_description,
    tags=['confluence', 'pagerduty', 'github', 'jira', 'devops'],
    examples=agent_skill_examples,
  )

  return AgentCard(
    name=agent_name,
    description=agent_description,
    url=f'http://{host}:{port}/',
    version='0.1.0',
    defaultInputModes=['text', 'text/plain'],
    defaultOutputModes=['text', 'text/plain'],
    capabilities=capabilities,
    skills=[skill],
  )

# Check environment variables for host and port if not provided via CLI
env_host = os.getenv('A2A_HOST')
env_port = os.getenv('A2A_PORT')

# Use CLI argument if provided, else environment variable, else default
host = env_host or 'localhost'
port = int(env_port) if env_port is not None else 8000

client = httpx.AsyncClient()

request_handler = DefaultRequestHandler(
  agent_executor=AIIncidentEngineerA2AExecutor(),
  task_store=InMemoryTaskStore(),
  push_notifier=InMemoryPushNotifier(client),
)

a2a_server = A2AStarletteApplication(
  agent_card=get_agent_card(host, port),
  http_handler=request_handler
)

app = a2a_server.build()

# Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],  # Allow all origins
  allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
  allow_headers=["*"],  # Allow all headers
)
