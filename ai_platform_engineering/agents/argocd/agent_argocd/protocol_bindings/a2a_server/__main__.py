# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os

import click
import httpx
import uvicorn

from cnoe_agent_utils.tracing import disable_a2a_tracing
disable_a2a_tracing()

from agent import ArgoCDAgent # type: ignore[import-untyped]
from agent_executor import ArgoCDAgentExecutor # type: ignore[import-untyped]
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
@click.option('--host', 'host', default='localhost', type=str)
@click.option('--port', 'port', default=8000, type=int)
def main(host: str, port: int):
  # Check environment variables for host and port if not provided via CLI
  env_host = os.getenv('A2A_HOST')
  env_port = os.getenv('A2A_PORT')

  # Use CLI argument if provided, else environment variable, else default
  host = host or env_host or 'localhost'
  port = port or int(env_port) if env_port is not None else 8000

  client = httpx.AsyncClient()
  request_handler = DefaultRequestHandler(
    agent_executor=ArgoCDAgentExecutor(),
    task_store=InMemoryTaskStore(),
    push_notifier=InMemoryPushNotifier(client),
  )

  server = A2AStarletteApplication(
    agent_card=get_agent_card(host, port), http_handler=request_handler
  )

  uvicorn.run(server.build(), host=host, port=port)


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
    version='1.0.0',
    defaultInputModes=ArgoCDAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=ArgoCDAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    authentication=AgentAuthentication(schemes=['public']),
  )


if __name__ == '__main__':
    main()
