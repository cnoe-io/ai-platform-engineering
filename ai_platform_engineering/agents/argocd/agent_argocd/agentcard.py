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
AGENT_NAME = 'ArgoCD'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to list, manage, and retrieve details of applications in ArgoCD.'

agent_skill = AgentSkill(
  id="argocd_agent_skill",
  name="ArgoCD Agent Skill",
  description="Provides capabilities to list and manage applications in ArgoCD.",
  tags=[
    "argocd",
    "list apps",
    "gitops"],
  examples=[
      "Create a new ArgoCD application named 'my-app'.",
      "Get the status of the 'frontend' ArgoCD application.",
      "Update the image version for 'backend' app.",
      "Delete the 'test-app' from ArgoCD.",
      "Sync the 'production' ArgoCD application to the latest commit."
  ])

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
