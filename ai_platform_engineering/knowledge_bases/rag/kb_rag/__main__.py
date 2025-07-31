# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import click
import httpx
import logging
from dotenv import load_dotenv

from kb_rag.protocol_bindings.a2a_server.agent_executor import RAGAgentExecutor  # type: ignore[import-untyped]

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotificationConfigStore, BasePushNotificationSender, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

from starlette.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=8000)

def main(host: str, port: int):
    milvus_uri = os.getenv('MILVUS_URI', 'milvus-standalone:19530')
    logger.info(f"Starting RAG agent with Milvus URI: {milvus_uri}")
    client = httpx.AsyncClient()
    push_notification_config_store = InMemoryPushNotificationConfigStore()
    push_notification_sender = BasePushNotificationSender(client, config_store=push_notification_config_store)
    request_handler = DefaultRequestHandler(
        agent_executor=RAGAgentExecutor(milvus_uri=milvus_uri),
        task_store=InMemoryTaskStore(),
        push_config_store=push_notification_config_store,
        push_sender=push_notification_sender
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )
    app = server.build()

    # Add CORSMiddleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    import uvicorn
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)


def get_agent_card(host: str, port: int):
    """Returns the Agent Card for the RAG Documentation Agent."""
    capabilities = AgentCapabilities(streaming=False, pushNotifications=False)
    skill = AgentSkill(
        id='rag',
        name='Documentation Q&A',
        description='Answers questions about documentation using RAG.',
        tags=['rag', 'documentation', 'qa', 'milvus'],
        examples=[
            'What is the API rate limit?',
            'How do I authenticate with the service?',
            'What are the supported configuration options?'
        ],
    )
    return AgentCard(
        name='RAG Documentation Agent',
        description='A RAG agent that answers questions about documentation using Retrieval-Augmented Generation (RAG) with Milvus.',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=['text', 'text/plain'],
        defaultOutputModes=['text', 'text/plain'],
        capabilities=capabilities,
        skills=[skill],
        authentication={"schemes": ["public"]},
    )


if __name__ == '__main__':
    main() 