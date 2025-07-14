import logging
import sys

import click
import httpx
import uvicorn

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryPushNotifier, InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from dotenv import load_dotenv

from agent_qa.agent import QnAAgent
from agent_qa.a2a_executor import QnAAgentExecutor

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@click.command()
@click.option('--host', 'host', default='0.0.0.0')
@click.option('--port', 'port', default=8096)
def main(host, port):
    """Starts the Graph Q&A agent server."""
    try:
        capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
        skill = AgentSkill(
            id='graph_qa',
            name='Graph Q&A',
            description='Helps answering questions from a knowledge graph',
            tags=['graph', 'qa', 'knowledge_graph'],
            examples=['What do you know about', 'Find all entities of type X', 'What is the relation between entity A and entity B', 'Search for entities related to X'],
        )
        agent_card = AgentCard(
            name='Graph Q&A Agent',
            description='Helps with answering questions from a knowledge graph',
            url=f'http://{host}:{port}/',
            version='1.0.0',
            defaultInputModes=QnAAgent.SUPPORTED_CONTENT_TYPES,
            defaultOutputModes=QnAAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[skill],
        )

        # --8<-- [start:DefaultRequestHandler]
        httpx_client = httpx.AsyncClient()
        request_handler = DefaultRequestHandler(
            agent_executor=QnAAgentExecutor(),
            task_store=InMemoryTaskStore(),
            push_notifier=InMemoryPushNotifier(httpx_client),
        )
        server = A2AStarletteApplication(
            agent_card=agent_card, http_handler=request_handler
        )

        uvicorn.run(server.build(), host=host, port=port)
        # --8<-- [end:DefaultRequestHandler]

    except Exception as e:
        logger.error(f'An error occurred during server startup: {e}')
        sys.exit(1)


if __name__ == '__main__':
    main() 