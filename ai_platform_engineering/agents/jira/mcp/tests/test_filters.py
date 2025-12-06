"""Unit tests for Jira filters MCP tools."""

import pytest
from unittest.mock import AsyncMock


class TestCreateFilter:
    """Tests for create_filter function."""

    @pytest.mark.asyncio
    async def test_create_filter_success(self, monkeypatch):
        """Test creating a filter."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "12345",
            "name": "My Filter",
            "jql": "project = SRI ORDER BY Rank",
            "viewUrl": "https://example.atlassian.net/issues/?filter=12345",
            "favourite": False
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import create_filter

        result = await create_filter(
            name="My Filter",
            jql="project = SRI ORDER BY Rank"
        )

        assert "Filter 'My Filter' created successfully" in result or "12345" in result
        assert "SRI" in result

    @pytest.mark.asyncio
    async def test_create_filter_with_description(self, monkeypatch):
        """Test creating a filter with description."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "12346",
            "name": "Board Filter",
            "description": "Filter for Scrum board",
            "jql": "project = PROJ ORDER BY Rank",
            "viewUrl": "https://example.atlassian.net/issues/?filter=12346"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import create_filter

        result = await create_filter(
            name="Board Filter",
            jql="project = PROJ ORDER BY Rank",
            description="Filter for Scrum board"
        )

        assert "12346" in result or "Board Filter" in result

    @pytest.mark.asyncio
    async def test_create_filter_with_share_permissions(self, monkeypatch):
        """Test creating a filter with share permissions."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "12347",
            "name": "Shared Filter",
            "jql": "project = SRI ORDER BY Rank",
            "sharePermissions": [
                {"type": "project", "projectId": "10000"}
            ]
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import create_filter

        result = await create_filter(
            name="Shared Filter",
            jql="project = SRI ORDER BY Rank",
            share_permissions=[{"type": "project", "projectId": "10000"}]
        )

        assert "12347" in result

    @pytest.mark.asyncio
    async def test_create_filter_read_only(self, monkeypatch):
        """Test that create_filter respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.filters import create_filter

        with pytest.raises(ValueError, match="read-only"):
            await create_filter("Test Filter", "project = PROJ ORDER BY Rank")

    @pytest.mark.asyncio
    async def test_create_filter_api_error(self, monkeypatch):
        """Test create_filter with API error."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Invalid JQL query"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import create_filter

        with pytest.raises(ValueError, match="Failed to create filter"):
            await create_filter("Bad Filter", "invalid jql")


class TestGetFilter:
    """Tests for get_filter function."""

    @pytest.mark.asyncio
    async def test_get_filter_success(self, monkeypatch):
        """Test getting a filter."""
        mock_filter = {
            "id": "12345",
            "name": "My Filter",
            "description": "Filter description",
            "jql": "project = SRI ORDER BY Rank",
            "viewUrl": "https://example.atlassian.net/issues/?filter=12345",
            "favourite": True
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_filter)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import get_filter

        result = await get_filter(12345)

        assert "My Filter" in result
        assert "SRI" in result
        assert "12345" in result

    @pytest.mark.asyncio
    async def test_get_filter_not_found(self, monkeypatch):
        """Test getting non-existent filter."""
        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Filter not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import get_filter

        with pytest.raises(ValueError, match="Failed to fetch filter"):
            await get_filter(99999)


class TestSearchFilters:
    """Tests for search_filters function."""

    @pytest.mark.asyncio
    async def test_search_filters_success(self, monkeypatch):
        """Test searching for filters."""
        mock_response = {
            "values": [
                {
                    "id": "12345",
                    "name": "Filter 1",
                    "jql": "project = PROJ ORDER BY Rank"
                },
                {
                    "id": "12346",
                    "name": "Filter 2",
                    "jql": "issuetype = Bug"
                }
            ],
            "total": 2,
            "startAt": 0,
            "maxResults": 50
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import search_filters

        result = await search_filters()

        assert "Filter 1" in result
        assert "Filter 2" in result
        assert "12345" in result

    @pytest.mark.asyncio
    async def test_search_filters_by_name(self, monkeypatch):
        """Test searching filters by name."""
        mock_response = {
            "values": [
                {
                    "id": "12345",
                    "name": "Board Filter",
                    "jql": "project = SRI ORDER BY Rank"
                }
            ],
            "total": 1
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import search_filters

        result = await search_filters(filter_name="Board Filter")

        assert "Board Filter" in result
        assert "12345" in result

    @pytest.mark.asyncio
    async def test_search_filters_no_results(self, monkeypatch):
        """Test searching filters with no results."""
        async def mock_request(path, method="GET", **kwargs):
            return (True, {"values": [], "total": 0})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import search_filters

        result = await search_filters(filter_name="NonExistent")

        assert "values" in result
        assert "0" in result or "[]" in result


class TestUpdateFilter:
    """Tests for update_filter function."""

    @pytest.mark.asyncio
    async def test_update_filter_name(self, monkeypatch):
        """Test updating filter name."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "12345",
            "name": "Updated Filter",
            "jql": "project = SRI ORDER BY Rank"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import update_filter

        result = await update_filter(12345, name="Updated Filter")

        assert "Updated Filter" in result

    @pytest.mark.asyncio
    async def test_update_filter_jql(self, monkeypatch):
        """Test updating filter JQL."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "12345",
            "name": "My Filter",
            "jql": "project = PROJ AND issuetype = Bug ORDER BY Rank"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import update_filter

        result = await update_filter(
            12345,
            jql="project = PROJ AND issuetype = Bug ORDER BY Rank"
        )

        assert "Bug" in result

    @pytest.mark.asyncio
    async def test_update_filter_no_fields(self, monkeypatch):
        """Test updating filter with no fields."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.filters import update_filter

        result = await update_filter(12345)

        assert "No fields provided to update" in result or "error" in result.lower()


class TestDeleteFilter:
    """Tests for delete_filter function."""

    @pytest.mark.asyncio
    async def test_delete_filter_success(self, monkeypatch):
        """Test deleting a filter."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import delete_filter

        result = await delete_filter(12345)

        assert "Filter 12345 deleted successfully" in result or "deleted" in result.lower()

    @pytest.mark.asyncio
    async def test_delete_filter_read_only(self, monkeypatch):
        """Test that delete_filter respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.filters import delete_filter

        with pytest.raises(ValueError, match="read-only"):
            await delete_filter(12345)

    @pytest.mark.asyncio
    async def test_delete_filter_not_found(self, monkeypatch):
        """Test deleting non-existent filter."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Filter not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import delete_filter

        with pytest.raises(ValueError, match="Failed to delete filter"):
            await delete_filter(99999)


class TestFilterOrderByRank:
    """Tests for ORDER BY Rank validation in filters."""

    @pytest.mark.asyncio
    async def test_filter_with_order_by_rank(self, monkeypatch):
        """Test that filters for boards include ORDER BY Rank."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "12348",
            "name": "Board Filter",
            "jql": "project = SRI ORDER BY Rank"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.filters import create_filter

        result = await create_filter(
            name="Board Filter",
            jql="project = SRI ORDER BY Rank"
        )

        assert "ORDER BY Rank" in result or "Rank" in result
        assert "12348" in result

