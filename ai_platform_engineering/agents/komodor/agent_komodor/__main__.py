# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
from dotenv import load_dotenv

from agent_komodor.protocol_bindings.a2a_server.agent import KomodorAgent # type: ignore[import-untyped]
from agent_komodor.protocol_bindings.a2a_server.agent_executor import KomodorAgentExecutor # type: ignore[import-untyped]

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

from starlette.middleware.cors import CORSMiddleware

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
    app = server.build()

    # Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
    app.add_middleware(
          CORSMiddleware,
          allow_origins=["*"],  # Allow all origins
          allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
          allow_headers=["*"],  # Allow all headers
    )

    import uvicorn
    uvicorn.run(app, host=host, port=port)


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
    skills=[skill]
  )


if __name__ == '__main__':
    main()
