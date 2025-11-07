# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import asyncio
import os
from dotenv import load_dotenv

from agent_argocd.protocol_bindings.a2a_server.agent_executor import ArgoCDAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

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

# We can't use click decorators for async functions so we wrap the main function in a sync function
@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))

async def async_main(host: str, port: int):
    server = A2AServer(
        agent_name=AGENT_NAME,
        agent_description=AGENT_DESCRIPTION,
        agent_skills=[agent_skill],
        host=host,
        port=port,
        transport=A2A_TRANSPORT,
        slim_endpoint=SLIM_ENDPOINT,
        agent_executor=ArgoCDAgentExecutor()
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
