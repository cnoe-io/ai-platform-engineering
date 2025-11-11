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
AGENT_NAME = 'grafana'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to interact with Grafana for monitoring, observability, dashboards, alerts, and metrics.'

agent_skill = AgentSkill(
  id="grafana_agent_skill",
  name="Grafana Agent Skill",
  description="Provides capabilities to interact with Grafana for monitoring and observability operations.",
  tags=[
    "grafana",
    "monitoring",
    "observability",
    "dashboards",
    "alerts",
    "metrics"],
  examples=[
      "Show me all dashboards with 'kubernetes' in the name",
      "What alerts are currently firing?",
      "Query Prometheus for CPU usage metrics",
      "Get details for dashboard xyz123",
      "List all datasources in Grafana",
      "Search for dashboards in the 'Production' folder",
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
