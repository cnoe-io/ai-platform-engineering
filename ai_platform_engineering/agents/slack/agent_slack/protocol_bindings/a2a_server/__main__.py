# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

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

import click
import httpx
import uvicorn
import asyncio
from agntcy_app_sdk.factory import AgntcyFactory

from agent import SlackAgent # type: ignore[import-untyped]
from agent_executor import SlackAgentExecutor # type: ignore[import-untyped]
from dotenv import load_dotenv

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentAuthentication,
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)


load_dotenv()


@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
async def main(host: str, port: int):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=SlackAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    if os.getenv('A2A_TRANSPORT', 'p2p').lower() == 'slim':
        # Run A2A server over SLIM transport
        # https://docs.agntcy.org/messaging/slim-core/
        print("Running A2A server in SLIM mode.")
        factory = AgntcyFactory()
        SLIM_ENDPOINT = os.getenv('SLIM_ENDPOINT', 'http://slim-dataplane:46357')
        transport = factory.create_transport("SLIM", endpoint=SLIM_ENDPOINT)
        print("Transport created successfully.")

        bridge = factory.create_bridge(server, transport=transport)
        print("Bridge created successfully. Starting the bridge.")
        await bridge.start(blocking=True)
    else:
      # Run a p2p A2A server
      print("Running A2A server in p2p mode.")
      uvicorn.run(server.build(), host=host, port=port)

def get_agent_card(host: str, port: int):
  """Returns the Agent Card for the Slack Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='slack',
    name='Slack Operations',
    description='Performs Create, Read, Update, and Delete operations on Slack applications.',
    tags=['slack', 'kubernetes', 'continuous_deployment', 'devops'],
    examples=[
      'Create a new Slack application named "my-app".',
      'Get the status of the "frontend" Slack application.',
      'Update the image version for "backend" app.',
      'Delete the "test-app" from Slack.'
    ],
  )
  return AgentCard(
    name='Slack Agent',
    description='Agent for managing Slack applications with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=SlackAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SlackAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    authentication=AgentAuthentication(schemes=['public']),
  )


if __name__ == '__main__':
    asyncio.run(main())
