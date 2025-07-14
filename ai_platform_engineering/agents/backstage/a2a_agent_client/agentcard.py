# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

BACKSTAGE_AGENT_HOST = os.getenv("BACKSTAGE_AGENT_HOST", "localhost")
BACKSTAGE_AGENT_PORT = os.getenv("BACKSTAGE_AGENT_PORT", "8000")

print("===================================")
print("       BACKSTAGE AGENT CONFIG      ")
print("===================================")
print(f"BACKSTAGE_AGENT_HOST: {BACKSTAGE_AGENT_HOST}")
print(f"BACKSTAGE_AGENT_PORT: {BACKSTAGE_AGENT_PORT}")
print("===================================")

BACKSTAGE_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to interact with Backstage for catalog management, entity lookup, and service metadata.'

backstage_agent_skill = AgentSkill(
  id="backstage_agent_skill",
  name="Backstage Agent Skill",
  description="Provides capabilities to manage and query Backstage catalog entities and metadata.",
  tags=[
    "backstage",
    "catalog",
    "entity lookup",
    "service metadata"
  ],
  examples=[
      "List all entities in the Backstage catalog.",
      "Get details for the 'frontend' service in Backstage.",
      "Search for all components owned by 'team-a'.",
      "Add a new API entity to the Backstage catalog.",
      "Update metadata for the 'backend' service."
  ])

backstage_agent_card = AgentCard(
  name='Backstage',
  id='backstage-tools-agent',
  description=BACKSTAGE_AGENT_DESCRIPTION,
  url=f'http://{BACKSTAGE_AGENT_HOST}:{BACKSTAGE_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[backstage_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)