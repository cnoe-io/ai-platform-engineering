# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
from dotenv import load_dotenv

from agent_petstore.agent import PetStoreAgent # type: ignore[import-untyped]
from agent_petstore.protocol_bindings.a2a_server.agent_executor import PetStoreAgentExecutor # type: ignore[import-untyped]

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
@click.option('--port', 'port', default=8000)
def main(host: str = 'localhost', port: int = 8000):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=PetStoreAgentExecutor(),
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
  """Returns the Agent Card for the Pet Store Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='petstore',
    name='Pet Store Operations',
    description='Performs operations on the Pet Store API such as finding, adding, updating, and deleting pets.',
    tags=['petstore', 'pets', 'api'],
    examples=[
      'Find available pets for adoption',
      'Get pet details by ID',
      'Add a new pet to the store',
      'Update pet information',
      'Find pets by status'
    ],
  )
  return AgentCard(
    name='Pet Store Agent',
    description='Agent for interacting with the Pet Store API to manage pets, orders, and users.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=PetStoreAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=PetStoreAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill]
  )


if __name__ == '__main__':
    main()
