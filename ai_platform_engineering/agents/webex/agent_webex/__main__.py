# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
from dotenv import load_dotenv

from agent_webex.protocol_bindings.a2a_server.agent import WebexAgent  # type: ignore[import-untyped]
from agent_webex.protocol_bindings.a2a_server.agent_executor import WebexAgentExecutor  # type: ignore[import-untyped]

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
@click.option("--host", "host", default="localhost")
@click.option("--port", "port", default=10000)
def main(host: str, port: int):
  client = httpx.AsyncClient()
  request_handler = DefaultRequestHandler(
    agent_executor=WebexAgentExecutor(),
    task_store=InMemoryTaskStore(),
    push_notifier=InMemoryPushNotifier(client),
  )

  server = A2AStarletteApplication(agent_card=get_agent_card(host, port), http_handler=request_handler)
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
  """Returns the Agent Card for the Webex Agent."""
  capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
  skill = AgentSkill(
    id="webex",
    name="Webex Operations",
    description="Performs messaging operations on Cisco Webex.",
    tags=["webex", "messaging", "devops"],
    examples=[
      "Send a Webex message to user@example.com.",
      "Send a message to a room with room_id.",
      "Read messages in a room.",
      "Create a room.Add users to a room with room_id.",
    ],
  )
  return AgentCard(
    name="Webex messaging Agent",
    description="Agent for Webex messaging to rooms or users.",
    url=f"http://{host}:{port}/",
    version="1.0.0",
    defaultInputModes=WebexAgent.SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=WebexAgent.SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[skill],
    # Using the security field instead of the non-existent AgentAuthentication class
    security=[{"public": []}],
  )


if __name__ == "__main__":
  main()
