# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

JIRA_AGENT_HOST = os.getenv("JIRA_AGENT_HOST", "localhost")
JIRA_AGENT_PORT = os.getenv("JIRA_AGENT_PORT", "8000")

print("===================================")
print("       JIRA AGENT CONFIG           ")
print("===================================")
print(f"JIRA_AGENT_HOST: {JIRA_AGENT_HOST}")
print(f"JIRA_AGENT_PORT: {JIRA_AGENT_PORT}")
print("===================================")

JIRA_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform Jira operations.'

jira_agent_skill = AgentSkill(
  id="jira_agent_skill",
  name="Jira Agent Skill",
  description="Provides capabilities to perform Jira operations.",
  tags=[
    "jira",
    "issue-tracking"],
  examples=[
      "Create a new Jira issue in the 'AI Project' project.",
      "List all Jira issues in the 'Platform Engineering' project.",
      "Search for Jira issues with the label 'urgent'.",
      "Search for issues in the 'Platform Engineering' project containing the keyword 'deployment'.",
  ])

jira_agent_card = AgentCard(
  name='Jira',
  id='jira-tools-agent',
  description=JIRA_AGENT_DESCRIPTION,
  url=f'http://{JIRA_AGENT_HOST}:{JIRA_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[jira_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
