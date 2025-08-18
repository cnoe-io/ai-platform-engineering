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
AGENT_NAME = 'weather'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform weather operations.'

agent_skill = AgentSkill(
  id="weather_agent_skill",
  name="Weather Agent Skill",
  description="Provides capabilities to retrieve current weather, forecasts, and weather-related data.",
  tags=[
    "weather",
    "forecast",
    "temperature",
    "humidity",
    "conditions"
  ],
  examples=[
      "Get the current weather in New York.",
      "Show the 5-day forecast for London.",
      "What is the humidity in Tokyo right now?",
      "Will it rain tomorrow in Paris?",
      "Provide the temperature and conditions for San Francisco."
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
