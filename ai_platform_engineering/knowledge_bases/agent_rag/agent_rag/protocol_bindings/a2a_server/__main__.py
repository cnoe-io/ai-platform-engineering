# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
import uvicorn
import os
import logging
from dotenv import load_dotenv

from .agent import RAGAgent  # type: ignore[import-untyped]
from .agent_executor import RAGAgentExecutor  # type: ignore[import-untyped]

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

# Configure root logger
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

load_dotenv()

@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=8000)
def main(host: str, port: int):
    logger = logging.getLogger(__name__)
    client = httpx.AsyncClient()
    
    # Get Milvus URI from environment variable, default to localhost
    milvus_uri = os.getenv('MILVUS_URI', 'http://localhost:19530')
    logger.debug(f"Using Milvus URI: {milvus_uri}")
    
    # Initialize RAGAgent with Milvus URI
    logger.info("Initializing RAG Agent...")
    rag_agent = RAGAgent(milvus_uri=milvus_uri)
    
    logger.info("Setting up request handler...")
    request_handler = DefaultRequestHandler(
        agent_executor=RAGAgentExecutor(agent=rag_agent),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    logger.info("Building server application...")
    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )
    app = server.build()
    
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="debug")


def get_agent_card(host: str, port: int):
    """Returns the Agent Card for the RAG Documentation Agent."""
    capabilities = AgentCapabilities(streaming=False, pushNotifications=False)
    skill = AgentSkill(
        id='rag',
        name='Documentation Q&A',
        description='Ingests documentation from a URL and answers questions using RAG.',
        tags=['rag', 'documentation', 'qa', 'milvus'],
        examples=[
            'Ingest documentation from https://example.com/docs',
            'What is the API rate limit?',
            'How do I authenticate with the service?'
        ],
    )
    return AgentCard(
        name='RAG Documentation Agent',
        description='A RAG agent that ingests documentation from any URL and answers questions using Retrieval-Augmented Generation (RAG) with Milvus.',
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