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
AGENT_NAME = 'jira'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform Jira operations.'

agent_skill = AgentSkill(
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
