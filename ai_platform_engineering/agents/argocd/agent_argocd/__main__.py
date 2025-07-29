# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
from dotenv import load_dotenv

from agent_argocd.agent import ArgoCDAgent # type: ignore[import-untyped]
from agent_argocd.protocol_bindings.a2a_server.agent_executor import ArgoCDAgentExecutor # type: ignore[import-untyped]

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

from starlette.middleware.cors import CORSMiddleware

load_dotenv()


@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    httpx_client = httpx.AsyncClient()

    push_config_store = InMemoryPushNotificationConfigStore()
    push_sender = BasePushNotificationSender(httpx_client=httpx_client,
                    config_store=push_config_store)
    request_handler = DefaultRequestHandler(
      agent_executor=ArgoCDAgentExecutor(),
      task_store=InMemoryTaskStore(),
      push_config_store=push_config_store,
      push_sender= push_sender
    )

    server = A2AStarletteApplication(
      agent_card=get_agent_card(host, port),
      http_handler=request_handler
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
  """Returns the Agent Card for the ArgoCD CRUD Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='argocd',
    name='ArgoCD Operations',
    description='Performs Create, Read, Update, and Delete operations on ArgoCD applications.',
    tags=['argocd', 'kubernetes', 'continuous_deployment', 'devops'],
    examples=[
      'Create a new ArgoCD application named "my-app".',
      'Get the status of the "frontend" ArgoCD application.',
      'Update the image version for "backend" app.',
      'Delete the "test-app" from ArgoCD.'
    ],
  )
  return AgentCard(
    name='ArgoCD CRUD Agent',
    description='Agent for managing ArgoCD applications with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='0.1.0',
    defaultInputModes=ArgoCDAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=ArgoCDAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill]
  )


if __name__ == '__main__':
    main()
