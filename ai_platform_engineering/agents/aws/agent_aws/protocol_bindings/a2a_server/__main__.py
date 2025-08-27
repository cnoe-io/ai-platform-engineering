# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import click
import httpx
import uvicorn
from dotenv import load_dotenv

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore, BasePushNotificationSender, InMemoryPushNotificationConfigStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)

from .agent_executor import AWSEKSAgentExecutor

# Load environment variables
load_dotenv()


class SimplePushNotifier(BasePushNotificationSender):
    """Simple push notification sender for AWS EKS Agent."""
    
    def __init__(self, client: httpx.AsyncClient, config_store):
        super().__init__(client, config_store)
    
    async def send_push_notification(self, *args, **kwargs):
        """Send push notification (simplified implementation)."""
        # For now, just log the notification
        # In a real implementation, you'd send actual push notifications
        pass


@click.command()
@click.option('--host', 'host', default='localhost', type=str)
@click.option('--port', 'port', default=8000, type=int)
def main(host: str, port: int):
    """Main entry point for the A2A server."""
    # Check environment variables for host and port if not provided via CLI
    env_host = os.getenv('A2A_HOST')
    env_port = os.getenv('A2A_PORT')

    # Use CLI argument if provided, else environment variable, else default
    host = host or env_host or 'localhost'
    port = port or int(env_port) if env_port is not None else 8000

    client = httpx.AsyncClient()
    config_store = InMemoryPushNotificationConfigStore()
    request_handler = DefaultRequestHandler(
        agent_executor=AWSEKSAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_sender=SimplePushNotifier(client, config_store),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), 
        http_handler=request_handler
    )

    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int) -> AgentCard:
    """Returns the Agent Card for the AWS EKS Agent."""
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
    
    skill = AgentSkill(
        id='aws-eks',
        name='AWS EKS Operations',
        description='Performs comprehensive Amazon EKS cluster management and Kubernetes operations.',
        tags=['aws', 'eks', 'kubernetes', 'cloud', 'devops', 'containers'],
        examples=[
            'Create a new EKS cluster named "production" in us-west-2',
            'Deploy a nginx application with 3 replicas to the "frontend" namespace',
            'Get the status and logs of pods in the "backend" namespace',
            'List all services in the "default" namespace with their endpoints',
            'Show CPU and memory metrics for the "api" deployment',
            'Generate a deployment manifest for a Node.js application',
            'Troubleshoot why pods are not starting in the cluster',
            'Add IAM permissions for EKS service account access to S3'
        ],
    )
    
    return AgentCard(
        name='AWS EKS Agent',
        description='AI agent for comprehensive Amazon EKS cluster management, Kubernetes operations, '
                   'application deployment, monitoring, and troubleshooting using AWS native tools.',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=['text/plain'],
        defaultOutputModes=['text/plain'],
        capabilities=capabilities,
        skills=[skill],
    )


if __name__ == '__main__':
    main()
