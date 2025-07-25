# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import sys
import click
import httpx
import uvicorn

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()


from agent import GitHubAgent # type: ignore[import-untyped]
from agent_executor import GitHubAgentExecutor # type: ignore[import-untyped]
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
    if not os.getenv('GITHUB_PERSONAL_ACCESS_TOKEN'):
        print('GITHUB_PERSONAL_ACCESS_TOKEN environment variable not set.')
        sys.exit(1)

    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=GitHubAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int):
  """Returns the Agent Card for the GitHub Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='github',
    name='GitHub Operations',
    description=(
      'Performs Create, Read, Update, and Delete operations on GitHub repositories, '
      'issues, pull requests, and other GitHub resources.'
    ),
    tags=[
      'github',
      'repositories',
      'issues',
      'pull_requests',
      'code_review',
      'devops',
    ],
    examples=[
      'Create a new repository named "my-project".',
      'Get the status of pull request #123 in "owner/repo".',
      'Create an issue in the "frontend" repository.',
      'Review and merge a pull request.',
    ],
  )
  return AgentCard(
    name='GitHub Agent',
    description='Agent for managing GitHub resources with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=GitHubAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=GitHubAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    authentication=AgentAuthentication(schemes=['public']),
  )


if __name__ == '__main__':
    main()
