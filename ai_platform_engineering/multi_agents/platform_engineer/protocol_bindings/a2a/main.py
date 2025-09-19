# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import httpx
from dotenv import load_dotenv


from starlette.middleware.cors import CORSMiddleware

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import AIPlatformEngineerA2AExecutor # type: ignore[import-untyped]

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
  agent_skill_examples
)

def get_agent_card(host: str, port: int, external_url: str = None):
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

  tags = ['argocd', 'pagerduty', 'github', 'jira', 'slack', 'devops']
  if os.getenv('ENABLE_WEBEX_AGENT', '').lower() == 'true':
    tags.append('webex')

  skill = AgentSkill(
    id='ai_platform_engineer',
    name=agent_name,
    description=agent_description,
    tags=tags,
    examples=agent_skill_examples,
  )

  # Check for external URL override first
  if external_url:
    # Use external URL as-is (should include protocol and path)
    agent_url = external_url
  else:
    # Use traditional host:port construction for internal URLs
    agent_url = f'http://{host}:{port}/'

  return AgentCard(
    name=agent_name,
    description=agent_description,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=['text', 'text/plain'],
    defaultOutputModes=['text', 'text/plain'],
    capabilities=capabilities,
    skills=[skill],
  )

# Load environment variables from a .env file if present
load_dotenv()

# Check environment variables for host and port if not provided via CLI
env_host = os.getenv('A2A_HOST')
env_port = os.getenv('A2A_PORT')
external_url = os.getenv('EXTERNAL_URL')

# Use CLI argument if provided, else environment variable, else default
host = env_host or 'localhost'
# Handle empty string and None values for port
if env_port and env_port.strip():
  try:
    port = int(env_port)
  except ValueError:
    port = 8000
else:
  port = 8000

httpx_client = httpx.AsyncClient()

push_config_store = InMemoryPushNotificationConfigStore()
push_sender = BasePushNotificationSender(httpx_client=httpx_client,
                config_store=push_config_store)

push_config_store = InMemoryPushNotificationConfigStore()
push_sender = BasePushNotificationSender(httpx_client=httpx_client, config_store=push_config_store)

request_handler = DefaultRequestHandler(
  agent_executor=AIPlatformEngineerA2AExecutor(),
  task_store=InMemoryTaskStore(),
  push_config_store=push_config_store,
  push_sender= push_sender
)

a2a_server = A2AStarletteApplication(
  agent_card=get_agent_card(host, port, external_url),
  http_handler=request_handler
)

app = a2a_server.build()

################################################################################
# Add authentication middleware if enabled
################################################################################
USE_OAUTH2 = os.getenv('USE_OAUTH2', 'false').lower() == 'true'

USE_SHARED_KEY = os.getenv('USE_SHARED_KEY', 'false').lower() == 'true'

# Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],  # Allow all origins
  allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
  allow_headers=["*"],  # Allow all headers
)

if USE_SHARED_KEY:
  from ai_platform_engineering.common.auth.shared_key_middleware import SharedKeyMiddleware
  app.add_middleware(
    SharedKeyMiddleware,
    agent_card=get_agent_card(host, port, external_url),
    public_paths=['/.well-known/agent.json', '/.well-known/agent-card.json'],
  )
elif USE_OAUTH2:
  from ai_platform_engineering.common.auth.oauth2_middleware import OAuth2Middleware
  app.add_middleware(
    OAuth2Middleware,
    agent_card=get_agent_card(host, port, external_url),
    public_paths=['/.well-known/agent.json', '/.well-known/agent-card.json'],
  )