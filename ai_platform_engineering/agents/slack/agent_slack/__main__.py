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

from agent_slack.protocol_bindings.a2a_server.agent_executor import SlackAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"

AGENT_NAME = 'slack'
AGENT_DESCRIPTION = (
  "An AI agent that integrates with Slack to assist with managing channels, "
  "sending messages, retrieving user information, and other Slack-based operations."
)

agent_skill = AgentSkill(
  id="slack_agent_skill",
  name="Slack Channel Management Skill",
  description="Provides Slack-based capabilities to manage channels, send messages, and retrieve user information.",
  tags=[
    "slack",
    "chatops"],
  examples=[
      "Send a message to the 'devops' Slack channel.",
      "List all members of the 'engineering' Slack workspace.",
      "Create a new Slack channel named 'project-updates'.",
      "Archive the 'old-project' Slack channel.",
      "Post a notification to the 'alerts' Slack channel."
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
        agent_executor=SlackAgentExecutor(),
        metrics_enabled=METRICS_ENABLED
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
