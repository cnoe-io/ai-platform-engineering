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
AGENT_NAME = 'Backstage'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to interact with Backstage for catalog management, entity lookup, and service metadata.'

agent_skill = AgentSkill(
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
