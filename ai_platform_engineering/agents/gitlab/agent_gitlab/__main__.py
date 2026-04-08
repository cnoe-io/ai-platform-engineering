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

from agent_gitlab.protocol_bindings.a2a_server.agent_executor import GitLabAgentExecutor  # type: ignore[import-untyped]
from ai_platform_engineering.utils.a2a_common.a2a_server import A2AServer
from a2a.types import AgentSkill

load_dotenv()

METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"

AGENT_NAME = 'gitlab'
AGENT_DESCRIPTION = "An AI agent that interacts with GitLab to manage projects, merge requests, issues, and CI/CD pipelines."

agent_skill = AgentSkill(
  id="gitlab_agent_skill",
  name="GitLab Agent Skill",
  description="Handles tasks related to GitLab projects, merge requests, issues, and CI/CD pipelines.",
  tags=[
    "gitlab",
    "project management",
    "merge requests",
    "issues",
    "ci/cd",
    "pipelines"],
  examples=[
      "Create a new GitLab project named 'my-project'.",
      "List all open merge requests in the 'frontend' project.",
      "Merge the merge request !42 in the 'backend' project.",
      "Close issue #101 in the 'docs' project.",
      "Get the latest commit in the 'main' branch of 'my-project'.",
      "Show the status of the latest pipeline in 'my-project'."
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
        agent_executor=GitLabAgentExecutor(),
        metrics_enabled=METRICS_ENABLED,
    )

    await server.serve()

if __name__ == '__main__':
    main()
