# Copyright 2025 Cisco
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

from agent import PagerDutyAgent # type: ignore[import-untyped]
from agent_executor import PagerDutyAgentExecutor # type: ignore[import-untyped]
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
        agent_executor=PagerDutyAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int):
  """Returns the Agent Card for the PagerDuty CRUD Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id='pagerduty',
    name='PagerDuty Operations',
    description='Performs Create, Read, Update, and Delete operations on PagerDuty incidents and services.',
    tags=['pagerduty', 'incident_management', 'on_call', 'devops', 'alerts'],
    examples=[
      'Create a new incident in PagerDuty.',
      'List all incidents in high urgency state.',
      'Update the urgency of incident #123 to high.',
      'List all services in PagerDuty.',
      'Get on-call schedule for the next 7 days.'
    ],
  )
  return AgentCard(
    name='PagerDuty CRUD Agent',
    description='Agent for managing PagerDuty incidents and services with CRUD operations.',
    url=f'http://{host}:{port}/',
    version='1.0.0',
    defaultInputModes=PagerDutyAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=PagerDutyAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    authentication=AgentAuthentication(schemes=['public']),
  )


if __name__ == '__main__':
    main()