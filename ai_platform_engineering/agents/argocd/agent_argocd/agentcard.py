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
AGENT_NAME = 'argocd'
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
      # Account Management
      "Get the details of the current account.",
      "List all accounts.",

      # Token/Password Management (Not exposed by default due to security reasons)
      # "Update the password for the current account.",
      # "Create a new token for the current account.",
      # "Delete a token for the current account.",

      # RBAC Check
      "Check if the current account has permission to delete the 'ai-platform-app' from ArgoCD.",

      # Application Management
      "Create a new ArgoCD application named 'ai-platform-app'.",
      "Get the status of the 'ai-platform-app' ArgoCD application.",
      "Update the repo url for 'ai-platform-app' app",
      "Sync the 'ai-platform-app' ArgoCD application",
      "Check if the current account has permission to delete the 'ai-platform-app' from ArgoCD."
      "Delete the 'ai-platform-app' from ArgoCD.",

      # Resource Events
      "List the events for the 'ai-platform-app' ArgoCD application.",

      # Get Pod Logs
      "Get the logs for the 'ai-platform-app' ArgoCD application.",

      # Projects
      "List all projects in ArgoCD.",
      "Create a new project named 'ai-platform-project' in ArgoCD.",
      "Get the details of the 'ai-platform-project' project from ArgoCD.",
      "Update the 'ai-platform-project' project in ArgoCD to have a description of 'This is a test project'.",
      "Delete the 'ai-platform-project' project from ArgoCD.",

      # ApplicationSets
      "Generate an application set with a single in-cluster generator and a basic template.",
      "Generate an application set with extra metadata labels.",
      "Create an applicationset 'guestbook' with a single in-cluster generator and a basic template.",
      "List all applicationsets in ArgoCD.",
      "Get the details of the 'guestbook' applicationset from ArgoCD.",
      "Delete the 'guestbook' applicationset from ArgoCD.",

      # Certificates
      "List all certificates in ArgoCD.",

      # Clusters
      "List all clusters in ArgoCD.",
      "Get the details of the 'in-cluster' cluster from ArgoCD.",

      # GPG Keys
      "Create a new GPG key with a fingerprint of '1234567890'.",
      "List all GPG keys in ArgoCD.",
      "Get the details of the '1234567890' GPG key from ArgoCD.",
      "Delete the GPG key with a fingerprint of '1234567890'.",
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
