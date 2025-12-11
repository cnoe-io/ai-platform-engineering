"""Transition operations for Jira MCP"""

import json
import logging
from typing import Annotated, Optional, Any, Dict

from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.tools.jira.constants import check_read_only

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

async def get_transitions(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
) -> str:
    """Get available status transitions for a Jira issue.

    Args:
        ctx: The FastMCP context.
        issue_key: Jira issue key.

    Returns:
        JSON string representing a list of available transitions.
    """
    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/transitions",
        method="GET",
    )

    if not success:
        raise ValueError(f"Failed to fetch transitions for issue {issue_key}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)

async def transition_issue(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    transition_id: Annotated[
        str,
        Field(
            description=(
                "ID of the transition to perform. Use the jira_get_transitions tool first "
                "to get the available transition IDs for the issue. Example values: '11', '21', '31'"
            )
        ),
    ],
    fields: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "(Optional) Dictionary of fields to update during the transition. "
            "Some transitions require specific fields to be set (e.g., resolution). "
            "Example: {'resolution': {'name': 'Fixed'}}"
        ),
    ),
    comment: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Comment to add during the transition. "
                "This will be visible in the issue history."
            ),
        ),
    ] = None,
) -> str:
    """Transition a Jira issue to a new status.

    Args:
        ctx: The FastMCP context.
        issue_key: Jira issue key.
        transition_id: ID of the transition.
        fields: Optional dictionary of fields to update during transition.
        comment: Optional comment for the transition.

    Returns:
        JSON string representing the updated issue object.

    Raises:
        ValueError: If required fields missing, invalid input, in read-only mode, or Jira client unavailable.
    """
    check_read_only()

    payload = {
        "transition": {"id": transition_id},
        "fields": fields or {},
    }

    if comment:
        # Use ADF format for comments in v3
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
        payload["update"] = {
            "comment": [{"add": {"body": adf_comment}}]
        }

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/transitions",
        method="POST",
        data=payload,
    )

    if not success:
        raise ValueError(f"Failed to transition issue {issue_key}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)