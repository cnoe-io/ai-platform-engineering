# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
import uvicorn
import asyncio
import os
from dotenv import load_dotenv
from agntcy_app_sdk.factory import AgntcyFactory

from agent_slack.protocol_bindings.a2a_server.agent_executor import SlackAgentExecutor # type: ignore[import-untyped]
from agent_slack.agentcard import create_agent_card
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore

from starlette.middleware.cors import CORSMiddleware

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# We can't use click decorators for async functions so we wrap the main function in a sync function
@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))

async def async_main(host: str, port: int):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=SlackAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    if A2A_TRANSPORT == "slim":
        agent_url = SLIM_ENDPOINT
    else:
        agent_url = f'http://{host}:{port}'

    server = A2AStarletteApplication(
        agent_card=create_agent_card(agent_url), http_handler=request_handler
    )

    if A2A_TRANSPORT == 'slim':
        # Run A2A server over SLIM transport
        # https://docs.agntcy.org/messaging/slim-core/
        print("Running A2A server in SLIM mode.")
        factory = AgntcyFactory()
        transport = factory.create_transport("SLIM", endpoint=agent_url)
        print("Transport created successfully.")

        bridge = factory.create_bridge(server, transport=transport)
        print("Bridge created successfully. Starting the bridge.")
        await bridge.start(blocking=True)
    else:
        # Run a p2p A2A server
        print("Running A2A server in p2p mode.")
        app = server.build()

        # Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # Allow all origins
            allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
            allow_headers=["*"],  # Allow all headers
        )

        config = uvicorn.Config(app, host=host, port=port)
        server = uvicorn.Server(config=config)
        await server.serve()

if __name__ == '__main__':
    main()
