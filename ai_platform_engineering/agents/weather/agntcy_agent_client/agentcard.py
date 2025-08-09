# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
import os
from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

WEATHER_AGENT_HOST = os.getenv("WEATHER_AGENT_HOST", "slim-dataplane")
WEATHER_AGENT_PORT = os.getenv("WEATHER_AGENT_PORT", "46357")

print("===================================")
print("       WEATHER AGENT CONFIG         ")
print("===================================")
print(f"WEATHER_AGENT_HOST: {WEATHER_AGENT_HOST}")
print(f"WEATHER_AGENT_PORT: {WEATHER_AGENT_PORT}")
print("===================================")

WEATHER_AGENT_DESCRIPTION = 'An AI agent that provides capabilities to list, manage, and retrieve weather information and forecasts.'

weather_agent_skill = AgentSkill(
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

weather_agent_card = AgentCard(
  name='Weather',
  description=WEATHER_AGENT_DESCRIPTION,
  url=f'{WEATHER_AGENT_HOST}:{WEATHER_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[weather_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
