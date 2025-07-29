# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
import uvicorn
from dotenv import load_dotenv

from kb_rag.protocol_bindings.a2a_server.agent import RAGAgent  # type: ignore[import-untyped]
from kb_rag.protocol_bindings.a2a_server.agent_executor import RAGAgentExecutor  # type: ignore[import-untyped]

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

load_dotenv()

@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=8000)
@click.option('--milvus-uri', 'milvus_uri', default='http://localhost:19530')
def main(host: str, port: int, milvus_uri: str):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=RAGAgentExecutor(milvus_uri=milvus_uri),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )

    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int):
    """Returns the Agent Card for the RAG Documentation Agent."""
    capabilities = AgentCapabilities(streaming=False, pushNotifications=False)
    skill = AgentSkill(
        id='rag',
        name='Documentation Q&A',
        description='Answers questions about documentation using RAG.',
        tags=['rag', 'documentation', 'qa', 'milvus', 'vector_search'],
        examples=[
            'What is the API rate limit?',
            'How do I authenticate with the service?',
            'What are the supported configuration options?',
            'Explain how the deployment process works.',
            'What are the best practices for error handling?'
        ],
    )
    return AgentCard(
        name='RAG Documentation Agent',
        description='Agent for answering questions about documentation using Retrieval-Augmented Generation (RAG).',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=RAGAgent.SUPPORTED_CONTENT_TYPES,
        defaultOutputModes=RAGAgent.SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        skills=[skill],
    )


if __name__ == '__main__':
    main() 