# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

SLACK_AGENT_HOST = os.getenv("SLACK_AGENT_HOST", "localhost")
SLACK_AGENT_PORT = os.getenv("SLACK_AGENT_PORT", "8000")
print("===================================")
print("       SLACK AGENT CONFIG          ")
print("===================================")
print(f"SLACK_AGENT_HOST: {SLACK_AGENT_HOST}")
print(f"SLACK_AGENT_PORT: {SLACK_AGENT_PORT}")
print("===================================")
SLACK_AGENT_DESCRIPTION = (
  "An AI agent that integrates with Slack to assist with managing channels, "
  "sending messages, retrieving user information, and other Slack-based operations."
)

slack_agent_skill = AgentSkill(
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

slack_agent_card = AgentCard(
  name='Slack',
  id='slack-tools-agent',
  description=SLACK_AGENT_DESCRIPTION,
  url=f'http://{SLACK_AGENT_HOST}:{SLACK_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[slack_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
