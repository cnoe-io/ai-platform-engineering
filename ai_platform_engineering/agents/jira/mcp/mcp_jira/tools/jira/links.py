"""Issue link operations for Jira MCP"""

import logging
import json
import os
from pydantic import Field
from typing_extensions import Annotated
from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.link import JiraIssueLinkType
from mcp_jira.tools.jira.constants import check_read_only
from mcp_jira.utils.field_discovery import get_field_discovery

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

async def get_link_types() -> str:
    """Get all available issue link types.

    Returns:
        JSON string representing a list of issue link type objects.
    """
    response = await make_api_request("/rest/api/3/issueLinkType")
    if not response or response.status_code != 200:
        raise ValueError("Failed to fetch issue link types. Response: {response}")
    link_types_data = response.json().get("issueLinkTypes", [])
    return json.dumps([JiraIssueLinkType(**link) for link in link_types_data], indent=2, ensure_ascii=False)

async def link_to_epic(
    issue_key: Annotated[
        str, Field(description="The key of the issue to link (e.g., 'PROJ-123')")
    ],
    epic_key: Annotated[
        str, Field(description="The key of the epic to link to (e.g., 'PROJ-456')")
    ],
) -> str:
    """Link an existing issue to an epic.

    This function uses dynamic field discovery to automatically detect the correct
    Epic Link field for this Jira instance. It tries multiple methods in order:
    1. Discovered 'Epic Link' custom field (most reliable for classic projects)
    2. 'parent' field (for next-gen/team-managed projects)
    3. Agile API fallback (requires special permissions)

    The field metadata is cached for 1 hour to improve performance.

    Args:
        issue_key: The key of the issue to link.
        epic_key: The key of the epic to link to.

    Returns:
        JSON string representing the updated issue object.

    Raises:
        ValueError: If in read-only mode or all linking methods fail.
    """
    check_read_only()

    field_discovery = get_field_discovery()
    errors = []

    # Method 1: Use dynamically discovered Epic Link field (best for classic projects)
    epic_link_field_id = await field_discovery.get_epic_link_field_id()
    if epic_link_field_id:
        logger.info(f"Attempting to link {issue_key} to epic {epic_key} using discovered field {epic_link_field_id}")
        payload_epic_link = {
            "fields": {
                epic_link_field_id: epic_key
            }
        }
        success, response_data = await make_api_request(f"/rest/api/3/issue/{issue_key}", method="PUT", data=payload_epic_link)
        if success:
            result = {
                "message": f"✅ Issue {issue_key} has been successfully linked to epic {epic_key}.",
                "method": "epic_link_field_discovery",
                "field_id": epic_link_field_id
            }
            logger.info(f"Successfully linked {issue_key} to epic {epic_key} using {epic_link_field_id}")
            return json.dumps(result, indent=2, ensure_ascii=False)
        else:
            status = response_data.get("status", "unknown")
            error_msg = response_data.get("error", "Unknown error")
            error_detail = f"Epic Link field ({epic_link_field_id}): {status} - {error_msg}"
            errors.append(error_detail)
            logger.warning(f"Failed to link using discovered Epic Link field: {error_detail}")

    # Method 2: Try using parent field (works in next-gen/team-managed projects)
    logger.info(f"Attempting to link {issue_key} to epic {epic_key} using parent field")
    payload_parent = {
        "fields": {
            "parent": {"key": epic_key}
        }
    }
    success, response_data = await make_api_request(f"/rest/api/3/issue/{issue_key}", method="PUT", data=payload_parent)
    if success:
        result = {
            "message": f"✅ Issue {issue_key} has been successfully linked to epic {epic_key}.",
            "method": "parent_field"
        }
        logger.info(f"Successfully linked {issue_key} to epic {epic_key} using parent field")
        return json.dumps(result, indent=2, ensure_ascii=False)
    else:
        status = response_data.get("status", "unknown")
        error_msg = response_data.get("error", "Unknown error")
        error_detail = f"Parent field: {status} - {error_msg}"
        errors.append(error_detail)
        logger.warning(f"Failed to link using parent field: {error_detail}")

    # Method 3: Fallback to Agile API (may require special permissions)
    logger.info(f"Attempting to link {issue_key} to epic {epic_key} using Agile API")
    payload_agile = {
        "issues": [issue_key]
    }
    success, response_data = await make_api_request(f"/rest/agile/1.0/epic/{epic_key}/issue", method="POST", data=payload_agile)
    if success:
        result = {
            "message": f"✅ Issue {issue_key} has been successfully linked to epic {epic_key}.",
            "method": "agile_api",
            "response": response_data if response_data else {}
        }
        logger.info(f"Successfully linked {issue_key} to epic {epic_key} using Agile API")
        return json.dumps(result, indent=2, ensure_ascii=False)
    else:
        status = response_data.get("status", "unknown")
        error_msg = response_data.get("error", "Unknown error")
        error_detail = f"Agile API: {status} - {error_msg}"
        errors.append(error_detail)
        logger.warning(f"Failed to link using Agile API: {error_detail}")

    # All methods failed
    error_msg = f"❌ Failed to link issue {issue_key} to epic {epic_key}. Tried all available methods:\n"
    for i, error in enumerate(errors, 1):
        error_msg += f"  {i}. {error}\n"
    error_msg += "\nPossible causes:\n"
    error_msg += "  - Epic Link field may not be configured in this Jira instance\n"
    error_msg += "  - Insufficient permissions to link issues\n"
    error_msg += "  - The issue or epic may not exist\n"
    error_msg += "  - The issue type may not support epic linking\n"

    logger.error(error_msg)
    raise ValueError(error_msg)


async def get_epic_issues(
    epic_key: Annotated[
        str, Field(description="The key of the epic to get issues for (e.g., 'PROJ-123')")
    ],
    fields: Annotated[
        str,
        Field(
            description="Comma-separated fields to return (e.g., 'summary,status,assignee'). Default returns common fields.",
            default="summary,status,assignee,issuetype,priority,created,updated"
        )
    ] = "summary,status,assignee,issuetype,priority,created,updated",
    max_results: Annotated[
        int,
        Field(
            description="Maximum number of issues to return (default: 100)",
            default=100
        )
    ] = 100,
) -> str:
    """Get all issues linked to an epic (child issues/stories/tasks in the epic).

    This function retrieves issues that belong to an epic using multiple methods:
    1. JQL search with 'Epic Link' custom field (for classic projects)
    2. JQL search with 'parent' field (for next-gen/team-managed projects)
    3. Agile API fallback

    Note: This is different from 'issuelinks' which shows direct issue-to-issue links
    (like 'blocks', 'duplicates'). This function finds issues that are children of the epic.

    Args:
        epic_key: The key of the epic (e.g., 'SRE-9945')
        fields: Comma-separated list of fields to return
        max_results: Maximum number of results

    Returns:
        JSON string with list of issues in the epic
    """
    base_url = os.getenv("ATLASSIAN_API_URL", "").rstrip("/")
    results = []
    methods_tried = []

    # Method 1: Try JQL with "Epic Link" = epic_key (classic projects)
    logger.info(f"Searching for issues in epic {epic_key} using 'Epic Link' JQL")
    jql_epic_link = f'"Epic Link" = {epic_key}'

    success, response = await make_api_request(
        path="rest/api/3/search",
        method="POST",
        data={
            "jql": jql_epic_link,
            "fields": fields.split(",") if fields else ["summary", "status", "assignee", "issuetype"],
            "maxResults": max_results
        }
    )

    if success and response.get("issues"):
        issues = response.get("issues", [])
        logger.info(f"Found {len(issues)} issues using 'Epic Link' JQL")
        results.extend(issues)
        methods_tried.append({"method": "Epic Link JQL", "count": len(issues)})
    else:
        methods_tried.append({"method": "Epic Link JQL", "count": 0, "note": "No results or field not available"})
        logger.info("No issues found using 'Epic Link' JQL, trying parent field...")

    # Method 2: Try JQL with parent = epic_key (next-gen/team-managed projects)
    if not results:
        logger.info(f"Searching for issues in epic {epic_key} using 'parent' JQL")
        jql_parent = f'parent = {epic_key}'

        success, response = await make_api_request(
            path="rest/api/3/search",
            method="POST",
            data={
                "jql": jql_parent,
                "fields": fields.split(",") if fields else ["summary", "status", "assignee", "issuetype"],
                "maxResults": max_results
            }
        )

        if success and response.get("issues"):
            issues = response.get("issues", [])
            logger.info(f"Found {len(issues)} issues using 'parent' JQL")
            results.extend(issues)
            methods_tried.append({"method": "parent JQL", "count": len(issues)})
        else:
            methods_tried.append({"method": "parent JQL", "count": 0})

    # Method 3: Try Agile API as fallback
    if not results:
        logger.info(f"Trying Agile API to get issues in epic {epic_key}")
        success, response = await make_api_request(
            path=f"rest/agile/1.0/epic/{epic_key}/issue",
            method="GET",
            params={"maxResults": max_results}
        )

        if success and response.get("issues"):
            issues = response.get("issues", [])
            logger.info(f"Found {len(issues)} issues using Agile API")
            results.extend(issues)
            methods_tried.append({"method": "Agile API", "count": len(issues)})
        else:
            methods_tried.append({"method": "Agile API", "count": 0})

    # Format the response
    formatted_issues = []
    for issue in results:
        issue_data = {
            "key": issue.get("key"),
            "id": issue.get("id"),
            "url": f"{base_url}/browse/{issue.get('key')}" if base_url else None
        }

        # Extract fields
        fields_data = issue.get("fields", {})
        issue_data["summary"] = fields_data.get("summary", "")

        # Status
        status = fields_data.get("status")
        if status:
            issue_data["status"] = status.get("name") if isinstance(status, dict) else status

        # Issue type
        issuetype = fields_data.get("issuetype")
        if issuetype:
            issue_data["type"] = issuetype.get("name") if isinstance(issuetype, dict) else issuetype

        # Assignee
        assignee = fields_data.get("assignee")
        if assignee:
            issue_data["assignee"] = assignee.get("displayName") if isinstance(assignee, dict) else assignee

        # Priority
        priority = fields_data.get("priority")
        if priority:
            issue_data["priority"] = priority.get("name") if isinstance(priority, dict) else priority

        # Dates
        if fields_data.get("created"):
            issue_data["created"] = fields_data.get("created")
        if fields_data.get("updated"):
            issue_data["updated"] = fields_data.get("updated")

        formatted_issues.append(issue_data)

    result = {
        "epic_key": epic_key,
        "total_issues": len(formatted_issues),
        "methods_tried": methods_tried,
        "issues": formatted_issues
    }

    if not formatted_issues:
        result["message"] = f"No child issues found for epic {epic_key}. This epic may not have any linked stories/tasks, or the issues might be linked using a different method."

    return json.dumps(result, indent=2, ensure_ascii=False)
