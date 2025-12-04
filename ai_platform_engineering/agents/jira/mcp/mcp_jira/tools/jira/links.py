"""Issue link operations for Jira MCP"""

import logging
import json
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
