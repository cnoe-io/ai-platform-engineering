"""Comment operations for Jira MCP"""

import json
import logging
from typing import Annotated, Optional, Dict, Any

from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.config import MCP_JIRA_READ_ONLY

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira-comments")


async def get_comments(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    start_at: Annotated[
        int,
        Field(
            description="The index of the first comment to return (0-based)",
            default=0,
            ge=0,
        ),
    ] = 0,
    max_results: Annotated[
        int,
        Field(
            description="Maximum number of comments to return (max 5000)",
            default=50,
            ge=1,
            le=5000,
        ),
    ] = 50,
    order_by: Annotated[
        str,
        Field(
            description="Order comments by 'created' or '-created' (descending)",
            default="created",
        ),
    ] = "created",
) -> str:
    """Get all comments for a Jira issue.

    Args:
        issue_key: Jira issue key.
        start_at: Starting index for pagination.
        max_results: Maximum number of comments to return.
        order_by: Sort order (created or -created for descending).

    Returns:
        JSON string containing the comments list.

    Raises:
        ValueError: If the API request fails.
    """
    logger.debug(
        f"get_comments called with issue_key={issue_key}, "
        f"start_at={start_at}, max_results={max_results}, order_by={order_by}"
    )

    params = {
        "startAt": start_at,
        "maxResults": max_results,
        "orderBy": order_by,
    }

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/comment",
        method="GET",
        params=params,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to fetch comments for issue {issue_key}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def add_comment(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    body: Annotated[
        str,
        Field(
            description=(
                "The comment text in plain text or markdown format. "
                "The text will be automatically converted to Jira's ADF (Atlassian Document Format)."
            )
        ),
    ],
    visibility: Annotated[
        Optional[Dict[str, str]],
        Field(
            description=(
                "(Optional) Visibility restriction for the comment. "
                "Example: {'type': 'role', 'value': 'Administrators'} or "
                "{'type': 'group', 'value': 'jira-developers'}"
            ),
        ),
    ] = None,
) -> str:
    """Add a comment to a Jira issue.

    Args:
        issue_key: Jira issue key.
        body: Comment text (plain text or markdown).
        visibility: Optional visibility restriction.

    Returns:
        JSON string representing the created comment.

    Raises:
        ValueError: If required fields missing, invalid input, in read-only mode, or API request fails.
    """
    # Check read-only mode
    if MCP_JIRA_READ_ONLY:
        error_result = {
            "success": False,
            "error": "Jira MCP is in read-only mode. Write operations are disabled."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"add_comment called with issue_key={issue_key}, body length={len(body)}")

    # Convert plain text to ADF format
    adf_body = {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": body
                    }
                ]
            }
        ]
    }

    comment_data: Dict[str, Any] = {
        "body": adf_body,
    }

    if visibility:
        if not isinstance(visibility, dict) or "type" not in visibility or "value" not in visibility:
            error_result = {
                "success": False,
                "error": "visibility must be a dict with 'type' and 'value' keys. Example: {'type': 'role', 'value': 'Administrators'}"
            }
            return json.dumps(error_result, indent=2, ensure_ascii=False)
        comment_data["visibility"] = visibility

    logger.debug(f"Comment data to send: {json.dumps(comment_data, indent=2)}")

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/comment",
        method="POST",
        data=comment_data,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to add comment to issue {issue_key}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def update_comment(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    comment_id: Annotated[
        str,
        Field(description="The ID of the comment to update")
    ],
    body: Annotated[
        str,
        Field(
            description=(
                "The updated comment text in plain text or markdown format. "
                "The text will be automatically converted to Jira's ADF (Atlassian Document Format)."
            )
        ),
    ],
    visibility: Annotated[
        Optional[Dict[str, str]],
        Field(
            description=(
                "(Optional) Visibility restriction for the comment. "
                "Example: {'type': 'role', 'value': 'Administrators'} or "
                "{'type': 'group', 'value': 'jira-developers'}"
            ),
        ),
    ] = None,
) -> str:
    """Update an existing comment on a Jira issue.

    Args:
        issue_key: Jira issue key.
        comment_id: ID of the comment to update.
        body: Updated comment text (plain text or markdown).
        visibility: Optional visibility restriction.

    Returns:
        JSON string representing the updated comment.

    Raises:
        ValueError: If required fields missing, invalid input, in read-only mode, or API request fails.
    """
    # Check read-only mode
    if MCP_JIRA_READ_ONLY:
        error_result = {
            "success": False,
            "error": "Jira MCP is in read-only mode. Write operations are disabled."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(
        f"update_comment called with issue_key={issue_key}, "
        f"comment_id={comment_id}, body length={len(body)}"
    )

    # Convert plain text to ADF format
    adf_body = {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": body
                    }
                ]
            }
        ]
    }

    comment_data: Dict[str, Any] = {
        "body": adf_body,
    }

    if visibility:
        if not isinstance(visibility, dict) or "type" not in visibility or "value" not in visibility:
            error_result = {
                "success": False,
                "error": "visibility must be a dict with 'type' and 'value' keys. Example: {'type': 'role', 'value': 'Administrators'}"
            }
            return json.dumps(error_result, indent=2, ensure_ascii=False)
        comment_data["visibility"] = visibility

    logger.debug(f"Comment data to send: {json.dumps(comment_data, indent=2)}")

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/comment/{comment_id}",
        method="PUT",
        data=comment_data,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to update comment {comment_id} on issue {issue_key}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def delete_comment(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    comment_id: Annotated[
        str,
        Field(description="The ID of the comment to delete")
    ],
) -> str:
    """Delete a comment from a Jira issue.

    Args:
        issue_key: Jira issue key.
        comment_id: ID of the comment to delete.

    Returns:
        JSON string confirming deletion.

    Raises:
        ValueError: If in read-only mode or API request fails.
    """
    # Check read-only mode
    if MCP_JIRA_READ_ONLY:
        error_result = {
            "success": False,
            "error": "Jira MCP is in read-only mode. Write operations are disabled."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"delete_comment called with issue_key={issue_key}, comment_id={comment_id}")

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/comment/{comment_id}",
        method="DELETE",
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to delete comment {comment_id} from issue {issue_key}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(
        {
            "success": True,
            "message": f"Comment {comment_id} successfully deleted from issue {issue_key}",
        },
        indent=2,
        ensure_ascii=False,
    )


async def get_comment(
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    comment_id: Annotated[
        str,
        Field(description="The ID of the comment to retrieve")
    ],
) -> str:
    """Get a specific comment from a Jira issue.

    Args:
        issue_key: Jira issue key.
        comment_id: ID of the comment to retrieve.

    Returns:
        JSON string representing the comment.

    Raises:
        ValueError: If the API request fails.
    """
    logger.debug(f"get_comment called with issue_key={issue_key}, comment_id={comment_id}")

    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}/comment/{comment_id}",
        method="GET",
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to fetch comment {comment_id} from issue {issue_key}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)

