# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
import uvicorn

from agent import KomodorAgent # type: ignore[import-untyped]
from agent_executor import KomodorAgentExecutor # type: ignore[import-untyped]
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
def main(host: str, port: int):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=KomodorAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )
    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int):
  """Returns the Agent Card for the Komodor CRUD Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='komodor',
    name='Komodor Operations',
    description='Performs Create, Read, Update, and Delete operations on Komodor applications.',
    tags=['komodor', 'kubernetes', 'continuous_deployment', 'devops'],
    examples=[
      'Create a new Komodor application named "my-app".',
      'Get the status of the "frontend" Komodor application.',
      'Update the image version for "backend" app.',
      'Delete the "test-app" from Komodor.'
    ],
  )
  return AgentCard(
    name='Komodor CRUD Agent',
    description='Agent for managing Komodor applications with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=KomodorAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=KomodorAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    authentication=AgentAuthentication(schemes=['public']),
  )


if __name__ == '__main__':
    main()
