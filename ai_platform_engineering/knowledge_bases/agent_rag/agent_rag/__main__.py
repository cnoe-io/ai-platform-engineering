# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
from dotenv import load_dotenv

from agent_rag.protocol_bindings.a2a_server.agent import RAGAgent  # type: ignore[import-untyped]
from agent_rag.protocol_bindings.a2a_server.agent_executor import RAGAgentExecutor  # type: ignore[import-untyped]

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
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=8000)
def main(host: str, port: int):
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=RAGAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(client),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), http_handler=request_handler
    )
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