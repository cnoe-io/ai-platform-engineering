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

from agent_github.protocol_bindings.a2a_server.agent_executor import GitHubAgentExecutor # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import (
  AgentSkill
)

load_dotenv()

A2A_TRANSPORT = os.getenv("A2A_TRANSPORT", "p2p").lower()
SLIM_ENDPOINT = os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")

AGENT_NAME = 'github'
AGENT_DESCRIPTION="An AI agent that interacts with GitHub to manage repositories, pull requests, and workflows."

agent_skill = AgentSkill(
  id="github_agent_skill",
  name="GitHub Agent Skill",
  description="Handles tasks related to GitHub repositories, pull requests, and workflows.",
  tags=[
    "github",
    "repository management",
    "pull requests",
    "workflows"],
  examples=[
      "Create a new GitHub repository named 'my-repo'.",
      "List all open pull requests in the 'frontend' repository.",
      "Merge the pull request #42 in the 'backend' repository.",
      "Close the issue #101 in the 'docs' repository.",
      "Get the latest commit in the 'main' branch of 'my-repo'."
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
        agent_executor=GitHubAgentExecutor()
    )
    
    await server.serve()

if __name__ == '__main__':
    main()
