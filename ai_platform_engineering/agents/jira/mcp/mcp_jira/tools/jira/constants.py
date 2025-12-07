"""Constants specific to Jira operations."""

# Import configuration from central config module to avoid circular imports
from mcp_jira.config import (
    MCP_JIRA_READ_ONLY,
    MCP_JIRA_ISSUES_DELETE_PROTECTION,
    MCP_JIRA_SPRINTS_DELETE_PROTECTION,
    MCP_JIRA_BOARDS_DELETE_PROTECTION,
)

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


def check_read_only() -> None:
    """Check if Jira is in read-only mode and raise an error if it is.

    Raises:
        ValueError: If MCP_JIRA_READ_ONLY is enabled.
    """
    if MCP_JIRA_READ_ONLY:
        raise ValueError(
            "Jira MCP is in read-only mode. Write operations are disabled. "
            "Set MCP_JIRA_READ_ONLY=false to enable write operations."
        )


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