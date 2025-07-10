"""Issue operations for Jira MCP"""

import json
import logging
from typing import Annotated, Optional, List

from mcp.server.fastmcp import Context
from pydantic import Field

from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request


# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira-issues")

async def get_issue(
    ctx: Context,
    issue_key: Annotated[str, Field(description="Jira issue key (e.g., 'PROJ-123')")],
    fields: Annotated[
        str,
        Field(
            description=(
                "(Optional) Comma-separated list of fields to return (e.g., 'summary,status,customfield_10010'). "
                "You may also provide a single field as a string (e.g., 'duedate'). "
                "Use '*all' for all fields (including custom fields), or omit for essential fields only."
            ),
            default="",
        ),
    ] = "",
    expand: Annotated[
        str,
        Field(
            description=(
                "(Optional) Fields to expand. Examples: 'renderedFields' (for rendered content), "
                "'transitions' (for available status transitions), 'changelog' (for history)"
            ),
            default="",
        ),
    ] = "",
    comment_limit: Annotated[
        int,
        Field(
            description="Maximum number of comments to include (0 or null for no comments)",
            default=10,
            ge=0,
            le=100,
        ),
    ] = 10,
    properties: Annotated[
        str,
        Field(
            description="(Optional) A comma-separated list of issue properties to return",
            default="",
        ),
    ] = "",
    update_history: Annotated[
        bool,
        Field(
            description="Whether to update the issue view history for the requesting user",
            default=True,
        ),
    ] = True,
) -> str:
    """Fetch details of a specific Jira issue."""
    logger.debug(
        f"get_issue called with issue_key={issue_key}, fields={fields}, expand={expand}, "
        f"comment_limit={comment_limit}, properties={properties}, update_history={update_history}"
    )

    fields_list: Optional[List[str]] = None
    if fields and fields != "*all":
        fields_list = [f.strip() for f in fields.split(",")]

    params = {
        "fields": fields_list,
        "expand": expand,
        "properties": properties.split(",") if properties else None,
        "updateHistory": update_history,
    }

    success, response = await make_api_request(
        path=f"rest/api/2/issue/{issue_key}",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch Jira issue: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_project_issues(
    ctx: Context,
    project_key: Annotated[str, Field(description="The project key")],
    limit: Annotated[
        int,
        Field(description="Maximum number of results (1-50)", default=10, ge=1, le=50),
    ] = 10,
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination (0-based)", default=0, ge=0),
    ] = 0,
) -> str:
    """Get all issues for a specific Jira project."""
    params = {
        "jql": f"project={project_key}",
        "maxResults": limit,
        "startAt": start_at,
    }

    success, response = await make_api_request(
        path="rest/api/2/search",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch project issues: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_issues(
    ctx: Context,
    board_id: Annotated[str, Field(description="The id of the board (e.g., '1001')")],
    jql: Annotated[
        str,
        Field(
            description=(
                "JQL query string (Jira Query Language). Examples:\n"
                '- Find Epics: "issuetype = Epic AND project = PROJ"\n'
                '- Find issues in Epic: "parent = PROJ-123"\n'
                "- Find by status: \"status = 'In Progress' AND project = PROJ\"\n"
                '- Find by assignee: "assignee = currentUser()"\n'
                '- Find recently updated: "updated >= -7d AND project = PROJ"\n'
                '- Find by label: "labels = frontend AND project = PROJ"\n'
                '- Find by priority: "priority = High AND project = PROJ"'
            )
        ),
    ],
    fields: Annotated[
        str,
        Field(
            description=(
                "Comma-separated fields to return in the results. "
                "Use '*all' for all fields, or specify individual "
                "fields like 'summary,status,assignee,priority'"
            ),
            default="",
        ),
    ] = "",
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination (0-based)", default=0, ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Field(description="Maximum number of results (1-50)", default=10, ge=1, le=50),
    ] = 10,
    expand: Annotated[
        str,
        Field(
            description="Optional fields to expand in the response (e.g., 'changelog').",
            default="version",
        ),
    ] = "version",
) -> str:
    """Get all issues linked to a specific board filtered by JQL."""
    fields_list: Optional[List[str]] = None
    if fields and fields != "*all":
        fields_list = [f.strip() for f in fields.split(",")]

    params = {
        "jql": jql,
        "fields": fields_list,
        "maxResults": limit,
        "startAt": start_at,
        "expand": expand,
    }

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/issue",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch board issues: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


logger = logging.getLogger("mcp-jira-create-issue")

async def create_issue(
    project_key: str,
    summary: str,
    issue_type: str = "Task",
    description: str = "",
    assignee: str = None,
    components: list = None,
    additional_fields: dict = None,
    use_account_id: bool = True
) -> dict:
    """
    Create a Jira issue using the REST API.

    Args:
        project_key: Jira project key (e.g., SCRUM)
        summary: Issue summary/title
        issue_type: Issue type (e.g., Task, Bug)
        description: Issue description
        assignee: Username or accountId to assign the issue (optional)
        components: List of components names (optional)
        additional_fields: Additional fields as dict (optional)
        use_account_id: If True, use 'accountId' for assignee, else 'name' (default True)

    Returns:
        Response JSON from Jira API or error dict.
    """

    # Convert plain text description to Atlassian Document Format
    adf_description = {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": description or ""
                    }
                ]
            }
        ]
    }

    fields = {
        "project": {"key": project_key},
        "summary": summary,
        "issuetype": {"name": issue_type},
        "description": adf_description,
    }

    if assignee:
        fields["assignee"] = (
            {"accountId": assignee} if use_account_id else {"name": assignee}
        )

    if components:
        fields["components"] = [{"name": c} for c in components]

    if additional_fields:
        fields.update(additional_fields)

    payload = {"fields": fields}

    success, response = await make_api_request(
        path="rest/api/3/issue",
        method="POST",
        data=payload
    )

    if success:
        return response
    else:
        logger.error(f"Failed to create Jira issue: {response}")
        return response

async def batch_create_issues(
    ctx: Context,
    issues: Annotated[
        str,
        Field(
            description=(
                "JSON array of issue objects. Each object should contain:\n"
                "- project_key (required): The project key (e.g., 'PROJ')\n"
                "- summary (required): Issue summary/title\n"
                "- issue_type (required): Type of issue (e.g., 'Task', 'Bug')\n"
                "- description (optional): Issue description\n"
                "- assignee (optional): Assignee username or email\n"
                "- components (optional): Array of component names\n"
                "Example: [\n"
                '  {"project_key": "PROJ", "summary": "Issue 1", "issue_type": "Task"},\n'
                '  {"project_key": "PROJ", "summary": "Issue 2", "issue_type": "Bug", "components": ["Frontend"]}\n'
                "]"
            )
        ),
    ],
    validate_only: Annotated[
        bool,
        Field(
            description="If true, only validates the issues without creating them",
            default=False,
        ),
    ] = False,
) -> str:
    """Create multiple Jira issues in a batch.

    Args:
        ctx: The FastMCP context.
        issues: JSON array string of issue objects.
        validate_only: If true, only validates without creating.

    Returns:
        JSON string indicating success and listing created issues (or validation result).

    Raises:
        ValueError: If in read-only mode, Jira client unavailable, or invalid JSON.
    """
    # Parse issues from JSON string
    try:
        issues_list = json.loads(issues)
        if not isinstance(issues_list, list):
            raise ValueError("Input 'issues' must be a JSON array string.")
    except json.JSONDecodeError:
        raise ValueError("Invalid JSON in issues")
    except Exception as e:
        raise ValueError(f"Invalid input for issues: {e}") from e
    
    # Convert issues to format expected by the API
    formatted_issues = []
    for issue in issues_list:
        # Basic validation
        if not all(key in issue for key in ['project_key', 'summary', 'issue_type']):
            raise ValueError("Each issue must contain project_key, summary, and issue_type")
        
        # Format to match Jira API expectations
        formatted_issue = {
            "fields": {
                "project": {"key": issue['project_key']},
                "summary": issue['summary'],
                "issuetype": {"name": issue['issue_type']}
            }
        }
        
        # Add description if provided
        if 'description' in issue and issue['description']:
            formatted_issue['fields']['description'] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": issue['description']
                            }
                        ]
                    }
                ]
            }
        
        # Add assignee if provided
        if 'assignee' in issue and issue['assignee']:
            # Assume using accountId, as in create_issue
            formatted_issue['fields']['assignee'] = {"accountId": issue['assignee']}
        
        # Add components if provided
        if 'components' in issue and issue['components']:
            formatted_issue['fields']['components'] = [{"name": c} for c in issue['components']]
        
        formatted_issues.append(formatted_issue)
    
    # Prepare the API request payload
    payload = {
        "issueUpdates": formatted_issues,
        "validateOnly": validate_only
    }
    
    success, response = await make_api_request(
        path="rest/api/3/issue/bulk",
        method="POST",
        data=payload
    )
    
    if success:
        message = "Issues validated successfully" if validate_only else "Issues created successfully"
        result = {
            "message": message,
            "issues": response.get("issues", [])
        }
        return json.dumps(result, indent=2, ensure_ascii=False)
    else:
        logger.error(f"Failed to create Jira issues in batch: {response}")
        return json.dumps(response, indent=2, ensure_ascii=False)

async def create_issue_link(
    ctx: Context,
    link_type: Annotated[
        str,
        Field(
            description="The type of link to create (e.g., 'Duplicate', 'Blocks', 'Relates to')"
        ),
    ],
    inward_issue_key: Annotated[
        str, Field(description="The key of the inward issue (e.g., 'PROJ-123')")
    ],
    outward_issue_key: Annotated[
        str, Field(description="The key of the outward issue (e.g., 'PROJ-456')")
    ],
    comment: Annotated[
        str, Field(description="(Optional) Comment to add to the link")
    ] = "",
    comment_visibility: Annotated[
        dict[str, str],
        Field(
            description="(Optional) Visibility settings for the comment (e.g., {'type': 'group', 'value': 'jira-users'})",
            default_factory=dict,
        ),
    ] = {},  # noqa: B006
) -> str:
    """Create a link between two Jira issues.

    Args:
        ctx: The FastMCP context.
        link_type: The type of link (e.g., 'Blocks').
        inward_issue_key: The key of the source issue.
        outward_issue_key: The key of the target issue.
        comment: Optional comment text.
        comment_visibility: Optional dictionary for comment visibility.

    Returns:
        JSON string indicating success or failure.

    Raises:
        ValueError: If required fields are missing or invalid input.
    """
    if not all([link_type, inward_issue_key, outward_issue_key]):
        raise ValueError(
            "link_type, inward_issue_key, and outward_issue_key are required."
        )

    link_data = {
        "type": {"name": link_type},
        "inwardIssue": {"key": inward_issue_key},
        "outwardIssue": {"key": outward_issue_key},
    }

    if comment:
        comment_obj = {"body": comment}
        if comment_visibility and isinstance(comment_visibility, dict):
            if "type" in comment_visibility and "value" in comment_visibility:
                comment_obj["visibility"] = comment_visibility
            else:
                logger.warning("Invalid comment_visibility dictionary structure.")
        link_data["comment"] = comment_obj

    success, response = await make_api_request(
        path="rest/api/3/issueLink",
        method="POST",
        data=link_data
    )

    if success:
        result = {"message": "Issue link created successfully"}
        return json.dumps(result, indent=2, ensure_ascii=False)
    else:
        logger.error(f"Failed to create issue link: {response}")
        return json.dumps(response, indent=2, ensure_ascii=False)

async def remove_issue_link(
    ctx: Context,
    link_id: Annotated[str, Field(description="The ID of the link to remove")],
) -> str:
    """Remove a link between two Jira issues.

    Args:
        ctx: The FastMCP context.
        link_id: The ID of the link to remove.

    Returns:
        JSON string indicating success.

    Raises:
        ValueError: If link_id is missing.
    """
    if not link_id:
        raise ValueError("link_id is required")

    success, response = await make_api_request(
        path=f"rest/api/3/issueLink/{link_id}",
        method="DELETE"
    )

    if success:
        result = {"message": "Issue link removed successfully"}
        return json.dumps(result, indent=2, ensure_ascii=False)
    else:
        logger.error(f"Failed to remove issue link: {response}")
        return json.dumps(response, indent=2, ensure_ascii=False)

async def batch_get_changelogs(
    ctx: Context,
    issue_ids_or_keys: Annotated[
        list[str],
        Field(
            description="List of Jira issue IDs or keys, e.g. ['PROJ-123', 'PROJ-124']"
        ),
    ],
    fields: Annotated[
        list[str],
        Field(
            description="(Optional) Filter the changelogs by fields, e.g. ['status', 'assignee']. Default to [] for all fields.",
            default_factory=list,
        ),
    ] = [],  # noqa: B006
    limit: Annotated[
        int,
        Field(
            description=(
                "Maximum number of changelogs to return in result for each issue. "
                "Default to -1 for all changelogs. "
                "Notice that it only limits the results in the response, "
                "the function will still fetch all the data."
            ),
            default=-1,
        ),
    ] = -1,
) -> str:
    """Get changelogs for multiple Jira issues (Cloud only).

    Args:
        ctx: The FastMCP context.
        issue_ids_or_keys: List of issue IDs or keys.
        fields: List of fields to filter changelogs by. None for all fields.
        limit: Maximum changelogs per issue (-1 for all).

    Returns:
        JSON string representing a list of issues with their changelogs.

    Raises:
        ValueError: If issues list is empty or invalid.
    """
    if not issue_ids_or_keys:
        raise ValueError("At least one issue ID or key is required")
    
    # Prepare API request payload
    payload = {
        "issueIds": issue_ids_or_keys,
        "expand": ["changelog"]
    }
    
    # Add fields filter if provided
    if fields:
        payload["fields"] = fields
    
    success, response = await make_api_request(
        path="rest/api/3/issue/bulk",
        method="POST",
        data=payload
    )
    
    if not success:
        logger.error(f"Failed to batch get changelogs: {response}")
        return json.dumps(response, indent=2, ensure_ascii=False)
    
    # Format the response
    results = []
    limit_val = None if limit == -1 else limit
    
    issues = response.get("issues", [])
    for issue in issues:
        issue_id = issue.get("id")
        changelogs = issue.get("changelog", {}).get("histories", [])
        
        # Apply limit if specified
        if limit_val is not None:
            changelogs = changelogs[:limit_val]
        
        results.append({
            "issue_id": issue_id,
            "changelogs": changelogs
        })
    
    return json.dumps(results, indent=2, ensure_ascii=False)

async def delete_issue(
    issue_key: str,
    delete_subtasks: bool = False
) -> dict:
    """
    Delete a Jira issue using the REST API.

    Args:
        issue_key: The key of the issue to delete (e.g., PROJ-123)
        delete_subtasks: Whether to delete subtasks as well (default: False)

    Returns:
        Response JSON indicating success or containing error details
    """
    if not issue_key:
        return {"error": "Issue key is required"}
    
    logger.info(f"Deleting Jira issue {issue_key} (with subtasks: {delete_subtasks})")
    
    params = {"deleteSubtasks": str(delete_subtasks).lower()}
    
    success, response = await make_api_request(
        path=f"rest/api/3/issue/{issue_key}",
        method="DELETE",
        params=params
    )
    
    if success or getattr(response, "status", None) == 204:
        return {"success": True, "message": f"Issue {issue_key} deleted successfully"}
    
    try:
        error_details = await response.json()
    except Exception:
        error_details = getattr(response, "text", str(response))
    
    logger.error(f"Failed to delete Jira issue {issue_key}: {error_details}")
    return {"error": error_details}


