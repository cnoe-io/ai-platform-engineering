# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

ATLASSIAN_AGENT_HOST = os.getenv("ATLASSIAN_AGENT_HOST", "localhost")
ATLASSIAN_AGENT_PORT = os.getenv("ATLASSIAN_AGENT_PORT", "8002")

ATLASSIAN_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform Jira operations.'

atlassian_agent_skill = AgentSkill(
  id="atlassian_agent_skill",
  name="Atlassian Agent Skill",
  description="Provides capabilities to perform Jira operations.",
  tags=[
    "atlassian",
    "jira",
    "gitops"],
  examples=[
      "Create a new Jira ticket for the 'AI Project'.",
      "List all open tickets in the 'Platform Engineering' project.",
      "Update the status of ticket 'AI-123' to 'In Progress'.",
      "Assign ticket 'PE-456' to user 'john.doe'.",
      "Get details of the Jira ticket 'AI-789'."
      "Search for Jira tickets with the label 'urgent'.",
      "Search using JQL for tickets assigned to 'john.doe' in the 'Platform Engineering' project.",
  ])

atlassian_agent_card = AgentCard(
  name='Jira',
  id='atlassian-tools-agent',
  description=ATLASSIAN_AGENT_DESCRIPTION,
  url=f'http://{ATLASSIAN_AGENT_HOST}:{ATLASSIAN_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[atlassian_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
