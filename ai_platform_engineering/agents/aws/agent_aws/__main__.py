# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import asyncio
import os
from dotenv import load_dotenv

from agent_aws.protocol_bindings.a2a_server.agent_executor import AWSAgentExecutor
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import AgentSkill

load_dotenv()

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"


def build_skills() -> tuple[list[AgentSkill], str]:
    """Build skills list and description based on enabled MCP servers."""
    enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
    enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "true").lower() == "true"
    enable_iam_mcp = os.getenv("ENABLE_IAM_MCP", "true").lower() == "true"

    skills = []
    description_parts = ["AI agent for comprehensive AWS management including:"]

    if enable_eks_mcp:
        skills.append(AgentSkill(
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
                'Add IAM permissions for EKS service account access to S3',
            ],
        ))
        description_parts.append(" Amazon EKS cluster management and Kubernetes operations,")

    if enable_cost_explorer_mcp:
        skills.append(AgentSkill(
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
                'Set up cost alerts for monthly budget',
            ],
        ))
        description_parts.append(" cost analysis and optimization,")

    if enable_iam_mcp:
        skills.append(AgentSkill(
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
                'Delete an unused IAM role with all its policies',
            ],
        ))
        description_parts.append(" IAM security and access management,")

    description_parts.append(" using AWS native tools and best practices.")
    return skills, "".join(description_parts)


@click.command()
@click.option('--host', 'host', default=None, help='Host to bind the server (default: A2A_HOST env or localhost)')
@click.option('--port', 'port', default=None, type=int, help='Port to bind the server (default: A2A_PORT env or 8000)')
def main(host: str | None, port: int | None):
    host = host or os.getenv('A2A_HOST', 'localhost')
    port = port or int(os.getenv('A2A_PORT', '8000'))
    asyncio.run(async_main(host, port))


async def async_main(host: str, port: int):
    skills, description = build_skills()
    server = A2AServer(
        agent_name='aws',
        agent_description=description,
        agent_skills=skills,
        host=host,
        port=port,
        agent_executor=AWSAgentExecutor(),
        metrics_enabled=METRICS_ENABLED,
        version='2.0.0',
    )

    await server.serve()


if __name__ == '__main__':
    main()
