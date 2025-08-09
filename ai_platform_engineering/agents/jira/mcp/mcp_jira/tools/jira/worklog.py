"""Worklog operations for Jira MCP"""

import json
import logging
from typing import Annotated
from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.worklog import JiraWorklog

# Configure logging
logger = logging.getLogger("mcp-jira-worklog")

async def get_worklog(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
) -> str:
    """Fetch worklogs for a Jira issue."""
    logger.debug("Entering get_worklog function")
    logger.debug(f"Parameters: issue_key={issue_key}")

    success, response = await make_api_request(
        path=f"rest/api/2/issue/{issue_key}/worklog",
        method="GET",
    )

    if not success:
        raise ValueError(f"Failed to fetch worklogs for issue {issue_key}: {response}")

    worklogs_data = response.json().get("worklogs", [])
    return [JiraWorklog(**worklog) for worklog in worklogs_data]

async def add_worklog(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    time_spent: Annotated[str, Field(description="Time spent in Jira format (e.g., '3h 30m')")],
    comment: Annotated[str, Field(description="Optional comment in Markdown", default="")] = "",
    started: Annotated[str, Field(description="Optional start time in ISO format", default="")] = "",
    original_estimate: Annotated[str, Field(description="Optional new original estimate", default="")] = "",
    remaining_estimate: Annotated[str, Field(description="Optional new remaining estimate", default="")] = "",
) -> str:
    """Add a worklog to a Jira issue."""
    logger.debug("Entering add_worklog function")
    logger.debug(
        f"Parameters: issue_key={issue_key}, time_spent={time_spent}, comment={comment}, "
        f"started={started}, original_estimate={original_estimate}, remaining_estimate={remaining_estimate}"
    )

    worklog_data = {
        "timeSpent": time_spent,
        "comment": comment,
        "started": started,
        "originalEstimate": original_estimate,
        "remainingEstimate": remaining_estimate,
    }

    success, response = await make_api_request(
        path=f"rest/api/2/issue/{issue_key}/worklog",
        method="POST",
        json=worklog_data,
    )

    if not success:
        raise ValueError(f"Failed to add worklog to issue {issue_key}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)