# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# ==================================================
AGENT_NAME = 'azuredevops'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to manage Azure DevOps projects, pipelines, repositories, work items, and builds.'

agent_skill = AgentSkill(
  id="azuredevops_agent_skill",
  name="Azure DevOps Agent Skill",
  description="Provides capabilities to manage Azure DevOps resources including projects, pipelines, repos, and work items.",
  tags=[
    "azure-devops",
    "pipelines",
    "repos",
    "work-items",
    "builds",
    "ci-cd"],
  examples=[
      # Projects
      "List all projects in Azure DevOps.",
      "Get details of the 'my-project' project.",
      "Create a new project named 'new-project' with description 'My new project'.",

      # Pipelines
      "List all pipelines in the 'my-project' project.",
      "Get the status of pipeline 'build-pipeline' in 'my-project'.",
      "Run the 'deploy-pipeline' pipeline in 'my-project'.",
      "Get the last 5 runs of the 'build-pipeline' pipeline.",

      # Repositories
      "List all repositories in 'my-project'.",
      "Get details of repository 'my-repo' in 'my-project'.",
      "List branches in 'my-repo' repository.",
      "Get the latest commits in 'my-repo'.",

      # Work Items
      "List work items assigned to me.",
      "Create a new bug work item titled 'Fix login issue'.",
      "Get details of work item #1234.",
      "Update work item #1234 to set state to 'Active'.",
      "List all work items in the 'Sprint 1' iteration.",

      # Builds
      "List recent builds in 'my-project'.",
      "Get details of build #456.",
      "Queue a new build for 'build-pipeline'.",

      # Pull Requests
      "List open pull requests in 'my-repo'.",
      "Get details of pull request #789.",
      "Create a pull request from 'feature-branch' to 'main'.",
  ])

# ==================================================
# SHARED CONFIGURATION - DO NOT MODIFY
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{AGENT_NAME.lower()}-tools-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill],
    security=[{"public": []}],
  )
