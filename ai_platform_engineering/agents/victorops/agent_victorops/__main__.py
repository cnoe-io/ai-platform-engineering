# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import click
import httpx
from dotenv import load_dotenv

from agent_victorops.protocol_bindings.a2a_server.agent import VictorOpsAgent # type: ignore[import-untyped]
from agent_victorops.protocol_bindings.a2a_server.agent_executor import VictorOpsAgentExecutor # type: ignore[import-untyped]

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
        agent_executor=VictorOpsAgentExecutor(),
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
  """Returns the Agent Card for the VictorOps CRUD Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='victorops',
    name='VictorOps Operations',
    description='Performs Create, Read, Update, and Delete operations on VictorOps incidents and services.',
    tags=['victorops', 'incident_management', 'on_call', 'devops', 'alerts'],
    examples=[
      'Create a new incident in VictorOps.',
      'List all incidents in high urgency state.',
      'Update the urgency of incident #123 to high.',
      'List all services in VictorOps.',
      'Get on-call schedule for the next 7 days.'
    ],
  )
  return AgentCard(
    name='VictorOps CRUD Agent',
    description='Agent for managing VictorOps incidents and services with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=VictorOpsAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=VictorOpsAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
  )


if __name__ == '__main__':
    main()