import os

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

GITHUB_AGENT_HOST = os.getenv("GITHUB_AGENT_HOST", "localhost")
GITHUB_AGENT_PORT = os.getenv("GITHUB_AGENT_PORT", "8003")

github_agent_skill = AgentSkill(
  id="github_agent_skill",
  name="GitHub Agent Skill",
  description="Handles tasks related to GitHub repositories, pull requests, and workflows.",
  tags=[
    "github",
    "repository management",
    "pull requests",
    "workflows"],
  examples=[
    "Create a new repository in GitHub.",
    "List all open pull requests in a repository.",
    "Trigger a GitHub Actions workflow."])

github_agent_card = AgentCard(
  name='GitHub Tools Agent',
  id='github-tools-agent',
  description='An AI agent that interacts with GitHub to manage repositories, pull requests, and workflows.',
  url=f'http://{GITHUB_AGENT_HOST}:{GITHUB_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[github_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
