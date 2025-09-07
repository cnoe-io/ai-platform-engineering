# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
from typing import List

from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import (
    AgntcySlimRemoteAgentConnectTool,
)
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill
)

SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

# Check which MCP servers are enabled
ENABLE_EKS_MCP = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
ENABLE_COST_EXPLORER_MCP = os.getenv("ENABLE_COST_EXPLORER_MCP", "false").lower() == "true"

# Define skills based on enabled MCP servers
skills = []

# EKS skill (enabled by default)
if ENABLE_EKS_MCP:
    eks_skill = AgentSkill(
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
    skills.append(eks_skill)

# Cost Explorer skill (optional)
if ENABLE_COST_EXPLORER_MCP:
    cost_skill = AgentSkill(
        id="aws_cost_explorer_skill",
        name="AWS Cost Management",
        description="AWS cost analysis, optimization, and financial operations management",
        tags=[
            "aws",
            "cost",
            "billing",
            "finops",
            "optimization",
            "budget"
        ],
        examples=[
            "Show AWS costs for the last 3 months by service",
            "Analyze EC2 costs by instance type",
            "What are my top 5 most expensive AWS services?",
            "Generate cost report for us-west-2 region",
            "Show cost trends and forecast for next 3 months",
            "Find cost optimization opportunities",
            "Compare costs between different regions",
            "Analyze EKS cluster costs and utilization",
            "Set up cost alerts for monthly budget",
            "Show Reserved Instance recommendations"
        ]
    )
    skills.append(cost_skill)

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(base_url: str) -> AgentCard:
    """Create agent card for AWS agent with multi-MCP support."""
    
    print("===================================")
    print("       AWS AGENT CONFIG      ")
    print("===================================")
    print(f"AGENT_URL: {base_url}")
    print(f"EKS MCP Enabled: {ENABLE_EKS_MCP}")
    print(f"Cost Explorer MCP Enabled: {ENABLE_COST_EXPLORER_MCP}")
    print("===================================")
    
    # Build description based on enabled capabilities
    description_parts = ["AWS AI Assistant for comprehensive AWS management including:"]
    
    if ENABLE_EKS_MCP:
        description_parts.append(" Amazon EKS cluster management and Kubernetes operations,")
    
    if ENABLE_COST_EXPLORER_MCP:
        description_parts.append(" cost analysis and optimization,")
    
    description_parts.append(" using AWS native tools and best practices.")
    description = "".join(description_parts)
    
    return AgentCard(
        name="aws",
        id="aws-multi-mcp-agent",
        description=description,
        url=base_url,
        version='2.0.0',  # Increment version for multi-MCP support
        defaultInputModes=['text', 'text/plain'],
        defaultOutputModes=['text', 'text/plain'],
        capabilities=capabilities,
        skills=skills,  # Use the dynamically created skills list
        security=[{"public": []}],
    )

agent_card = create_agent_card(SLIM_ENDPOINT)

# Create tool map with all skills
tool_map = {}
for skill in skills:
    tool_map[f"{agent_card.name}_{skill.id}"] = skill.examples

# Initialize the SLIM remote agent connect tool
a2a_remote_agent = AgntcySlimRemoteAgentConnectTool(
    name="aws_agent",
    description=agent_card.description,
    endpoint=SLIM_ENDPOINT,
    remote_agent_card=agent_card,
)

def get_examples() -> List[str]:
    """Get example prompts for the AWS agent."""
    all_examples = []
    for skill in skills:
        all_examples.extend(skill.examples)
    return all_examples

def get_skill_examples() -> List[str]:
    """Get skill examples for the AWS agent."""
    all_examples = []
    for skill in skills:
        all_examples.extend(skill.examples)
    return all_examples

def agent_card_func():
    """Return the agent card."""
    return agent_card
