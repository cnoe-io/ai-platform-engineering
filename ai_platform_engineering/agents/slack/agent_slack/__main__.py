# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import sys
import logging

import click
import httpx
from dotenv import load_dotenv

from agent_slack.protocol_bindings.a2a_server.agent import SlackAgent  # type: ignore
from agent_slack.protocol_bindings.a2a_server.agent_executor import SlackAgentExecutor  # type: ignore

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

load_dotenv()

# Set logging level
logging.basicConfig(level=logging.INFO)

@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    print("🚀 Starting Slack A2A Agent...")
    if not os.getenv('GOOGLE_API_KEY'):
        print('❌ GOOGLE_API_KEY environment variable not set.')
        sys.exit(1)

    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=SlackAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    print(f"✅ Running at http://{host}:{port}/")
    print("📡 Agent ready to receive requests.\n")

    import uvicorn
    uvicorn.run(server.build(), host=host, port=port)

def get_agent_card(host: str, port: int):
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
    skill = AgentSkill(
        id='slack',
        name='Slack Workspace Operations',
        description='Interact with Slack messages, channels, and users via agentic tools.',
        tags=['slack', 'productivity', 'chatops'],
        examples=[
            'Send a message to the #general channel.',
            'List users in a workspace.',
            'Reply to a thread in #support.',
        ],
    )
    return AgentCard(
        name='Slack Agent',
        description='Agent for managing Slack workspace operations.',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=SlackAgent.SUPPORTED_CONTENT_TYPES,
        defaultOutputModes=SlackAgent.SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        skills=[skill],
    )

if __name__ == '__main__':
    main()
