# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import click
import httpx
from dotenv import load_dotenv

from agent_aws.protocol_bindings.a2a_server.agent import AWSEKSAgent as A2AAWSEKSAgent
from agent_aws.protocol_bindings.a2a_server.agent_executor import AWSEKSAgentExecutor

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import BasePushNotificationSender, InMemoryTaskStore, InMemoryPushNotificationConfigStore
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
    """Start the AWS EKS A2A server."""
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=AWSEKSAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_sender=BasePushNotificationSender(client, InMemoryPushNotificationConfigStore()),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), 
        http_handler=request_handler
    )
    app = server.build()

    # Add CORSMiddleware to allow requests from any origin
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins
        allow_methods=["*"],  # Allow all HTTP methods
        allow_headers=["*"],  # Allow all headers
    )

    import uvicorn
    uvicorn.run(app, host=host, port=port)


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
        security=[{"public": []}],
    )


if __name__ == '__main__':
    main()
