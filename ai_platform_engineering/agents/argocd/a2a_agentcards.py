# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

ARGOCD_AGENT_HOST = os.getenv("ARGOCD_AGENT_HOST", "localhost")
ARGOCD_AGENT_PORT = os.getenv("ARGOCD_AGENT_PORT", "8001")

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
    "List all applications in ArgoCD.",
    "Retrieve details of a specific ArgoCD application.",
    "Filter applications by status in ArgoCD.",
    "Show all applications managed by ArgoCD."])

argocd_agent_card = AgentCard(
  name='ArgoCD Management Agent',
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
