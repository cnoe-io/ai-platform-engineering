"""Configuration for Jira MCP

This module contains configuration constants that are used across the MCP server.
It's kept separate to avoid circular imports.
"""

import os

# Read-only mode environment variable (enabled by default for safety)
MCP_JIRA_READ_ONLY = os.getenv("MCP_JIRA_READ_ONLY", "false").lower() in ("true", "1", "yes")

# Mock mode environment variable (disabled by default)
MCP_JIRA_MOCK_RESPONSE = os.getenv("MCP_JIRA_MOCK_RESPONSE", "false").lower() in ("true", "1", "yes")

# Delete protection environment variables (enabled by default for safety)
MCP_JIRA_ISSUES_DELETE_PROTECTION = os.getenv("MCP_JIRA_ISSUES_DELETE_PROTECTION", "true").lower() in ("true", "1", "yes")
MCP_JIRA_SPRINTS_DELETE_PROTECTION = os.getenv("MCP_JIRA_SPRINTS_DELETE_PROTECTION", "true").lower() in ("true", "1", "yes")
MCP_JIRA_BOARDS_DELETE_PROTECTION = os.getenv("MCP_JIRA_BOARDS_DELETE_PROTECTION", "true").lower() in ("true", "1", "yes")


