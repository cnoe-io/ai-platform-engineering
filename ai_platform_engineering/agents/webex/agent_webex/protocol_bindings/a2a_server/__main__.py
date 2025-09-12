# Copyright 2025 CNOE
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

from agent import WebexAgent  # type: ignore[import-untyped]
from agent_executor import WebexAgentExecutor  # type: ignore[import-untyped]
from dotenv import load_dotenv

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotificationConfigStore, \
    BasePushNotificationSender, InMemoryTaskStore
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill,
)


load_dotenv()


@click.command()
@click.option("--host", "host", default="localhost")
@click.option("--port", "port", default=10000)
def main(host: str, port: int):
  client = httpx.AsyncClient()
  push_notification_config_store = InMemoryPushNotificationConfigStore()
  push_notification_sender = BasePushNotificationSender(client,
                                                        config_store=push_notification_config_store)

  request_handler = DefaultRequestHandler(
    agent_executor=WebexAgentExecutor(),
    task_store=InMemoryTaskStore(),
    push_config_store=push_notification_config_store,
    push_sender=push_notification_sender,
  )

  server = A2AStarletteApplication(agent_card=get_agent_card(host, port), http_handler=request_handler)

  uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int):
  """Returns the Agent Card for the Webex Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id="webex",
    name="Webex Operations",
    description="Performs Webex messaging interactions.",
    tags=["webex", "messaging", "communication"],
    examples=[
      'Create a new room "my-room".',
      'Get all messages in room "my-room".',
      'Post a direct message to user "test@example.com".',
      'Add users to the "my-room" Webex room.',
    ],
  )
  return AgentCard(
    name="Webex Agent",
    description="Agent to communicate via Webex messaging.",
    url=f"http://{host}:{port}/",
    version="1.0.0",
    defaultInputModes=WebexAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=WebexAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    # authentication=AgentAuthentication(schemes=['public']),
  )


if __name__ == "__main__":
  main()
