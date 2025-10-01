# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# Modify these values for your specific agent
# ==================================================
AGENT_NAME = 'kubernetes'
AGENT_DESCRIPTION = "An AI agent that interacts with Kubernetes clusters to manage resources, troubleshoot issues, and automate operations."

agent_skill = AgentSkill(
  id="kubernetes_agent_skill",
  name="Kubernetes Agent Skill",
  description="Handles tasks related to Kubernetes cluster management, resource operations, troubleshooting, and context switching.",
  tags=[
    "kubernetes",
    "cluster management",
    "resource operations",
    "troubleshooting",
    "context switching"
  ],
  examples=[
    "What is the status of my Kubernetes cluster?",
    "What is wrong with my nginx pod?",
    "Show me all deployments in the production namespace.",
    "Scale my web deployment to 5 replicas.",
    "Check if I have permission to create pods.",
    "What is my current kubectl context?",
    "List all available kubectl contexts.",
    "Switch to the production context."
  ]
)

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# This section is reusable across all agents
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{AGENT_NAME.lower()}-tools-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill],
    # Using the security field instead of the non-existent AgentAuthentication class
    security=[{"public": []}],
  )
