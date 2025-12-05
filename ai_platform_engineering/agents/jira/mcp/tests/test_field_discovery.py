"""Unit tests for Field Discovery functionality."""

import pytest
from mcp_jira.utils.field_discovery import FieldDiscovery, get_field_discovery


class TestFieldDiscovery:
    """Tests for FieldDiscovery class."""

    @pytest.mark.asyncio
    async def test_fetch_fields(self, mock_api_request_fields, mock_jira_fields):
        """Test fetching and caching fields."""
        discovery = FieldDiscovery()

        fields = await discovery._fetch_fields()

        assert len(fields) == len(mock_jira_fields)
        assert fields[0]["id"] == "summary"
        assert discovery._fields_cache is not None

    @pytest.mark.asyncio
    async def test_cache_mechanism(self, mock_api_request_fields):
        """Test that fields are cached."""
        discovery = FieldDiscovery()

        # First fetch
        fields1 = await discovery._fetch_fields()
        timestamp1 = discovery._cache_timestamp

        # Second fetch (should use cache)
        fields2 = await discovery._fetch_fields()
        timestamp2 = discovery._cache_timestamp

        assert fields1 == fields2
        assert timestamp1 == timestamp2  # Cache timestamp unchanged

    @pytest.mark.asyncio
    async def test_force_refresh(self, mock_api_request_fields):
        """Test forcing cache refresh."""
        discovery = FieldDiscovery()

        # Initial fetch
        await discovery._fetch_fields()
        timestamp1 = discovery._cache_timestamp

        # Force refresh
        await discovery._fetch_fields(force_refresh=True)
        timestamp2 = discovery._cache_timestamp

        assert timestamp2 > timestamp1  # New timestamp


class TestGetEpicLinkField:
    """Tests for getting Epic Link field ID."""

    @pytest.mark.asyncio
    async def test_get_epic_link_field_id(self, mock_api_request_fields):
        """Test discovering Epic Link field."""
        discovery = FieldDiscovery()

        field_id = await discovery.get_epic_link_field_id()

        assert field_id == "customfield_10006"

    @pytest.mark.asyncio
    async def test_epic_link_not_found(self, monkeypatch):
        """Test when Epic Link field doesn't exist."""
        async def mock_request_no_epic(path, method="GET", **kwargs):
            return (True, [
                {"id": "summary", "name": "Summary", "custom": False, "schema": {"type": "string"}}
            ])

        # Need to patch in both locations
        import mcp_jira.api.client
        import mcp_jira.utils.field_discovery
        monkeypatch.setattr(mcp_jira.api.client, "make_api_request", mock_request_no_epic)
        monkeypatch.setattr(mcp_jira.utils.field_discovery, "make_api_request", mock_request_no_epic)

        # Create fresh discovery instance
        discovery = FieldDiscovery()
        # Clear any cached data
        discovery._fields_cache = None
        discovery._cache_timestamp = None

        field_id = await discovery.get_epic_link_field_id()

        assert field_id is None


class TestGetFieldByName:
    """Tests for finding fields by name."""

    @pytest.mark.asyncio
    async def test_get_field_by_name_exists(self, mock_api_request_fields):
        """Test finding field by exact name."""
        discovery = FieldDiscovery()

        field = await discovery.get_field_by_name("Epic Link")

        assert field is not None
        assert field["id"] == "customfield_10006"
        assert field["name"] == "Epic Link"

    @pytest.mark.asyncio
    async def test_get_field_by_name_case_insensitive(self, mock_api_request_fields):
        """Test case-insensitive field search."""
        discovery = FieldDiscovery()

        field = await discovery.get_field_by_name("epic link")  # lowercase

        assert field is not None
        assert field["name"] == "Epic Link"

    @pytest.mark.asyncio
    async def test_get_field_by_name_not_found(self, mock_api_request_fields):
        """Test field not found."""
        discovery = FieldDiscovery()

        field = await discovery.get_field_by_name("NonExistent Field")

        assert field is None


class TestGetFieldById:
    """Tests for finding fields by ID."""

    @pytest.mark.asyncio
    async def test_get_field_by_id_exists(self, mock_api_request_fields):
        """Test finding field by ID."""
        discovery = FieldDiscovery()

        field = await discovery.get_field_by_id("customfield_10016")

        assert field is not None
        assert field["name"] == "Story Points"

    @pytest.mark.asyncio
    async def test_get_field_by_id_system_field(self, mock_api_request_fields):
        """Test finding system field by ID."""
        discovery = FieldDiscovery()

        field = await discovery.get_field_by_id("summary")

        assert field is not None
        assert field["name"] == "Summary"

    @pytest.mark.asyncio
    async def test_get_field_by_id_not_found(self, mock_api_request_fields):
        """Test field ID not found."""
        discovery = FieldDiscovery()

        field = await discovery.get_field_by_id("customfield_99999")

        assert field is None


class TestNormalizeFieldName:
    """Tests for field name normalization."""

    @pytest.mark.asyncio
    async def test_normalize_field_id_passthrough(self, mock_api_request_fields):
        """Test that field IDs pass through unchanged."""
        discovery = FieldDiscovery()

        # Custom field ID
        result = await discovery.normalize_field_name_to_id("customfield_10006")
        assert result == "customfield_10006"

        # System field ID
        result = await discovery.normalize_field_name_to_id("summary")
        assert result == "summary"

    @pytest.mark.asyncio
    async def test_normalize_field_name_to_id(self, mock_api_request_fields):
        """Test converting field name to ID."""
        discovery = FieldDiscovery()

        result = await discovery.normalize_field_name_to_id("Epic Link")

        assert result == "customfield_10006"

    @pytest.mark.asyncio
    async def test_normalize_unknown_field(self, mock_api_request_fields):
        """Test normalizing unknown field name."""
        discovery = FieldDiscovery()

        result = await discovery.normalize_field_name_to_id("Unknown Field")

        assert result is None


class TestGetFieldType:
    """Tests for getting field type."""

    @pytest.mark.asyncio
    async def test_get_field_type_string(self, mock_api_request_fields):
        """Test getting string field type."""
        discovery = FieldDiscovery()

        field_type = await discovery.get_field_type("summary")

        assert field_type == "string"

    @pytest.mark.asyncio
    async def test_get_field_type_number(self, mock_api_request_fields):
        """Test getting number field type."""
        discovery = FieldDiscovery()

        field_type = await discovery.get_field_type("customfield_10016")  # Story Points

        assert field_type == "number"

    @pytest.mark.asyncio
    async def test_get_field_type_user(self, mock_api_request_fields):
        """Test getting user field type."""
        discovery = FieldDiscovery()

        field_type = await discovery.get_field_type("assignee")

        assert field_type == "user"

    @pytest.mark.asyncio
    async def test_get_field_type_not_found(self, mock_api_request_fields):
        """Test getting type for non-existent field."""
        discovery = FieldDiscovery()

        field_type = await discovery.get_field_type("nonexistent")

        assert field_type is None


class TestSuggestSimilarFields:
    """Tests for field name suggestions."""

    @pytest.mark.asyncio
    async def test_suggest_similar_fields(self, mock_api_request_fields):
        """Test suggesting similar field names."""
        discovery = FieldDiscovery()

        suggestions = await discovery.suggest_similar_fields("Epic", limit=3)

        assert len(suggestions) <= 3
        # Should find "Epic Link" and "Epic Name"
        assert any("Epic Link" in s for s in suggestions)
        assert any("Epic Name" in s for s in suggestions)

    @pytest.mark.asyncio
    async def test_suggest_no_matches(self, mock_api_request_fields):
        """Test suggesting when no matches found."""
        discovery = FieldDiscovery()

        suggestions = await discovery.suggest_similar_fields("xyz123", limit=5)

        assert len(suggestions) == 0


class TestGetFieldDiscovery:
    """Tests for get_field_discovery singleton."""

    def test_singleton_pattern(self):
        """Test that get_field_discovery returns same instance."""
        discovery1 = get_field_discovery()
        discovery2 = get_field_discovery()

        assert discovery1 is discovery2

    def test_returns_field_discovery_instance(self):
        """Test that singleton returns FieldDiscovery instance."""
        discovery = get_field_discovery()

        assert isinstance(discovery, FieldDiscovery)


class TestGetCustomFields:
    """Tests for getting custom fields."""

    @pytest.mark.asyncio
    async def test_get_custom_fields(self, mock_api_request_fields):
        """Test retrieving only custom fields."""
        discovery = FieldDiscovery()

        custom_fields = await discovery.get_custom_fields()

        # Should only return custom fields
        assert all(f.get("custom") is True for f in custom_fields)
        assert len(custom_fields) == 3  # Epic Link, Epic Name, Story Points


class TestGetCachedFieldCount:
    """Tests for cache field count."""

    @pytest.mark.asyncio
    async def test_get_cached_field_count_empty(self):
        """Test count when cache is empty."""
        discovery = FieldDiscovery()

        count = discovery.get_cached_field_count()

        assert count == 0

    @pytest.mark.asyncio
    async def test_get_cached_field_count_populated(self, mock_api_request_fields):
        """Test count after caching fields."""
        discovery = FieldDiscovery()

        await discovery._fetch_fields()
        count = discovery.get_cached_field_count()

        assert count == 8  # Number of fields in mock

