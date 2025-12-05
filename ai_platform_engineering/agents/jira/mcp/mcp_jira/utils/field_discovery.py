"""Dynamic field discovery for Jira MCP server.

This module provides automatic discovery and caching of Jira field metadata,
allowing the MCP server to work across different Jira instances with varying
field configurations.
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from mcp_jira.api.client import make_api_request

logger = logging.getLogger("mcp-jira")


class FieldDiscovery:
    """Discovers and caches Jira field metadata."""

    # Known field schema types for common custom fields
    EPIC_LINK_SCHEMA = "com.pyxis.greenhopper.jira:gh-epic-link"
    EPIC_NAME_SCHEMA = "com.pyxis.greenhopper.jira:gh-epic-label"
    STORY_POINTS_SCHEMA = "com.pyxis.greenhopper.jira:gh-epic-story-points"
    SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint"
    RANK_SCHEMA = "com.pyxis.greenhopper.jira:gh-lexo-rank"

    def __init__(self):
        """Initialize field discovery with empty cache."""
        self._fields_cache: Optional[List[Dict[str, Any]]] = None
        self._cache_timestamp: Optional[datetime] = None
        self._cache_ttl = timedelta(hours=1)  # Cache for 1 hour
        self._field_id_map: Dict[str, str] = {}  # schema_type -> field_id

    async def _fetch_fields(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch all fields from Jira API.

        Args:
            force_refresh: Force refresh cache even if valid

        Returns:
            List of field metadata dictionaries
        """
        # Check if cache is valid
        if not force_refresh and self._fields_cache is not None and self._cache_timestamp is not None:
            if datetime.now() - self._cache_timestamp < self._cache_ttl:
                logger.debug("Using cached field metadata")
                return self._fields_cache

        logger.info("Fetching field metadata from Jira API")
        try:
            success, data = await make_api_request("/rest/api/3/field")
            if not success or not data:
                logger.error(f"Failed to fetch fields: {'Request failed' if not success else 'No data returned'}")
                return self._fields_cache or []

            # data is already the parsed JSON (list of fields)
            fields = data if isinstance(data, list) else []
            self._fields_cache = fields
            self._cache_timestamp = datetime.now()

            # Update field ID map
            self._build_field_id_map(fields)

            logger.info(f"Successfully cached {len(fields)} field definitions")
            return fields

        except Exception as e:
            logger.error(f"Error fetching field metadata: {e}")
            return self._fields_cache or []

    def _build_field_id_map(self, fields: List[Dict[str, Any]]) -> None:
        """Build a map of schema types to field IDs.

        Args:
            fields: List of field metadata
        """
        self._field_id_map.clear()

        for field in fields:
            if field.get("custom") and "schema" in field:
                schema = field["schema"]
                if "custom" in schema:
                    schema_type = schema["custom"]
                    field_id = field["id"]
                    self._field_id_map[schema_type] = field_id
                    logger.debug(f"Mapped schema '{schema_type}' -> field '{field_id}' ({field.get('name')})")

    async def get_epic_link_field_id(self) -> Optional[str]:
        """Get the Epic Link field ID for this Jira instance.

        Returns:
            Field ID (e.g., 'customfield_10014') or None if not found
        """
        await self._fetch_fields()
        field_id = self._field_id_map.get(self.EPIC_LINK_SCHEMA)

        if field_id:
            logger.info(f"Epic Link field discovered: {field_id}")
        else:
            logger.warning("Epic Link field not found in this Jira instance")

        return field_id

    async def get_epic_name_field_id(self) -> Optional[str]:
        """Get the Epic Name field ID for this Jira instance.

        Returns:
            Field ID (e.g., 'customfield_10011') or None if not found
        """
        await self._fetch_fields()
        field_id = self._field_id_map.get(self.EPIC_NAME_SCHEMA)

        if field_id:
            logger.info(f"Epic Name field discovered: {field_id}")
        else:
            logger.warning("Epic Name field not found in this Jira instance")

        return field_id

    async def get_story_points_field_id(self) -> Optional[str]:
        """Get the Story Points field ID for this Jira instance.

        Returns:
            Field ID (e.g., 'customfield_10016') or None if not found
        """
        await self._fetch_fields()
        field_id = self._field_id_map.get(self.STORY_POINTS_SCHEMA)

        if field_id:
            logger.info(f"Story Points field discovered: {field_id}")
        else:
            logger.warning("Story Points field not found in this Jira instance")

        return field_id

    async def get_sprint_field_id(self) -> Optional[str]:
        """Get the Sprint field ID for this Jira instance.

        Returns:
            Field ID (e.g., 'customfield_10020') or None if not found
        """
        await self._fetch_fields()
        field_id = self._field_id_map.get(self.SPRINT_SCHEMA)

        if field_id:
            logger.info(f"Sprint field discovered: {field_id}")
        else:
            logger.warning("Sprint field not found in this Jira instance")

        return field_id

    async def get_field_by_name(self, name: str, case_sensitive: bool = False) -> Optional[Dict[str, Any]]:
        """Find a field by its display name.

        Args:
            name: Field name to search for
            case_sensitive: Whether to do case-sensitive matching

        Returns:
            Field metadata dictionary or None if not found
        """
        fields = await self._fetch_fields()

        search_name = name if case_sensitive else name.lower()

        for field in fields:
            field_name = field.get("name", "")
            compare_name = field_name if case_sensitive else field_name.lower()

            if compare_name == search_name:
                logger.info(f"Found field '{field_name}' (ID: {field['id']})")
                return field

        logger.warning(f"Field with name '{name}' not found")
        return None

    async def get_field_by_id(self, field_id: str) -> Optional[Dict[str, Any]]:
        """Find a field by its ID.

        Args:
            field_id: Field ID (e.g., 'customfield_10014')

        Returns:
            Field metadata dictionary or None if not found
        """
        fields = await self._fetch_fields()

        for field in fields:
            if field.get("id") == field_id:
                logger.info(f"Found field with ID '{field_id}': {field.get('name')}")
                return field

        logger.warning(f"Field with ID '{field_id}' not found")
        return None

    async def get_custom_fields(self) -> List[Dict[str, Any]]:
        """Get all custom fields.

        Returns:
            List of custom field metadata
        """
        fields = await self._fetch_fields()
        custom_fields = [f for f in fields if f.get("custom", False)]
        logger.info(f"Found {len(custom_fields)} custom fields")
        return custom_fields

    async def refresh_cache(self) -> None:
        """Force refresh the field metadata cache."""
        logger.info("Force refreshing field metadata cache")
        await self._fetch_fields(force_refresh=True)

    def get_cached_field_count(self) -> int:
        """Get the number of cached fields.

        Returns:
            Number of fields in cache, or 0 if cache is empty
        """
        return len(self._fields_cache) if self._fields_cache else 0

    async def normalize_field_name_to_id(self, field_name: str) -> Optional[str]:
        """Convert a field name (or ID) to its canonical field ID.

        Args:
            field_name: Field name (e.g., "Epic Link") or ID (e.g., "customfield_10014")

        Returns:
            Field ID or None if not found
        """
        # If it's already a field ID, return it
        if field_name.startswith("customfield_") or field_name in ["summary", "description", "project", "issuetype", "priority", "assignee", "reporter", "labels", "components", "fixVersions", "versions", "parent", "duedate"]:
            return field_name

        # Try to find by name
        field = await self.get_field_by_name(field_name)
        return field["id"] if field else None

    async def get_field_type(self, field_id: str) -> Optional[str]:
        """Get the type of a field.

        Args:
            field_id: Field ID (e.g., "customfield_10014" or "summary")

        Returns:
            Field type (e.g., "string", "user", "array", "date", etc.) or None
        """
        field = await self.get_field_by_id(field_id)
        if not field:
            return None

        schema = field.get("schema", {})
        return schema.get("type")

    async def get_field_schema(self, field_id: str) -> Optional[Dict[str, Any]]:
        """Get the complete schema for a field.

        Args:
            field_id: Field ID

        Returns:
            Schema dictionary or None if not found
        """
        field = await self.get_field_by_id(field_id)
        return field.get("schema") if field else None

    async def is_field_required(self, field_id: str, project_key: str, issue_type: str) -> bool:
        """Check if a field is required for a specific project and issue type.

        Note: This requires querying the create metadata endpoint.

        Args:
            field_id: Field ID
            project_key: Project key
            issue_type: Issue type name

        Returns:
            True if required, False otherwise
        """
        # Query create metadata for this project and issue type
        success, data = await make_api_request(
            "/rest/api/3/issue/createmeta",
            params={
                "projectKeys": project_key,
                "issuetypeNames": issue_type,
                "expand": "projects.issuetypes.fields"
            }
        )

        if not success or not data:
            logger.warning(f"Failed to fetch create metadata for {project_key}/{issue_type}")
            return False

        try:
            projects = data.get("projects", [])
            if not projects:
                return False

            issue_types = projects[0].get("issuetypes", [])
            if not issue_types:
                return False

            fields = issue_types[0].get("fields", {})
            field_meta = fields.get(field_id, {})

            return field_meta.get("required", False)

        except (IndexError, KeyError) as e:
            logger.warning(f"Error parsing create metadata: {e}")
            return False

    async def validate_field_value(self, field_id: str, value: Any) -> tuple[bool, Optional[str]]:
        """Validate a field value against its schema.

        Args:
            field_id: Field ID
            value: Value to validate

        Returns:
            Tuple of (is_valid, error_message)
        """
        field = await self.get_field_by_id(field_id)
        if not field:
            return False, f"Field '{field_id}' not found"

        schema = field.get("schema", {})
        field_type = schema.get("type")
        field_name = field.get("name", field_id)

        # Type-specific validation
        if field_type == "string":
            if not isinstance(value, str):
                return False, f"Field '{field_name}' expects a string, got {type(value).__name__}"

        elif field_type == "number":
            if not isinstance(value, (int, float)):
                return False, f"Field '{field_name}' expects a number, got {type(value).__name__}"

        elif field_type == "array":
            if not isinstance(value, list):
                return False, f"Field '{field_name}' expects an array, got {type(value).__name__}"

        elif field_type == "user":
            if not isinstance(value, dict) or "accountId" not in value:
                return False, f"Field '{field_name}' expects a user object with 'accountId'"

        elif field_type == "date":
            if not isinstance(value, str):
                return False, f"Field '{field_name}' expects a date string (YYYY-MM-DD), got {type(value).__name__}"

        elif field_type == "datetime":
            if not isinstance(value, str):
                return False, f"Field '{field_name}' expects a datetime string (ISO 8601), got {type(value).__name__}"

        return True, None

    async def suggest_similar_fields(self, field_name: str, limit: int = 5) -> List[str]:
        """Suggest similar field names when a field is not found.

        Args:
            field_name: Field name that was not found
            limit: Maximum number of suggestions

        Returns:
            List of similar field names
        """
        fields = await self._fetch_fields()

        # Simple similarity: check if the search term is in the field name
        search_lower = field_name.lower()
        suggestions = []

        for field in fields:
            name = field.get("name", "")
            if search_lower in name.lower():
                suggestions.append(f"{name} (ID: {field['id']})")
                if len(suggestions) >= limit:
                    break

        return suggestions


# Global singleton instance
_field_discovery_instance: Optional[FieldDiscovery] = None


def get_field_discovery() -> FieldDiscovery:
    """Get the global FieldDiscovery instance.

    Returns:
        FieldDiscovery singleton instance
    """
    global _field_discovery_instance
    if _field_discovery_instance is None:
        _field_discovery_instance = FieldDiscovery()
    return _field_discovery_instance


