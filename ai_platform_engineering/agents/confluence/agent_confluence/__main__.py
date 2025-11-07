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

from agent_confluence.protocol_bindings.a2a_server.agent_executor import ConfluenceAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

AGENT_NAME = 'confluence'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to perform Confluence operations.'

agent_skill = AgentSkill(
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
        agent_executor=ConfluenceAgentExecutor()
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
