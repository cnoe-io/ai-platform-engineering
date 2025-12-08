"""Worklog operations for Jira MCP"""

import json
import logging
from datetime import datetime, timezone
from typing import Annotated
from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.worklog import JiraWorklog
from mcp_jira.tools.jira.constants import check_read_only

# Configure logging
logger = logging.getLogger("mcp-jira-worklog")


def _format_jira_datetime(date_str: str) -> str:
    """Convert various date formats to Jira's expected format.

    Jira expects: yyyy-MM-dd'T'HH:mm:ss.SSSZ (e.g., 2025-12-05T10:30:00.000+0000)

    Args:
        date_str: Input date string in various formats

    Returns:
        Formatted date string for Jira API
    """
    if not date_str:
        return ""

    # If already in correct format, return as-is
    if len(date_str) >= 24 and 'T' in date_str and ('+' in date_str or 'Z' in date_str):
        return date_str

    try:
        # Try parsing common formats
        formats_to_try = [
            "%Y-%m-%dT%H:%M:%S.%f%z",  # 2025-12-05T10:30:00.000+0000
            "%Y-%m-%dT%H:%M:%S%z",      # 2025-12-05T10:30:00+0000
            "%Y-%m-%dT%H:%M:%SZ",       # 2025-12-05T10:30:00Z
            "%Y-%m-%dT%H:%M:%S",        # 2025-12-05T10:30:00
            "%Y-%m-%d %H:%M:%S",        # 2025-12-05 10:30:00
            "%Y-%m-%d",                  # 2025-12-05
        ]

        parsed_dt = None
        for fmt in formats_to_try:
            try:
                parsed_dt = datetime.strptime(date_str, fmt)
                break
            except ValueError:
                continue

        if parsed_dt is None:
            logger.warning(f"Could not parse date '{date_str}', using as-is")
            return date_str

        # If no timezone, assume UTC
        if parsed_dt.tzinfo is None:
            parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)

        # Format for Jira: yyyy-MM-dd'T'HH:mm:ss.SSS+0000
        return parsed_dt.strftime("%Y-%m-%dT%H:%M:%S.000%z")

    except Exception as e:
        logger.warning(f"Error formatting date '{date_str}': {e}")
        return date_str

async def get_worklog(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
) -> str:
    """Fetch worklogs for a Jira issue."""
    logger.debug("Entering get_worklog function")
    logger.debug(f"Parameters: issue_key={issue_key}")

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/worklog",
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
    started: Annotated[str, Field(description="Optional start time. Accepts various formats: '2025-12-05T10:30:00.000+0000', '2025-12-05T10:30:00Z', '2025-12-05 10:30:00', or '2025-12-05'. If not provided, defaults to current time.", default="")] = "",
    original_estimate: Annotated[str, Field(description="Optional new original estimate", default="")] = "",
    remaining_estimate: Annotated[str, Field(description="Optional new remaining estimate", default="")] = "",
) -> str:
    """Add a worklog to a Jira issue.

    Raises:
        ValueError: If in read-only mode.
    """
    check_read_only()

    logger.debug("Entering add_worklog function")
    logger.debug(
        f"Parameters: issue_key={issue_key}, time_spent={time_spent}, comment={comment}, "
        f"started={started}, original_estimate={original_estimate}, remaining_estimate={remaining_estimate}"
    )

    # Build worklog data - only include non-empty fields
    worklog_data = {
        "timeSpent": time_spent,
    }

    # Format and include started only if provided
    if started:
        formatted_started = _format_jira_datetime(started)
        if formatted_started:
            worklog_data["started"] = formatted_started
            logger.debug(f"Formatted started date: {started} -> {formatted_started}")
    else:
        # If not provided, use current time in Jira format
        now = datetime.now(timezone.utc)
        worklog_data["started"] = now.strftime("%Y-%m-%dT%H:%M:%S.000%z")
        logger.debug(f"Using current time as started: {worklog_data['started']}")

    # Only include estimates if provided
    if original_estimate:
        worklog_data["originalEstimate"] = original_estimate
    if remaining_estimate:
        worklog_data["remainingEstimate"] = remaining_estimate

    # Use ADF format for comments in v3
    if comment:
        adf_comment = {
            "type": "doc",
            "version": 1,
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": comment
                        }
                    ]
                }
            ]
        }
        worklog_data["comment"] = adf_comment

    logger.debug(f"Worklog data to send: {worklog_data}")

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/worklog",
        method="POST",
        data=worklog_data,
    )

    if not success:
        raise ValueError(f"Failed to add worklog to issue {issue_key}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)