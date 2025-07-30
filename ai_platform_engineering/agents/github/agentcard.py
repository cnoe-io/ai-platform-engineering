import os

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

GITHUB_AGENT_HOST = os.getenv("GITHUB_AGENT_HOST", "localhost")
GITHUB_AGENT_PORT = os.getenv("GITHUB_AGENT_PORT", "8000")
print("===================================")
print("       GITHUB AGENT CONFIG         ")
print("===================================")
print(f"GITHUB_AGENT_HOST: {GITHUB_AGENT_HOST}")
print(f"GITHUB_AGENT_PORT: {GITHUB_AGENT_PORT}")
print("===================================")

GITHUB_AGENT_DESCRIPTION="An AI agent that interacts with GitHub to manage repositories, pull requests, and workflows."

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
      "Create a new GitHub repository named 'my-repo'.",
      "List all open pull requests in the 'frontend' repository.",
      "Merge the pull request #42 in the 'backend' repository.",
      "Close the issue #101 in the 'docs' repository.",
      "Get the latest commit in the 'main' branch of 'my-repo'."
  ])

github_agent_card = AgentCard(
  name='GitHub',
  id='github-tools-agent',
  description=GITHUB_AGENT_DESCRIPTION,
  url=f'http://{GITHUB_AGENT_HOST}:{GITHUB_AGENT_PORT}',
  version='0.1.0',
  defaultInputModes=["text"],
  defaultOutputModes=["text"],
  capabilities=AgentCapabilities(
    streaming=False),
  skills=[github_agent_skill],
  supportsAuthenticatedExtendedCard=False,
)
