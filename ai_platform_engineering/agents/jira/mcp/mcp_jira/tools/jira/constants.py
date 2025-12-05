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

# Delete protection environment variables (enabled by default for safety)
MCP_JIRA_ISSUES_DELETE_PROTECTION = os.getenv("MCP_JIRA_ISSUES_DELETE_PROTECTION", "true").lower() in ("true", "1", "yes")
MCP_JIRA_SPRINTS_DELETE_PROTECTION = os.getenv("MCP_JIRA_SPRINTS_DELETE_PROTECTION", "true").lower() in ("true", "1", "yes")
MCP_JIRA_BOARDS_DELETE_PROTECTION = os.getenv("MCP_JIRA_BOARDS_DELETE_PROTECTION", "true").lower() in ("true", "1", "yes")


def check_read_only() -> None:
    """Check if Jira is in read-only mode and raise an error if it is.

    Returns:
        str: If MCP_JIRA_READ_ONLY is enabled.
    """
    if MCP_JIRA_READ_ONLY:
        return "Jira MCP is in read-only mode. Write operations are disabled. Set MCP_JIRA_READ_ONLY=false to enable write operations."


def check_issues_delete_protection() -> None:
    """Check if issue deletion is protected and raise an error if it is.

    Raises:
        ValueError: If MCP_JIRA_ISSUES_DELETE_PROTECTION is enabled.
    """
    if MCP_JIRA_ISSUES_DELETE_PROTECTION:
        raise ValueError(
            "Issue deletion is protected. Set MCP_JIRA_ISSUES_DELETE_PROTECTION=false to enable issue deletion. "
            "WARNING: Deleting issues is irreversible and should be done with extreme caution."
        )


def check_sprints_delete_protection() -> None:
    """Check if sprint deletion is protected and raise an error if it is.

    Raises:
        ValueError: If MCP_JIRA_SPRINTS_DELETE_PROTECTION is enabled.
    """
    if MCP_JIRA_SPRINTS_DELETE_PROTECTION:
        raise ValueError(
            "Sprint deletion is protected. Set MCP_JIRA_SPRINTS_DELETE_PROTECTION=false to enable sprint deletion. "
            "WARNING: Deleting sprints is irreversible and should be done with extreme caution."
        )


def check_boards_delete_protection() -> None:
    """Check if board deletion is protected and raise an error if it is.

    Raises:
        ValueError: If MCP_JIRA_BOARDS_DELETE_PROTECTION is enabled.
    """
    if MCP_JIRA_BOARDS_DELETE_PROTECTION:
        raise ValueError(
            "Board deletion is protected. Set MCP_JIRA_BOARDS_DELETE_PROTECTION=false to enable board deletion. "
            "WARNING: Deleting boards is irreversible and should be done with extreme caution."
        )