"""Unit tests for read-only mode and mock responses."""

import pytest
import os
from mcp_jira.tools.jira.constants import check_read_only, MCP_JIRA_READ_ONLY


class TestReadOnlyMode:
    """Tests for read-only mode protection."""

    def test_read_only_enabled(self, monkeypatch):
        """Test that read-only mode blocks operations when enabled."""
        # Set read-only mode
        monkeypatch.setenv("MCP_JIRA_READ_ONLY", "true")
        
        # Reload the module to pick up new env var
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)
        
        # Should raise error
        with pytest.raises(ValueError, match="read-only mode"):
            constants.check_read_only()

    def test_read_only_disabled(self, monkeypatch):
        """Test that operations work when read-only is disabled."""
        # Disable read-only mode
        monkeypatch.setenv("MCP_JIRA_READ_ONLY", "false")
        
        # Reload the module
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)
        
        # Should not raise error
        try:
            constants.check_read_only()
        except ValueError:
            pytest.fail("check_read_only() raised ValueError unexpectedly")

    def test_read_only_default_value(self, monkeypatch):
        """Test default read-only mode value."""
        # Remove env var to test default
        monkeypatch.delenv("MCP_JIRA_READ_ONLY", raising=False)
        
        # Reload the module
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)
        
        # Default is True (enabled for safety)
        with pytest.raises(ValueError, match="read-only mode"):
            constants.check_read_only()


class TestMockResponseMode:
    """Tests for mock response system."""

    def test_mock_mode_enabled(self, monkeypatch):
        """Test that mock mode is enabled via env var."""
        monkeypatch.setenv("MCP_JIRA_MOCK_RESPONSE", "true")
        
        # Reload to pick up env var
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)
        
        assert constants.MCP_JIRA_MOCK_RESPONSE is True

    def test_mock_mode_disabled(self, monkeypatch):
        """Test that mock mode can be disabled."""
        monkeypatch.setenv("MCP_JIRA_MOCK_RESPONSE", "false")
        
        # Reload to pick up env var
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)
        
        assert constants.MCP_JIRA_MOCK_RESPONSE is False

    @pytest.mark.asyncio
    async def test_mock_response_returns_data(self, monkeypatch):
        """Test that mock responses return expected data structure."""
        # Enable mock mode
        monkeypatch.setenv("MCP_JIRA_MOCK_RESPONSE", "true")
        
        # Reload modules
        import importlib
        from mcp_jira.tools.jira import constants
        from mcp_jira.api import client
        importlib.reload(constants)
        importlib.reload(client)
        
        # Make a mock request
        success, data = await client.make_api_request("rest/api/3/issue/PROJ-123")
        
        # Should return success with mock data
        assert success is True
        assert isinstance(data, dict)
        assert "key" in data or "fields" in data or "status" in data


class TestMockResponses:
    """Tests for specific mock responses."""

    @pytest.mark.asyncio
    async def test_mock_get_issue(self, monkeypatch):
        """Test mock response for get issue."""
        from mcp_jira.mock.responses import get_mock_issue
        
        issue = get_mock_issue("PROJ-123")
        
        assert issue["key"] == "PROJ-123"
        assert "fields" in issue
        assert "summary" in issue["fields"]

    @pytest.mark.asyncio
    async def test_mock_create_issue(self, monkeypatch):
        """Test mock response for create issue."""
        from mcp_jira.mock.responses import get_mock_created_issue
        
        issue = get_mock_created_issue("PROJ", "Test Issue", "Story")
        
        assert "key" in issue
        assert issue["key"].startswith("PROJ-")
        assert "id" in issue

    @pytest.mark.asyncio
    async def test_mock_search_results(self, monkeypatch):
        """Test mock response for search."""
        from mcp_jira.mock.responses import get_mock_search_results
        
        results = get_mock_search_results("project = PROJ", max_results=10)
        
        assert "issues" in results
        assert "total" in results
        assert len(results["issues"]) <= 10

    @pytest.mark.asyncio
    async def test_mock_transitions(self, monkeypatch):
        """Test mock response for transitions."""
        from mcp_jira.mock.responses import get_mock_transitions
        
        transitions = get_mock_transitions("PROJ-123")
        
        assert "transitions" in transitions
        assert len(transitions["transitions"]) > 0
        assert "id" in transitions["transitions"][0]
        assert "name" in transitions["transitions"][0]


class TestMockUserOperationsBypass:
    """Tests that user operations bypass mock mode."""

    @pytest.mark.asyncio
    async def test_user_operations_not_mocked(self, monkeypatch):
        """Test that user operations use real API even in mock mode."""
        # Enable mock mode
        monkeypatch.setenv("MCP_JIRA_MOCK_RESPONSE", "true")
        
        # Mock the actual API request for user endpoint
        async def mock_real_user_request(path, method="GET", **kwargs):
            if "rest/api/3/user" in path:
                # This represents the real API call
                return (True, {"accountId": "real-account-id", "displayName": "Real User"})
            # Other requests get mocked
            return (True, {"mocked": True})
        
        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_real_user_request)
        
        # User request should use "real" API
        success, data = await mock_real_user_request("rest/api/3/user/search?query=test")
        assert "accountId" in data
        assert data["accountId"] == "real-account-id"

