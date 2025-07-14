# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

WEBEX_AGENT_HOST = os.getenv("WEBEX_AGENT_HOST", "localhost")
WEBEX_AGENT_PORT = os.getenv("WEBEX_AGENT_PORT", "8000")
print("===================================")
print("       WEBEX AGENT CONFIG          ")
print("===================================")
print(f"WEBEX_AGENT_HOST: {WEBEX_AGENT_HOST}")
print(f"WEBEX_AGENT_PORT: {WEBEX_AGENT_PORT}")
print("===================================")
WEBEX_AGENT_DESCRIPTION = (
  "An AI agent that integrates with Webex to assist with managing spaces, "
  "sending messages, retrieving user information, and other Webex-based operations."
)

webex_agent_skill = AgentSkill(
  id="webex_agent_skill",
  name="Webex Spaces and Messages Skill",
  description="Provides Webex-based capabilities to manage spaces, send messages, and retrieve user information.",
  tags=[
    "webex",
    "spaces",
    "messages"],
  examples=[
      "Send a message to the 'devops' Webex space.",
      "List all members of the 'engineering' Webex space.",
      "Create a new Webex space named 'project-updates'.",
      "Archive the 'old-project' Webex space.",
      "Post a notification to the 'alerts' Webex space."
  ])

webex_agent_card = AgentCard(
  name='Webex',
  id='webex-tools-agent',
  description=WEBEX_AGENT_DESCRIPTION,
  url=f'http://{WEBEX_AGENT_HOST}:{WEBEX_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[webex_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
