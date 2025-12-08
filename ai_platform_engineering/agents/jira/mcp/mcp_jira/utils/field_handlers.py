"""Field type handlers for Jira field normalization.

This module provides utilities for normalizing and validating field values
based on their Jira field type.
"""

import logging
from typing import Any, Dict, List, Optional, Union
from datetime import datetime, date

from mcp_jira.utils.adf import ensure_adf_format, is_adf_format
from mcp_jira.utils.date import parse_date

logger = logging.getLogger("mcp-jira")


async def normalize_field_value(
    field_id: str,
    value: Any,
    field_schema: Optional[Dict[str, Any]] = None
) -> tuple[Any, Optional[str]]:
    """Normalize a field value based on its type.

    Args:
        field_id: Field ID
        value: Raw value to normalize
        field_schema: Field schema from FieldDiscovery (optional)

    Returns:
        Tuple of (normalized_value, error_message)
    """
    if value is None:
        return None, None

    if not field_schema:
        # If no schema provided, return value as-is
        return value, None

    field_type = field_schema.get("type")
    schema_custom = field_schema.get("custom")

    try:
        # Handle different field types
        if field_type == "string":
            # Check if this is a rich text field (ADF)
            if schema_custom and "atlassian-adf" in schema_custom.lower():
                return _normalize_adf_field(value), None
            else:
                return _normalize_string_field(value), None

        elif field_type == "number":
            return _normalize_number_field(value), None

        elif field_type == "date":
            return _normalize_date_field(value), None

        elif field_type == "datetime":
            return _normalize_datetime_field(value), None

        elif field_type == "user":
            return _normalize_user_field(value), None

        elif field_type == "array":
            items_type = field_schema.get("items")
            return _normalize_array_field(value, items_type), None

        elif field_type == "option":
            return _normalize_option_field(value), None

        elif field_type == "priority":
            return _normalize_priority_field(value), None

        elif field_type == "issuetype":
            return _normalize_issuetype_field(value), None

        elif field_type == "project":
            return _normalize_project_field(value), None

        elif field_type == "version":
            return _normalize_version_field(value), None

        elif field_type == "component":
            return _normalize_component_field(value), None

        else:
            # Unknown type, return as-is
            logger.warning(f"Unknown field type '{field_type}' for field '{field_id}', passing value as-is")
            return value, None

    except Exception as e:
        error_msg = f"Error normalizing field '{field_id}': {str(e)}"
        logger.error(error_msg)
        return value, error_msg


def _normalize_adf_field(value: Any) -> Dict[str, Any]:
    """Normalize ADF (rich text) field."""
    if isinstance(value, str):
        return ensure_adf_format(value)
    elif isinstance(value, dict) and is_adf_format(value):
        return value
    else:
        # Try to convert to string first
        return ensure_adf_format(str(value))


def _normalize_string_field(value: Any) -> str:
    """Normalize string field."""
    if isinstance(value, str):
        return value
    return str(value)


def _normalize_number_field(value: Any) -> Union[int, float]:
    """Normalize number field."""
    if isinstance(value, (int, float)):
        return value

    # Try to parse string
    if isinstance(value, str):
        try:
            if '.' in value:
                return float(value)
            return int(value)
        except ValueError:
            raise ValueError(f"Cannot convert '{value}' to number")

    raise ValueError(f"Cannot convert {type(value).__name__} to number")


def _normalize_date_field(value: Any) -> str:
    """Normalize date field (YYYY-MM-DD format).

    Args:
        value: Date value (string, datetime, or date object)

    Returns:
        ISO date string (YYYY-MM-DD)
    """
    if isinstance(value, str):
        # Validate/parse the date string
        try:
            parsed_date = parse_date(value)
            if isinstance(parsed_date, datetime):
                return parsed_date.strftime("%Y-%m-%d")
            elif isinstance(parsed_date, date):
                return parsed_date.strftime("%Y-%m-%d")
            return value  # Already valid format
        except Exception:
            # Assume it's already in correct format
            return value

    elif isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")

    elif isinstance(value, date):
        return value.strftime("%Y-%m-%d")

    raise ValueError(f"Cannot convert {type(value).__name__} to date")


def _normalize_datetime_field(value: Any) -> str:
    """Normalize datetime field (ISO 8601 format).

    Args:
        value: Datetime value (string or datetime object)

    Returns:
        ISO datetime string
    """
    if isinstance(value, str):
        # Validate it's ISO 8601 format
        return value

    elif isinstance(value, datetime):
        return value.isoformat()

    elif isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()

    raise ValueError(f"Cannot convert {type(value).__name__} to datetime")


def _normalize_user_field(value: Any) -> Dict[str, str]:
    """Normalize user field.

    Args:
        value: User value (dict with accountId, email, or name, or just a string)

    Returns:
        User object with accountId
    """
    if isinstance(value, dict):
        if "accountId" in value:
            return {"accountId": value["accountId"]}
        elif "id" in value:
            return {"accountId": value["id"]}
        elif "name" in value:
            # Legacy username - not recommended, but try it
            logger.warning(f"Using legacy username '{value['name']}' for user field, accountId preferred")
            return {"name": value["name"]}

    elif isinstance(value, str):
        # Assume it's an accountId
        return {"accountId": value}

    raise ValueError(f"Cannot convert {type(value).__name__} to user object")


def _normalize_array_field(value: Any, items_type: Optional[str] = None) -> List[Any]:
    """Normalize array field.

    Args:
        value: Array value or single value
        items_type: Type of items in the array

    Returns:
        List of normalized items
    """
    if not isinstance(value, list):
        value = [value]

    # Normalize each item based on items_type
    if items_type == "string":
        return [str(item) if not isinstance(item, str) else item for item in value]

    elif items_type == "option":
        return [_normalize_option_field(item) for item in value]

    elif items_type == "component":
        return [_normalize_component_field(item) for item in value]

    elif items_type == "version":
        return [_normalize_version_field(item) for item in value]

    return value


def _normalize_option_field(value: Any) -> Dict[str, Any]:
    """Normalize option field (select, radio, etc.).

    Args:
        value: Option value (dict with id/value, or string)

    Returns:
        Option object
    """
    if isinstance(value, dict):
        # Already in correct format
        if "id" in value or "value" in value:
            return value
        return {"value": str(value)}

    elif isinstance(value, str):
        return {"value": value}

    return {"value": str(value)}


def _normalize_priority_field(value: Any) -> Dict[str, str]:
    """Normalize priority field.

    Args:
        value: Priority value (dict with id/name, or string)

    Returns:
        Priority object
    """
    if isinstance(value, dict):
        if "id" in value or "name" in value:
            return value

    if isinstance(value, str):
        return {"name": value}

    return {"name": str(value)}


def _normalize_issuetype_field(value: Any) -> Dict[str, str]:
    """Normalize issue type field.

    Args:
        value: Issue type value (dict with id/name, or string)

    Returns:
        Issue type object
    """
    if isinstance(value, dict):
        if "id" in value or "name" in value:
            return value

    if isinstance(value, str):
        return {"name": value}

    return {"name": str(value)}


def _normalize_project_field(value: Any) -> Dict[str, str]:
    """Normalize project field.

    Args:
        value: Project value (dict with id/key, or string)

    Returns:
        Project object
    """
    if isinstance(value, dict):
        if "id" in value or "key" in value:
            return value

    if isinstance(value, str):
        # Assume it's a project key
        return {"key": value}

    return {"key": str(value)}


def _normalize_version_field(value: Any) -> Dict[str, Any]:
    """Normalize version field.

    Args:
        value: Version value (dict with id/name, or string)

    Returns:
        Version object
    """
    if isinstance(value, dict):
        if "id" in value or "name" in value:
            return value

    if isinstance(value, str):
        return {"name": value}

    return {"name": str(value)}


def _normalize_component_field(value: Any) -> Dict[str, Any]:
    """Normalize component field.

    Args:
        value: Component value (dict with id/name, or string)

    Returns:
        Component object
    """
    if isinstance(value, dict):
        if "id" in value or "name" in value:
            return value

    if isinstance(value, str):
        return {"name": value}

    return {"name": str(value)}

