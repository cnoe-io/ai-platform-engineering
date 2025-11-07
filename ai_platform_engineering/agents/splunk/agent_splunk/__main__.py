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

from agent_splunk.protocol_bindings.a2a_server.agent_executor import SplunkAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

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
        agent_executor=SplunkAgentExecutor()
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
