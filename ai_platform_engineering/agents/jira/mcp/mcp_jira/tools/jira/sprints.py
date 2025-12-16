"""Sprint operations for Jira MCP

This module provides tools for managing Jira Software sprints using the Jira Agile REST API.
Reference: https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/
"""

import json
import logging
from typing import Annotated, Optional, List, Dict, Any

from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.config import MCP_JIRA_READ_ONLY, MCP_JIRA_SPRINTS_DELETE_PROTECTION
from mcp_jira.tools.jira.constants import check_read_only

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira-sprints")


async def create_sprint(
    name: Annotated[
        str,
        Field(description="Sprint name (will be trimmed)")
    ],
    origin_board_id: Annotated[
        int,
        Field(description="ID of the board where the sprint is created")
    ],
    start_date: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Start date in ISO 8601 format (e.g., '2015-04-11T15:22:00.000+10:00'). "
                "Note: When starting sprints from UI, this may be overridden."
            )
        ),
    ] = None,
    end_date: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) End date in ISO 8601 format (e.g., '2015-04-20T01:22:00.000+10:00'). "
                "Note: When starting sprints from UI, this is ignored and last sprint's duration is used."
            )
        ),
    ] = None,
    goal: Annotated[
        Optional[str],
        Field(description="(Optional) Sprint goal description")
    ] = None,
) -> str:
    """Create a future sprint.

    Creates a sprint in the future state. The sprint name will be trimmed automatically.

    Args:
        name: Sprint name (required, will be trimmed).
        origin_board_id: ID of the origin board (required).
        start_date: Optional start date in ISO 8601 format.
        end_date: Optional end date in ISO 8601 format.
        goal: Optional sprint goal.

    Returns:
        JSON string representing the created sprint.

    Raises:
        ValueError: If required fields missing, in read-only mode, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-post
    """
    # Check read-only mode
    if MCP_JIRA_READ_ONLY:
        error_result = {
            "success": False,
            "error": "Jira MCP is in read-only mode. Write operations are disabled."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"create_sprint called with name={name}, origin_board_id={origin_board_id}")

    sprint_data: Dict[str, Any] = {
        "name": name.strip(),
        "originBoardId": origin_board_id,
    }

    if start_date:
        sprint_data["startDate"] = start_date
    if end_date:
        sprint_data["endDate"] = end_date
    if goal:
        sprint_data["goal"] = goal

    logger.debug(f"Sprint data to send: {json.dumps(sprint_data, indent=2)}")

    success, response = await make_api_request(
        path="rest/agile/1.0/sprint",
        method="POST",
        data=sprint_data,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to create sprint: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_sprint(
    sprint_id: Annotated[
        int,
        Field(description="ID of the sprint to retrieve")
    ],
) -> str:
    """Get sprint details by ID.

    Returns the sprint for a given sprint ID. The sprint will only be returned if the user
    can view the board that the sprint was created on, or view at least one of the issues in the sprint.

    Args:
        sprint_id: Sprint ID.

    Returns:
        JSON string representing the sprint details.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-get
    """
    logger.debug(f"get_sprint called with sprint_id={sprint_id}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/sprint/{sprint_id}",
        method="GET",
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to fetch sprint {sprint_id}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def update_sprint(
    sprint_id: Annotated[
        int,
        Field(description="ID of the sprint to update")
    ],
    name: Annotated[
        Optional[str],
        Field(description="(Optional) Updated sprint name")
    ] = None,
    goal: Annotated[
        Optional[str],
        Field(description="(Optional) Updated sprint goal")
    ] = None,
    state: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Sprint state: 'future', 'active', or 'closed'. "
                "Use 'active' to start a sprint (requires startDate and endDate). "
                "Use 'closed' to complete an active sprint. "
                "For closed sprints, only name and goal can be updated."
            )
        ),
    ] = None,
    start_date: Annotated[
        Optional[str],
        Field(description="(Optional) Start date in ISO 8601 format (ignored for closed sprints)")
    ] = None,
    end_date: Annotated[
        Optional[str],
        Field(description="(Optional) End date in ISO 8601 format (ignored for closed sprints)")
    ] = None,
) -> str:
    """Update a sprint.

    Performs a full update of a sprint. Fields not present in the request will be set to null.

    Important notes:
    - For closed sprints, only name and goal can be updated.
    - Start a sprint by setting state to 'active' (requires startDate and endDate).
    - Complete a sprint by setting state to 'closed' (sprint must be active).
    - The completeDate field cannot be updated manually.

    Args:
        sprint_id: Sprint ID to update.
        name: Optional updated sprint name.
        goal: Optional updated sprint goal.
        state: Optional state ('future', 'active', 'closed').
        start_date: Optional start date.
        end_date: Optional end date.

    Returns:
        JSON string representing the updated sprint.

    Raises:
        ValueError: If in read-only mode or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-put
    """
    # Check read-only mode
    if MCP_JIRA_READ_ONLY:
        error_result = {
            "success": False,
            "error": "Jira MCP is in read-only mode. Write operations are disabled."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"update_sprint called with sprint_id={sprint_id}")

    sprint_data: Dict[str, Any] = {}

    if name is not None:
        sprint_data["name"] = name.strip()
    if goal is not None:
        sprint_data["goal"] = goal
    if state is not None:
        if state not in ["future", "active", "closed"]:
            error_result = {
                "success": False,
                "error": f"Invalid state '{state}'. Must be one of: future, active, closed"
            }
            return json.dumps(error_result, indent=2, ensure_ascii=False)
        sprint_data["state"] = state
    if start_date is not None:
        sprint_data["startDate"] = start_date
    if end_date is not None:
        sprint_data["endDate"] = end_date

    if not sprint_data:
        error_result = {
            "success": False,
            "error": "At least one field must be provided to update"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"Sprint data to send: {json.dumps(sprint_data, indent=2)}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/sprint/{sprint_id}",
        method="PUT",
        data=sprint_data,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to update sprint {sprint_id}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def delete_sprint(
    sprint_id: Annotated[
        int,
        Field(description="ID of the sprint to delete")
    ],
) -> str:
    """Delete a sprint.

    Deletes a sprint. Once a sprint is deleted, all issues in the sprint will be moved to the backlog.

    Args:
        sprint_id: Sprint ID to delete.

    Returns:
        JSON string confirming deletion.

    Raises:
        ValueError: If in read-only mode, delete protection is enabled, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-delete
    """
    # Check read-only mode
    if MCP_JIRA_READ_ONLY:
        error_result = {
            "success": False,
            "error": "Jira MCP is in read-only mode. Write operations are disabled."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    # Check delete protection
    if MCP_JIRA_SPRINTS_DELETE_PROTECTION:
        error_result = {
            "success": False,
            "error": "Sprint deletion is protected. Set MCP_JIRA_SPRINTS_DELETE_PROTECTION=false to enable."
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"delete_sprint called with sprint_id={sprint_id}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/sprint/{sprint_id}",
        method="DELETE",
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to delete sprint {sprint_id}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(
        {
            "success": True,
            "message": f"Sprint {sprint_id} successfully deleted",
        },
        indent=2,
        ensure_ascii=False,
    )


async def get_sprint_issues(
    sprint_id: Annotated[
        int,
        Field(description="ID of the sprint")
    ],
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination", default=0, ge=0)
    ] = 0,
    max_results: Annotated[
        int,
        Field(description="Maximum number of issues to return", default=50, ge=1, le=100)
    ] = 50,
    jql: Annotated[
        Optional[str],
        Field(description="(Optional) JQL query to filter issues")
    ] = None,
    validate_query: Annotated[
        bool,
        Field(description="Whether to validate the JQL query", default=True)
    ] = True,
    fields: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Comma-separated list of fields to return. "
                "Use '*all' for all fields or omit for default fields."
            )
        ),
    ] = None,
    expand: Annotated[
        Optional[str],
        Field(description="(Optional) Fields to expand (e.g., 'changelog')")
    ] = None,
) -> str:
    """Get issues for a sprint.

    Returns all issues in a sprint, for a given sprint ID. This only includes issues that the user has
    permission to view. By default, the returned issues are ordered by rank.

    Args:
        sprint_id: Sprint ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of issues to return.
        jql: Optional JQL query to filter issues.
        validate_query: Whether to validate the JQL query.
        fields: Optional comma-separated list of fields.
        expand: Optional fields to expand.

    Returns:
        JSON string containing the sprint issues.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-issue-get
    """
    logger.debug(f"get_sprint_issues called with sprint_id={sprint_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
        "validateQuery": validate_query,
    }

    if jql:
        params["jql"] = jql
    if fields:
        params["fields"] = fields
    if expand:
        params["expand"] = expand

    success, response = await make_api_request(
        path=f"rest/agile/1.0/sprint/{sprint_id}/issue",
        method="GET",
        params=params,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to fetch issues for sprint {sprint_id}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(response, indent=2, ensure_ascii=False)


async def move_issues_to_sprint(
    sprint_id: Annotated[
        int,
        Field(description="ID of the sprint to move issues to")
    ],
    issues: Annotated[
        List[str],
        Field(
            description=(
                "List of issue keys or IDs to move to the sprint "
                "(e.g., ['PROJ-123', 'PROJ-124'] or ['10001', '10002'])"
            )
        ),
    ],
    rank_before_issue: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Issue key or ID to rank the moved issues before. "
                "If not provided, issues are ranked to the end."
            )
        ),
    ] = None,
    rank_custom_field_id: Annotated[
        Optional[int],
        Field(
            description=(
                "(Optional) ID of the rank custom field. "
                "If not provided, the default rank field is used."
            )
        ),
    ] = None,
) -> str:
    """Move issues to sprint and rank them.

    Moves issues to a sprint, for a given sprint ID. Issues can only be moved to open or active sprints.
    The maximum number of issues that can be moved in one operation is 50.

    Args:
        sprint_id: Sprint ID to move issues to.
        issues: List of issue keys or IDs to move.
        rank_before_issue: Optional issue to rank before.
        rank_custom_field_id: Optional custom field ID for ranking.

    Returns:
        JSON string confirming the operation.

    Raises:
        ValueError: If in read-only mode, too many issues, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-issue-post
    """
    check_read_only()

    if len(issues) > 50:
        error_result = {
            "success": False,
            "error": f"Cannot move more than 50 issues at once. Provided: {len(issues)}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    logger.debug(f"move_issues_to_sprint called with sprint_id={sprint_id}, issues count={len(issues)}")

    move_data: Dict[str, Any] = {
        "issues": issues,
    }

    if rank_before_issue:
        move_data["rankBeforeIssue"] = rank_before_issue
    if rank_custom_field_id:
        move_data["rankCustomFieldId"] = rank_custom_field_id

    logger.debug(f"Move data to send: {json.dumps(move_data, indent=2)}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/sprint/{sprint_id}/issue",
        method="POST",
        data=move_data,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to move issues to sprint {sprint_id}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(
        {
            "success": True,
            "message": f"Successfully moved {len(issues)} issue(s) to sprint {sprint_id}",
            "sprint_id": sprint_id,
            "issues_moved": len(issues),
        },
        indent=2,
        ensure_ascii=False,
    )


async def swap_sprint(
    sprint_id: Annotated[
        int,
        Field(description="ID of the first sprint")
    ],
    sprint_to_swap_with: Annotated[
        int,
        Field(description="ID of the second sprint to swap positions with")
    ],
) -> str:
    """Swap the position of two sprints.

    Swaps the position of the sprint with another sprint.

    Args:
        sprint_id: ID of the first sprint.
        sprint_to_swap_with: ID of the second sprint.

    Returns:
        JSON string confirming the swap.

    Raises:
        ValueError: If in read-only mode or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-swap-post
    """
    check_read_only()

    logger.debug(f"swap_sprint called with sprint_id={sprint_id}, sprint_to_swap_with={sprint_to_swap_with}")

    swap_data = {
        "sprintToSwapWith": sprint_to_swap_with,
    }

    success, response = await make_api_request(
        path=f"rest/agile/1.0/sprint/{sprint_id}/swap",
        method="POST",
        data=swap_data,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to swap sprint {sprint_id} with {sprint_to_swap_with}: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    return json.dumps(
        {
            "success": True,
            "message": f"Successfully swapped sprint {sprint_id} with sprint {sprint_to_swap_with}",
            "sprint_id": sprint_id,
            "swapped_with": sprint_to_swap_with,
        },
        indent=2,
        ensure_ascii=False,
    )


async def get_issue_sprint(
    issue_key: Annotated[
        str,
        Field(description="Jira issue key (e.g., 'PROJ-123')")
    ],
    expand: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Comma-separated list of parameters to expand. "
                "Valid values: changelog, renderedFields, names, schema, operations, editmeta, versionedRepresentations"
            )
        ),
    ] = None,
) -> str:
    """Get sprint information for a specific issue using the Agile API.

    This function uses the Jira Agile REST API to retrieve issue details including
    sprint information, which is not always available through the standard REST API.

    The response includes Agile-specific fields:
    - sprint: Current sprint the issue is in (with id, name, state, startDate, endDate, goal)
    - closedSprints: Array of closed sprints the issue was in
    - flagged: Whether the issue is flagged

    Args:
        issue_key: The issue key (e.g., 'SRI-185').
        expand: Optional parameters to expand.

    Returns:
        JSON string containing the issue details with sprint information.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-issue/#api-rest-agile-1-0-issue-issueidorkey-get
    """
    logger.debug(f"get_issue_sprint called with issue_key={issue_key}, expand={expand}")

    params: Dict[str, Any] = {}
    if expand:
        params["expand"] = expand

    success, response = await make_api_request(
        path=f"rest/agile/1.0/issue/{issue_key}",
        method="GET",
        params=params if params else None,
    )

    if not success:
        error_result = {
            "success": False,
            "error": f"Failed to fetch issue {issue_key} from Agile API: {response}"
        }
        return json.dumps(error_result, indent=2, ensure_ascii=False)

    # Extract sprint information for clearer output
    fields = response.get("fields", {})
    sprint_info = fields.get("sprint")
    closed_sprints = fields.get("closedSprints", [])
    flagged = fields.get("flagged", False)

    # Build a clear sprint summary
    sprint_summary = {
        "issue_key": response.get("key", issue_key),
        "summary": fields.get("summary", ""),
        "status": fields.get("status", {}).get("name", "Unknown"),
        "current_sprint": None,
        "closed_sprints": [],
        "flagged": flagged,
    }

    if sprint_info:
        sprint_summary["current_sprint"] = {
            "id": sprint_info.get("id"),
            "name": sprint_info.get("name"),
            "state": sprint_info.get("state"),
            "start_date": sprint_info.get("startDate"),
            "end_date": sprint_info.get("endDate"),
            "goal": sprint_info.get("goal"),
            "board_id": sprint_info.get("originBoardId"),
        }

    if closed_sprints:
        for cs in closed_sprints:
            sprint_summary["closed_sprints"].append({
                "id": cs.get("id"),
                "name": cs.get("name"),
                "state": cs.get("state"),
                "start_date": cs.get("startDate"),
                "end_date": cs.get("endDate"),
                "complete_date": cs.get("completeDate"),
            })

    # Include the full response for completeness
    result = {
        "sprint_summary": sprint_summary,
        "full_response": response,
    }

    return json.dumps(result, indent=2, ensure_ascii=False)
