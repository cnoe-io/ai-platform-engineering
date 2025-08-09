"""Issue link operations for Jira MCP"""

import logging
import json
from pydantic import Field
from typing_extensions import Annotated
from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.link import JiraIssueLinkType

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

async def get_link_types() -> str:
    """Get all available issue link types.

    Returns:
        JSON string representing a list of issue link type objects.
    """
    response = await make_api_request("/rest/api/2/issueLinkType")
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

    Args:
        issue_key: The key of the issue to link.
        epic_key: The key of the epic to link to.

    Returns:
        JSON string representing the updated issue object.

    Raises:
        ValueError: If in read-only mode or Jira client unavailable.
    """
    payload = {
        "issues": [issue_key],
        "epicKey": epic_key,
    }
    response = await make_api_request("/rest/agile/1.0/epic/{epic_key}/issue", method="POST", json=payload)
    if not response or response.status_code != 200:
        raise ValueError(f"Failed to link issue {issue_key} to epic {epic_key}. Response: {response}")
    result = {
        "message": f"Issue {issue_key} has been linked to epic {epic_key}.",
        "response": response.json(),
    }
    return json.dumps(result, indent=2, ensure_ascii=False)
