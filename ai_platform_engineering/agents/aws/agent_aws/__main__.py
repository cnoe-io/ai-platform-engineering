# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import os
import click
import httpx
from dotenv import load_dotenv

from agent_aws.protocol_bindings.a2a_server.agent_executor import AWSAgentExecutor

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
@click.option('--host', 'host', default=None, help='Host to bind the server (default: A2A_HOST env or localhost)')
@click.option('--port', 'port', default=None, type=int, help='Port to bind the server (default: A2A_PORT env or 8000)')
def main(host: str | None, port: int | None):
    """Start the AWS A2A server with multi-MCP support."""
    # Priority: CLI args > Environment variables > Defaults
    host = host or os.getenv('A2A_HOST', 'localhost')
    port = port or int(os.getenv('A2A_PORT', '8000'))
    client = httpx.AsyncClient()
    request_handler = DefaultRequestHandler(
        agent_executor=AWSAgentExecutor(),
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
    """Returns the Agent Card for the AWS Agent with multi-MCP support."""
    import os

    # Check which MCP servers are enabled
    enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
    enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "true").lower() == "true"
    enable_iam_mcp = os.getenv("ENABLE_IAM_MCP", "true").lower() == "true"

    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

    # Build skills based on enabled MCP servers
    skills = []

    if enable_eks_mcp:
        eks_skill = AgentSkill(
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
        skills.append(eks_skill)

    if enable_cost_explorer_mcp:
        cost_skill = AgentSkill(
            id='aws-cost',
            name='AWS Cost Management',
            description='Performs AWS cost analysis, optimization, and financial operations management.',
            tags=['aws', 'cost', 'billing', 'finops', 'optimization', 'budget'],
            examples=[
                'Show AWS costs for the last 3 months by service',
                'Analyze EC2 costs by instance type',
                'What are my top 5 most expensive AWS services?',
                'Generate cost report for us-west-2 region',
                'Show cost trends and forecast for next 3 months',
                'Find cost optimization opportunities',
                'Compare costs between different regions',
                'Set up cost alerts for monthly budget'
            ],
        )
        skills.append(cost_skill)

    if enable_iam_mcp:
        iam_skill = AgentSkill(
            id='aws-iam',
            name='AWS IAM Security Management',
            description='Performs AWS Identity and Access Management operations for security and compliance.',
            tags=['aws', 'iam', 'security', 'access', 'permissions', 'policy', 'compliance'],
            examples=[
                'List all IAM users and their attached policies',
                'Create a new IAM user for the development team',
                'Create an IAM role for EC2 instances to access S3',
                'Attach the ReadOnlyAccess policy to a user',
                'List all IAM groups and their members',
                'Generate access keys for a service account',
                'Test permissions for a user against specific AWS actions',
                'Create an inline policy for S3 bucket access',
                'Add a user to the Developers group',
                'Delete an unused IAM role with all its policies'
            ],
        )
        skills.append(iam_skill)

    # Build description based on enabled capabilities
    description_parts = ["AI agent for comprehensive AWS management including:"]

    if enable_eks_mcp:
        description_parts.append(" Amazon EKS cluster management and Kubernetes operations,")

    if enable_cost_explorer_mcp:
        description_parts.append(" cost analysis and optimization,")

    if enable_iam_mcp:
        description_parts.append(" IAM security and access management,")

    description_parts.append(" using AWS native tools and best practices.")
    description = "".join(description_parts)

    return AgentCard(
        name='AWS Agent',
        description=description,
        url=f'http://{host}:{port}/',
        version='2.0.0',  # Increment version for multi-MCP support
        defaultInputModes=['text/plain'],
        defaultOutputModes=['text/plain'],
        capabilities=capabilities,
        skills=skills,
        security=[{"public": []}],
    )


if __name__ == '__main__':
    main()
