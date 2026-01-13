# GitLab A2A Server

This directory contains the A2A (Agent-to-Agent) protocol bindings for the GitLab agent.

## Overview

The GitLab agent uses the A2A protocol for communication with other agents and clients. It connects to GitLab's official MCP (Model Context Protocol) server at `https://<gitlab-host>/api/v4/mcp`.

## Components

- **agent.py**: Main GitLabAgent class that extends BaseLangGraphAgent
- **agent_executor.py**: GitLabAgentExecutor for handling A2A requests
- **helpers.py**: Helper functions for task processing
- **state.py**: State management classes

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITLAB_PERSONAL_ACCESS_TOKEN` | Yes* | GitLab Personal Access Token with `api` scope |
| `GITLAB_OAUTH_TOKEN` | Yes* | OAuth token (alternative to PAT) |
| `GITLAB_HOST` | No | GitLab host (default: `gitlab.com`) |
| `MCP_MODE` | No | Must be `http` for remote MCP (default) |

*One of PAT or OAuth token is required

### GitLab MCP Server Reference

The agent connects to GitLab's official MCP server. For more information, see:
https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/

## Running the Agent

```bash
# Using Makefile
make run-a2a

# Or directly with Python
uv run python -m agent_gitlab --host 0.0.0.0 --port 8000
```
