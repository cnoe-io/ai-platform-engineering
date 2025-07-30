# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

CONFLUENCE_AGENT_HOST = os.getenv("CONFLUENCE_AGENT_HOST", "localhost")
CONFLUENCE_AGENT_PORT = os.getenv("CONFLUENCE_AGENT_PORT", "8000")
print("===================================")
print("       CONFLUENCE AGENT CONFIG     ")
print("===================================")
print(f"CONFLUENCE_AGENT_HOST: {CONFLUENCE_AGENT_HOST}")
print(f"CONFLUENCE_AGENT_PORT: {CONFLUENCE_AGENT_PORT}")
print("===================================")

CONFLUENCE_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform Confluence operations.'

confluence_agent_skill = AgentSkill(
  id="confluence_agent_skill",
  name="Confluence Agent Skill",
  description="Provides capabilities to perform Confluence operations.",
  tags=[
    "confluence",
    "wiki"],
  examples=[
      "Create a new Confluence page in the 'AI Project' space.",
      "List all pages in the 'Platform Engineering' space.",
      "Search for Confluence pages with the label 'urgent'.",
      "Search for pages in the 'Platform Engineering' space containing the keyword 'deployment'.",
  ])

confluence_agent_card = AgentCard(
  name='Confluence',
  id='confluence-tools-agent',
  description=CONFLUENCE_AGENT_DESCRIPTION,
  url=f'http://{CONFLUENCE_AGENT_HOST}:{CONFLUENCE_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[confluence_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
