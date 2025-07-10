# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import click
import httpx
import uvicorn

from agent import BackstageAgent # type: ignore[import-untyped]
from agent_executor import BackstageAgentExecutor # type: ignore[import-untyped]
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
        agent_executor=BackstageAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int):
    """Returns the Agent Card for the Backstage CRUD Agent."""
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
    skill = AgentSkill(
        id='backstage',
        name='Backstage Operations',
        description='Performs Create, Read, Update, and Delete operations on Backstage catalog entities, services, and resources.',
        tags=['backstage', 'service_catalog', 'devops', 'documentation', 'api_management'],
        examples=[
            'List all services in the catalog.',
            'Create a new component in Backstage.',
            'Update the owner of service XYZ.',
            'Get documentation for API ABC.',
            'Show all plugins installed.',
            'List all users with admin access.',
            'Create a new API entity.',
            'Update the metadata for component DEF.'
        ],
    )
    return AgentCard(
        name='Backstage CRUD Agent',
        description='Agent for managing Backstage catalog entities, services, and resources with CRUD operations.',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=BackstageAgent.SUPPORTED_CONTENT_TYPES,
        defaultOutputModes=BackstageAgent.SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        skills=[skill],
        authentication=AgentAuthentication(schemes=['public']),
    )


if __name__ == '__main__':
    main()