# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from typing import List
import httpx
import uvicorn
import logging
from a2a.server.apps import A2AStarletteApplication
from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.types import (
  AgentCard,
  AgentSkill,
  AgentCapabilities
)
from a2a.server.tasks import (
    BasePushNotificationSender,
    InMemoryPushNotificationConfigStore,
    InMemoryTaskStore,
)
from agntcy_app_sdk.factory import AgntcyFactory

from starlette.middleware.cors import CORSMiddleware
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware

logger = logging.getLogger(__name__)

SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

class A2AServer:
    def __init__(self, agent_name: str, agent_description: str, agent_skills: List[AgentSkill], host: str, port: int, agent_executor: AgentExecutor, transport: str, slim_endpoint: str, metrics_enabled: bool = False):
        self.agent_name = agent_name
        self.agent_description = agent_description
        
        self.host = host
        self.port = port
        self.transport = transport
        self.slim_endpoint = slim_endpoint
        
        if self.transport == "slim":
            self.url = self.slim_endpoint
        else:
            self.url = f'http://{self.host}:{self.port}'
        
        self.agent_card = AgentCard(
            name=agent_name,
            id=f'{agent_name.lower()}-tools-agent',
            url=self.url,
            description=agent_description,
            version='0.1.0',
            defaultInputModes=SUPPORTED_CONTENT_TYPES,
            defaultOutputModes=SUPPORTED_CONTENT_TYPES,
            capabilities=AgentCapabilities(streaming=True, pushNotifications=True),
            skills=agent_skills,
            security=[{"public": []}],
        )
        self.agent_executor = agent_executor
        self.metrics_enabled = metrics_enabled
        
    async def serve(self):
        client = httpx.AsyncClient()
        push_config_store = InMemoryPushNotificationConfigStore()
        push_sender = BasePushNotificationSender(httpx_client=client,
                        config_store=push_config_store)
        request_handler = DefaultRequestHandler(
            agent_executor=self.agent_executor,
            task_store=InMemoryTaskStore(),
            push_config_store=push_config_store,
            push_sender= push_sender
        )

        server = A2AStarletteApplication(
            agent_card=self.agent_card, 
            http_handler=request_handler
        )

        if self.transport == 'slim':
            # Run A2A server over SLIM transport
            # https://docs.agntcy.org/messaging/slim-core/
            logger.info("Running A2A server in SLIM mode.")
            factory = AgntcyFactory()
            transport = factory.create_transport("SLIM", endpoint=self.url)
            logger.info("Transport created successfully.")

            bridge = factory.create_bridge(server, transport=transport)
            logger.info("Bridge created successfully. Starting the bridge.")
            await bridge.start(blocking=True)
        else:
            # Run a p2p A2A server
            logger.info("Running A2A server in p2p mode.")
            app = server.build()

            # Add CORSMiddleware to allow requests from any origin (disables CORS restrictions)
            app.add_middleware(
                CORSMiddleware,
                allow_origins=["*"],  # Allow all origins
                allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
                allow_headers=["*"],  # Allow all headers
            )

            # Add Prometheus metrics middleware if enabled
            if self.metrics_enabled:
                app.add_middleware(
                    PrometheusMetricsMiddleware,
                    excluded_paths=["/.well-known/agent.json", "/.well-known/agent-card.json", "/health", "/ready"],
                    metrics_path="/metrics",
                    agent_name=self.agent_name,
                )

            # Disable uvicorn access logs to reduce noise from health checks
            config = uvicorn.Config(app, host=self.host, port=self.port, access_log=False)
            server = uvicorn.Server(config=config)
            await server.serve()