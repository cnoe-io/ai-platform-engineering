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
AGENT_NAME = 'splunk'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform Splunk operations including log searches, alert management, and system monitoring.'

agent_skill = AgentSkill(
  id="splunk_agent_skill",
  name="Splunk Agent Skill",
  description="Handles tasks related to Splunk log searches, alerts, detectors, and system monitoring.",
  tags=[
    "splunk",
    "logging", 
    "monitoring",
    "alerts",
    "search",
    "detectors",
    "incidents"],
  examples=[
      "Search for error logs in the last 24 hours",
      "Create an alert for high CPU usage",
      "List all active detectors",
      "Get system status and health metrics",
      "Search for specific application logs",
      "Manage alert muting rules",
      "Check incident status",
      "Query team information and members"
  ])

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# This section is reusable across all agents
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(agent_url):
  print("===================================")
  print(f"Creating agent card for: {AGENT_NAME}")
  print(f"Agent URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=f"{AGENT_NAME.title()} Agent",
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version="1.0.0",
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill]
  ) 