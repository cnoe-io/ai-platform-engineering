# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import httpx
import uvicorn
import asyncio
import os
import logging
from dotenv import load_dotenv
from agntcy_app_sdk.factory import AgntcyFactory

from agent_confluence.protocol_bindings.a2a_server.agent_executor import ConfluenceAgentExecutor # type: ignore[import-untyped]
from agent_confluence.agentcard import create_agent_card
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import (
    BasePushNotificationSender,
    InMemoryPushNotificationConfigStore,
    InMemoryTaskStore,
)
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
    push_config_store = InMemoryPushNotificationConfigStore()
    push_sender = BasePushNotificationSender(httpx_client=client,
                    config_store=push_config_store)
    request_handler = DefaultRequestHandler(
        agent_executor=ConfluenceAgentExecutor(),
        task_store=InMemoryTaskStore(),
      push_config_store=push_config_store,
      push_sender= push_sender
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

        # Configure uvicorn access log to DEBUG level for health checks
        access_logger = logging.getLogger("uvicorn.access")
        access_logger.setLevel(logging.DEBUG)
        
        config = uvicorn.Config(app, host=host, port=port, access_log=True)
        server = uvicorn.Server(config=config)
        await server.serve()

if __name__ == '__main__':
    main()
