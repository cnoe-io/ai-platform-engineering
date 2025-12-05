"""Constants specific to Jira operations."""

import os

# Set of default fields returned by Jira read operations when no specific fields are requested.
DEFAULT_READ_JIRA_FIELDS: set[str] = {
    "summary",
    "description",
    "status",
    "assignee",
    "reporter",
    "labels",
    "priority",
    "created",
    "updated",
    "issuetype",
}

# Read-only mode environment variable (enabled by default for safety)
MCP_JIRA_READ_ONLY = os.getenv("MCP_JIRA_READ_ONLY", "false").lower() in ("true", "1", "yes")

# Mock mode environment variable (disabled by default)
MCP_JIRA_MOCK_RESPONSE = os.getenv("MCP_JIRA_MOCK_RESPONSE", "false").lower() in ("true", "1", "yes")


def check_read_only() -> None:
    """Check if Jira is in read-only mode and raise an error if it is.

    Returns:
        str: If MCP_JIRA_READ_ONLY is enabled.
    """
    if MCP_JIRA_READ_ONLY:
        return "Jira MCP is in read-only mode. Write operations are disabled. Set MCP_JIRA_READ_ONLY=false to enable write operations."