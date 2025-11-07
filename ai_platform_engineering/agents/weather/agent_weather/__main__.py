# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import asyncio
import os
from dotenv import load_dotenv

from agent_weather.protocol_bindings.a2a_server.agent_executor import WeatherAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

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

# We can't use click decorators for async functions so we wrap the main function in a sync function
@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10000)
def main(host: str, port: int):
    asyncio.run(async_main(host, port))

async def async_main(host: str, port: int):
    server = A2AServer(
        agent_name=AGENT_NAME,
        agent_description=AGENT_DESCRIPTION,
        agent_skills=[agent_skill],
        host=host,
        port=port,
        transport=A2A_TRANSPORT,
        slim_endpoint=SLIM_ENDPOINT,
        agent_executor=WeatherAgentExecutor()
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
