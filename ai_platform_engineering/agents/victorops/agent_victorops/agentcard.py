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
AGENT_NAME = 'victorops'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to manage VictorOps incidents, services, and on-call operations.'

agent_skill = AgentSkill(
  id="victorops_agent_skill",
  name="VictorOps Agent Skill",
  description="Performs Create, Read, Update, and Delete operations on VictorOps incidents and services.",
  tags=['victorops', 'incident_management', 'on_call', 'devops', 'alerts'],
  examples=[
      # Incident Management
      'Create a new incident in VictorOps.',
      'List all incidents in high urgency state.',
      'Update the urgency of incident #123 to high.',
      'Get details of incident #456.',

      # Incident Notes
      'Add a note to incident #123.',
      'List all notes for incident #123.',
      'Update note "my-note" on incident #123.',
      'Delete note "my-note" from incident #123.',

      # User Management
      'List all users in VictorOps.',

      # Chat
      'Send a chat message to VictorOps.',
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
