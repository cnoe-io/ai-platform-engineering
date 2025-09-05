# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
from typing import List

from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill
)

# AWS Agent configuration
AGENT_HOST = os.getenv("AWS_AGENT_HOST", "localhost")
AGENT_PORT = os.getenv("AWS_AGENT_PORT", "8000")
agent_url = f'http://{AGENT_HOST}:{AGENT_PORT}'

# Define the skill for AWS EKS operations
agent_skill = AgentSkill(
    id="aws_eks_skill",
    name="AWS EKS Management",
    description="Comprehensive AWS EKS cluster management and Kubernetes operations",
    tags=[
        "aws",
        "eks",
        "kubernetes",
        "cluster management",
        "container orchestration"
    ],
    examples=[
        "Create a new EKS cluster named 'production-cluster'",
        "List all running pods in the default namespace",
        "Deploy an application to EKS cluster",
        "Get CloudWatch logs for pod 'my-app'",
        "Create IAM role for EKS service account",
        "Generate Kubernetes deployment manifest",
        "Check EKS cluster status",
        "Scale deployment to 5 replicas",
        "Delete EKS cluster 'test-cluster'",
        "Get EKS troubleshooting guidance for pod failures"
    ]
)

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(base_url: str) -> AgentCard:
    """Create agent card for AWS EKS agent."""

    print("===================================")
    print("       AWS AGENT CONFIG      ")
    print("===================================")
    print(f"AGENT_URL: {base_url}")
    print("===================================")

    return AgentCard(
        name="aws",
        id="aws-eks-tools-agent",
        description=(
            "AWS EKS AI Assistant specialized in Amazon EKS cluster management and Kubernetes operations. "
            "Provides comprehensive EKS and Kubernetes management including cluster lifecycle, "
            "resource operations, application deployment, monitoring, troubleshooting, and security management."
        ),
        url=base_url,
        version='0.1.0',
        defaultInputModes=['text', 'text/plain'],
        defaultOutputModes=['text', 'text/plain'],
        capabilities=capabilities,
        skills=[agent_skill],
        security=[{"public": []}],
    )

agent_card = create_agent_card(agent_url)

tool_map = {
    agent_card.name: agent_skill.examples
}

# Initialize the A2A remote agent connect tool
a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="aws_eks_agent",
    description=agent_card.description,
    remote_agent_card=agent_card,
    skill_id=agent_skill.id,
)

def get_examples() -> List[str]:
    """Get example prompts for the AWS EKS agent."""
    return agent_skill.examples

def get_skill_examples() -> List[str]:
    """Get skill examples for the AWS EKS agent."""
    return agent_skill.examples

def agent_card_func():
    """Return the agent card."""
    return agent_card

agent_card = create_agent_card(agent_url)

tool_map = {
    agent_card.name: agent_skill.examples
}

# Initialize the A2A remote agent connect tool (standard approach)
a2a_remote_agent = A2ARemoteAgentConnectTool(
    name="aws_eks_agent",
    description=agent_card.description,
    remote_agent_card=agent_card,
    skill_id=agent_skill.id,
)

