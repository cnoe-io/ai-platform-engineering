# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

ARGOCD_AGENT_HOST = os.getenv("ARGOCD_AGENT_HOST", "localhost")
ARGOCD_AGENT_PORT = os.getenv("ARGOCD_AGENT_PORT", "8000")

print("===================================")
print("       ARGOCD AGENT CONFIG         ")
print("===================================")
print(f"ARGOCD_AGENT_HOST: {ARGOCD_AGENT_HOST}")
print(f"ARGOCD_AGENT_PORT: {ARGOCD_AGENT_PORT}")
print("===================================")

ARGOCD_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to list, manage, and retrieve details of applications in ArgoCD.'

argocd_agent_skill = AgentSkill(
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

argocd_agent_card = AgentCard(
  name='ArgoCD',
  id='argocd-tools-agent',
  description=ARGOCD_AGENT_DESCRIPTION,
  url=f'http://{ARGOCD_AGENT_HOST}:{ARGOCD_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[argocd_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
