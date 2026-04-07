# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules
# =====================================================

import click
import asyncio
import os
from dotenv import load_dotenv

from agent_victorops.protocol_bindings.a2a_server.agent_executor import VictorOpsAgentExecutor  # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import AgentSkill

load_dotenv()

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "false").lower() == "true"

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
        agent_executor=VictorOpsAgentExecutor(),
        metrics_enabled=METRICS_ENABLED,
    )

    await server.serve()

if __name__ == '__main__':
    main()
