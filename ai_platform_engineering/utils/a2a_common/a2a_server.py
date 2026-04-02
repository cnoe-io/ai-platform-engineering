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

from starlette.middleware.cors import CORSMiddleware
from ai_platform_engineering.utils.metrics import PrometheusMetricsMiddleware

logger = logging.getLogger(__name__)

SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

class A2AServer:
    def __init__(self, agent_name: str, agent_description: str, agent_skills: List[AgentSkill], host: str, port: int, agent_executor: AgentExecutor, metrics_enabled: bool = False, version: str = '0.1.0'):
        self.agent_name = agent_name
        self.host = host
        self.port = port

        self.agent_card = AgentCard(
            name=agent_name,
            id=f'{agent_name.lower()}-tools-agent',
            url=f'http://{host}:{port}',
            description=agent_description,
            version=version,
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
        push_sender = BasePushNotificationSender(httpx_client=client, config_store=push_config_store)
        request_handler = DefaultRequestHandler(
            agent_executor=self.agent_executor,
            task_store=InMemoryTaskStore(),
            push_config_store=push_config_store,
            push_sender=push_sender,
        )

        app = A2AStarletteApplication(
            agent_card=self.agent_card,
            http_handler=request_handler,
        ).build()

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        if self.metrics_enabled:
            app.add_middleware(
                PrometheusMetricsMiddleware,
                excluded_paths=["/.well-known/agent.json", "/.well-known/agent-card.json", "/health", "/ready"],
                metrics_path="/metrics",
                agent_name=self.agent_name,
            )

        config = uvicorn.Config(app, host=self.host, port=self.port, access_log=False)
        await uvicorn.Server(config).serve()