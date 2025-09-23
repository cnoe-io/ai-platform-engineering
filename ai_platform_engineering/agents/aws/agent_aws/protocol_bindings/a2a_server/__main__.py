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

from .agent_executor import AWSAgentExecutor

# Load environment variables
load_dotenv()


class SimplePushNotifier(BasePushNotificationSender):
    """Simple push notification sender for AWS Agent."""
    
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
        agent_executor=AWSAgentExecutor(),
        task_store=InMemoryTaskStore(),
        push_sender=SimplePushNotifier(client, config_store),
    )

    server = A2AStarletteApplication(
        agent_card=get_agent_card(host, port), 
        http_handler=request_handler
    )

    uvicorn.run(server.build(), host=host, port=port)


def get_agent_card(host: str, port: int) -> AgentCard:
    """Returns the Agent Card for the AWS Agent with EKS and Cost Explorer capabilities."""
    capabilities = AgentCapabilities(streaming=True, pushNotifications=True)
    
    # Get environment variables to determine which MCPs are enabled
    enable_eks_mcp = os.getenv('ENABLE_EKS_MCP', 'true').lower() == 'true'
    enable_cost_explorer_mcp = os.getenv('ENABLE_COST_EXPLORER_MCP', 'true').lower() == 'true'
    enable_iam_mcp = os.getenv('ENABLE_IAM_MCP', 'true').lower() == 'true'
    
    skills = []
    
    # Add EKS skill if enabled
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
    
    # Add Cost Explorer skill if enabled
    if enable_cost_explorer_mcp:
        cost_skill = AgentSkill(
            id='aws-cost-explorer',
            name='AWS Cost Management',
            description='Provides comprehensive AWS cost analysis, budget monitoring, and financial optimization insights.',
            tags=['aws', 'cost', 'billing', 'budget', 'optimization', 'finops'],
            examples=[
                'Show AWS costs for the last 3 months broken down by service',
                'Compare costs between April and May 2025',
                'Forecast AWS spending for the next month',
                'What are the most expensive resources in us-east-1?',
                'Show daily cost trends for EC2 instances',
                'Analyze cost increases over the past quarter',
                'Get budget utilization and remaining budget for this month',
                'Show cost breakdown by availability zone'
            ],
        )
        skills.append(cost_skill)
    
    # Add IAM skill if enabled
    if enable_iam_mcp:
        iam_readonly = os.getenv('IAM_MCP_READONLY', 'true').lower() == 'true'
        
        if iam_readonly:
            iam_description = 'Performs AWS Identity and Access Management read-only operations for security analysis and compliance auditing.'
            iam_examples = [
                'List all IAM users and their attached policies',
                'Show IAM role trust policies and permissions',
                'List all IAM groups and their members',
                'Test permissions for a user against specific AWS actions',
                'Analyze IAM policy permissions and simulate access',
                'Audit user access keys and last usage',
                'Review role permissions and policy attachments',
                'Check group memberships and policy inheritance'
            ]
        else:
            iam_description = 'Performs AWS Identity and Access Management operations for security and compliance.'
            iam_examples = [
                'List all IAM users and their attached policies',
                'Create a new IAM user for the development team',
                'Create an IAM role for EC2 instances to access S3',
                'Attach the ReadOnlyAccess policy to a user',
                'List all IAM groups and their members',
                'Generate access keys for a service account',
                'Test permissions for a user against specific AWS actions',
                'Create an inline policy for S3 bucket access'
            ]
        
        iam_skill = AgentSkill(
            id='aws-iam',
            name='AWS IAM Security Management',
            description=iam_description,
            tags=['aws', 'iam', 'security', 'access', 'permissions', 'policy', 'compliance'],
            examples=iam_examples,
        )
        skills.append(iam_skill)
    
    # Determine agent name and description based on enabled MCPs
    if enable_eks_mcp and enable_cost_explorer_mcp and enable_iam_mcp:
        name = 'AWS Management Agent'
        description = ('AI agent for comprehensive AWS management including EKS cluster operations, '
                      'Kubernetes deployment, cost analysis, and IAM security management using AWS native tools.')
    elif enable_eks_mcp and enable_cost_explorer_mcp:
        name = 'AWS Management Agent'
        description = ('AI agent for comprehensive AWS management including EKS cluster operations, '
                      'Kubernetes deployment, and cost analysis using AWS native tools.')
    elif enable_eks_mcp and enable_iam_mcp:
        name = 'AWS Management Agent'
        description = ('AI agent for AWS EKS cluster management, Kubernetes operations, '
                      'and IAM security management using AWS native tools.')
    elif enable_cost_explorer_mcp and enable_iam_mcp:
        name = 'AWS Management Agent'
        description = ('AI agent for AWS cost analysis, financial optimization, '
                      'and IAM security management using AWS native tools.')
    elif enable_eks_mcp:
        name = 'AWS EKS Agent'
        description = ('AI agent for comprehensive Amazon EKS cluster management, Kubernetes operations, '
                      'application deployment, monitoring, and troubleshooting using AWS native tools.')
    elif enable_cost_explorer_mcp:
        name = 'AWS Cost Management Agent'
        description = ('AI agent for AWS cost analysis, budget monitoring, and financial optimization '
                      'using AWS Cost Explorer and billing tools.')
    elif enable_iam_mcp:
        name = 'AWS IAM Security Agent'
        description = ('AI agent for AWS Identity and Access Management operations, '
                      'security compliance, and access control using AWS native tools.')
    else:
        name = 'AWS Agent'
        description = 'AI agent for AWS operations (no MCP servers enabled).'
    
    return AgentCard(
        name=name,
        description=description,
        url=f'http://{host}:{port}/',
        version='1.0.0',
        defaultInputModes=['text/plain'],
        defaultOutputModes=['text/plain'],
        capabilities=capabilities,
        skills=skills,
    )


if __name__ == '__main__':
    main()
