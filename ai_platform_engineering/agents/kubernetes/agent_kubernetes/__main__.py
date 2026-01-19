# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from cnoe_agent_utils.tracing import disable_a2a_tracing
disable_a2a_tracing()

import click
import httpx
import uvicorn
import asyncio
import os
from dotenv import load_dotenv
from agntcy_app_sdk.factory import AgntcyFactory

from agent_kubernetes.protocol_bindings.a2a_server.agent_executor import KubernetesAgentExecutor
from agent_kubernetes.agentcard import create_agent_card
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import (
    BasePushNotificationSender,
    InMemoryPushNotificationConfigStore,
    InMemoryTaskStore,
)

from starlette.middleware.cors import CORSMiddleware
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")
METRICS_ENABLED = os.getenv("METRICS_ENABLED", "false").lower() == "true"


@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))


async def async_main(host: str, port: int):
    client = httpx.AsyncClient()
    push_config_store = InMemoryPushNotificationConfigStore()
    push_sender = BasePushNotificationSender(httpx_client=client, config_store=push_config_store)
    request_handler = DefaultRequestHandler(
      agent_executor=KubernetesAgentExecutor(),
      task_store=InMemoryTaskStore(),
      push_config_store=push_config_store,
      push_sender=push_sender
    )

    if A2A_TRANSPORT == "slim":
        agent_url = SLIM_ENDPOINT
    else:
        agent_url = f'http://{host}:{port}'

    server = A2AStarletteApplication(
        agent_card=create_agent_card(agent_url), http_handler=request_handler
    )

    if A2A_TRANSPORT == 'slim':
        print("Running A2A server in SLIM mode.")
        factory = AgntcyFactory()
        transport = factory.create_transport("SLIM", endpoint=agent_url)
        bridge = factory.create_bridge(server, transport=transport)
        await bridge.start(blocking=True)
    else:
        print("Running A2A server in p2p mode.")
        app = server.build()

        app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

        if METRICS_ENABLED:
            app.add_middleware(
                PrometheusMetricsMiddleware,
                excluded_paths=["/.well-known/agent.json", "/.well-known/agent-card.json", "/health", "/ready"],
                metrics_path="/metrics",
                agent_name="kubernetes",
            )

        config = uvicorn.Config(app, host=host, port=port, access_log=False)
        server = uvicorn.Server(config=config)
        await server.serve()


if __name__ == '__main__':
    main()
