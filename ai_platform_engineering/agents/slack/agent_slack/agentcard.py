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
AGENT_NAME = 'Slack'
AGENT_DESCRIPTION = (
  "An AI agent that integrates with Slack to assist with managing channels, "
  "sending messages, retrieving user information, and other Slack-based operations."
)

agent_skill = AgentSkill(
  id="slack_agent_skill",
  name="Slack Channel Management Skill",
  description="Provides Slack-based capabilities to manage channels, send messages, and retrieve user information.",
  tags=[
    "slack",
    "chatops"],
  examples=[
      "Send a message to the 'devops' Slack channel.",
      "List all members of the 'engineering' Slack workspace.",
      "Create a new Slack channel named 'project-updates'.",
      "Archive the 'old-project' Slack channel.",
      "Post a notification to the 'alerts' Slack channel."
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
