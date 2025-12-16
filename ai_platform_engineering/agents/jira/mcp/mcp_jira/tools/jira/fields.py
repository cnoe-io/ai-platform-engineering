"""Jira field discovery and management tools for MCP."""

import logging
import json
from typing import Annotated
from pydantic import Field
from mcp_jira.utils.field_discovery import get_field_discovery

logger = logging.getLogger("mcp-jira")


async def get_field_info(
    field_name: Annotated[
        str,
        Field(description="Name or partial name of the field to search for (e.g., 'Epic Link', 'Story Points')")
    ]
) -> str:
    """Get information about a Jira field by name.

    This tool searches for fields matching the given name and returns
    detailed information including the field ID, type, and schema.

    Args:
        field_name: The name or partial name of the field to search for.

    Returns:
        JSON string with field information or error message.
    """
    field_discovery = get_field_discovery()

    # Try exact match first
    field = await field_discovery.get_field_by_name(field_name, case_sensitive=False)

    if field:
        result = {
            "found": True,
            "field": {
                "id": field.get("id"),
                "name": field.get("name"),
                "custom": field.get("custom", False),
                "schema": field.get("schema", {}),
                "clauseNames": field.get("clauseNames", []),
                "searchable": field.get("searchable", False),
                "orderable": field.get("orderable", False)
            }
        }
        logger.info(f"Found field '{field_name}': {field.get('id')}")
    else:
        result = {
            "found": False,
            "message": f"Field '{field_name}' not found",
            "suggestion": "Try searching with a partial name or check field list"
        }
        logger.warning(f"Field '{field_name}' not found")

    return json.dumps(result, indent=2, ensure_ascii=False)


async def list_custom_fields(
    limit: Annotated[
        int,
        Field(description="Maximum number of fields to return (default 50 to prevent context overflow)")
    ] = 50,
    include_schema: Annotated[
        bool,
        Field(description="Whether to include full schema details (default False for smaller output)")
    ] = False,
) -> str:
    """List custom fields available in this Jira instance.

    Returns a paginated list of custom fields. Use get_field_info() for
    detailed schema of specific fields.

    Args:
        limit: Maximum number of fields to return (default 50).
        include_schema: Whether to include full schema details.

    Returns:
        JSON string with list of custom fields including IDs and names.
    """
    field_discovery = get_field_discovery()
    custom_fields = await field_discovery.get_custom_fields()

    # Limit output to prevent context overflow
    total_count = len(custom_fields)
    limited_fields = custom_fields[:limit]

    if include_schema:
        fields_output = [
            {
                "id": field.get("id"),
                "name": field.get("name"),
                "schema": field.get("schema", {})
            }
            for field in limited_fields
        ]
    else:
        # Smaller output: just id, name, and schema type
        fields_output = [
            {
                "id": field.get("id"),
                "name": field.get("name"),
                "type": field.get("schema", {}).get("type", "unknown")
            }
            for field in limited_fields
        ]

    result = {
        "total_count": total_count,
        "returned_count": len(limited_fields),
        "custom_fields": fields_output,
    }

    # Add pagination hint if there are more fields
    if total_count > limit:
        result["note"] = f"Showing first {limit} of {total_count} fields. Use get_field_info('field_name') to get details for a specific field."

    logger.info(f"Listed {len(limited_fields)} of {total_count} custom fields")
    return json.dumps(result, indent=2, ensure_ascii=False)


async def get_epic_link_field() -> str:
    """Get the Epic Link field ID for this Jira instance.

    This is useful for understanding which custom field is used for
    linking issues to epics in classic Jira projects.

    Returns:
        JSON string with Epic Link field information.
    """
    field_discovery = get_field_discovery()
    field_id = await field_discovery.get_epic_link_field_id()

    if field_id:
        # Get full field info
        field = await field_discovery.get_field_by_id(field_id)
        result = {
            "found": True,
            "field_id": field_id,
            "field_name": field.get("name") if field else "Unknown",
            "message": f"Epic Link field is '{field_id}'"
        }
        logger.info(f"Epic Link field: {field_id}")
    else:
        result = {
            "found": False,
            "message": "Epic Link field not found in this Jira instance",
            "suggestion": "This instance may use 'parent' field for next-gen projects or not support epics"
        }
        logger.warning("Epic Link field not found")

    return json.dumps(result, indent=2, ensure_ascii=False)


async def refresh_field_cache() -> str:
    """Refresh the cached field metadata.

    Field metadata is automatically cached for 1 hour. Use this tool if you've
    made changes to your Jira instance's fields and need to see them immediately.

    Returns:
        JSON string confirming cache refresh.
    """
    field_discovery = get_field_discovery()
    await field_discovery.refresh_cache()

    field_count = field_discovery.get_cached_field_count()

    result = {
        "success": True,
        "message": "Field metadata cache refreshed successfully",
        "total_fields": field_count
    }

    logger.info(f"Field cache refreshed: {field_count} fields")
    return json.dumps(result, indent=2, ensure_ascii=False)


