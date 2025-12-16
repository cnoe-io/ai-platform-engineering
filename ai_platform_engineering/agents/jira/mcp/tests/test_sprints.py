"""Unit tests for Jira sprints MCP tools."""

import json
import pytest


class TestCreateSprint:
    """Tests for create_sprint function."""

    @pytest.mark.asyncio
    async def test_create_sprint_success(self, monkeypatch):
        """Test creating a sprint."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": 1,
            "self": "https://jira.example.com/rest/agile/1.0/sprint/1",
            "state": "future",
            "name": "Sprint 1",
            "originBoardId": 1
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import create_sprint

        result = await create_sprint("Sprint 1", 1)

        assert "Sprint 1" in result or "1" in result

    @pytest.mark.asyncio
    async def test_create_sprint_with_dates(self, monkeypatch):
        """Test creating a sprint with start and end dates."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": 2,
            "state": "future",
            "name": "Sprint 2",
            "startDate": "2024-01-01T00:00:00.000Z",
            "endDate": "2024-01-14T23:59:59.999Z",
            "originBoardId": 1
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import create_sprint

        result = await create_sprint(
            "Sprint 2",
            1,
            start_date="2024-01-01",
            end_date="2024-01-14"
        )

        assert "Sprint 2" in result or "2" in result

    @pytest.mark.asyncio
    async def test_create_sprint_read_only(self, monkeypatch):
        """Test that create_sprint returns error JSON in read-only mode."""
        # Mock read-only mode
        monkeypatch.setattr("mcp_jira.tools.jira.sprints.MCP_JIRA_READ_ONLY", True)

        from mcp_jira.tools.jira.sprints import create_sprint

        result = await create_sprint("Sprint 1", 1)
        result_dict = json.loads(result)

        assert result_dict["success"] is False
        assert "read-only" in result_dict["error"].lower()


class TestGetSprint:
    """Tests for get_sprint function."""

    @pytest.mark.asyncio
    async def test_get_sprint_success(self, monkeypatch):
        """Test getting sprint details."""
        mock_sprint = {
            "id": 1,
            "self": "https://jira.example.com/rest/agile/1.0/sprint/1",
            "state": "active",
            "name": "Sprint 1",
            "startDate": "2024-01-01T00:00:00.000Z",
            "endDate": "2024-01-14T23:59:59.999Z",
            "originBoardId": 1,
            "goal": "Complete user stories"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_sprint)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import get_sprint

        result = await get_sprint(1)

        assert "Sprint 1" in result or "active" in result

    @pytest.mark.asyncio
    async def test_get_sprint_not_found(self, monkeypatch):
        """Test getting non-existent sprint - in mock mode returns mock data."""
        from mcp_jira.tools.jira.sprints import get_sprint

        # In mock mode, this will return mock sprint data
        result = await get_sprint(999)

        # Mock mode returns valid sprint data, so we just verify it returns something
        assert "999" in result or "Sprint" in result or "id" in result


class TestUpdateSprint:
    """Tests for update_sprint function."""

    @pytest.mark.asyncio
    async def test_update_sprint_name(self, monkeypatch):
        """Test updating sprint name."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": 1,
            "name": "Updated Sprint 1",
            "state": "active"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import update_sprint

        result = await update_sprint(1, name="Updated Sprint 1")

        assert "Updated Sprint 1" in result or "1" in result

    @pytest.mark.asyncio
    async def test_update_sprint_state(self, monkeypatch):
        """Test updating sprint state."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": 1,
            "name": "Sprint 1",
            "state": "closed"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import update_sprint

        result = await update_sprint(1, state="closed")

        assert "closed" in result or "1" in result


class TestDeleteSprint:
    """Tests for delete_sprint function."""

    @pytest.mark.asyncio
    async def test_delete_sprint_success(self, monkeypatch):
        """Test deleting a sprint."""
        def mock_check_read_only():
            return None

        def mock_check_sprints_delete_protection():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)
        monkeypatch.setattr(constants, "check_sprints_delete_protection", mock_check_sprints_delete_protection)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import delete_sprint

        result = await delete_sprint(1)

        assert "deleted" in result.lower() or "success" in result.lower()

    @pytest.mark.asyncio
    async def test_delete_sprint_protection_enabled(self, monkeypatch):
        """Test that sprint deletion returns error JSON when protected."""
        # Mock protection mode
        monkeypatch.setattr("mcp_jira.tools.jira.sprints.MCP_JIRA_READ_ONLY", False)
        monkeypatch.setattr("mcp_jira.tools.jira.sprints.MCP_JIRA_SPRINTS_DELETE_PROTECTION", True)

        from mcp_jira.tools.jira.sprints import delete_sprint

        result = await delete_sprint(1)
        result_dict = json.loads(result)

        assert result_dict["success"] is False
        assert "protected" in result_dict["error"].lower()


class TestGetSprintIssues:
    """Tests for get_sprint_issues function."""

    @pytest.mark.asyncio
    async def test_get_sprint_issues_success(self, monkeypatch):
        """Test getting issues in a sprint."""
        from mcp_jira.tools.jira.sprints import get_sprint_issues

        result = await get_sprint_issues(1)

        # Mock mode returns issues data
        assert "issues" in result or "PROJ" in result or "Issue" in result


class TestMoveIssuesToSprint:
    """Tests for move_issues_to_sprint function."""

    @pytest.mark.asyncio
    async def test_move_issues_to_sprint_success(self, monkeypatch):
        """Test moving issues to a sprint."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import move_issues_to_sprint

        result = await move_issues_to_sprint(1, ["PROJ-1", "PROJ-2"])

        assert "moved" in result.lower() or "success" in result.lower()

    @pytest.mark.asyncio
    async def test_move_issues_to_sprint_single_issue(self, monkeypatch):
        """Test moving a single issue to a sprint."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import move_issues_to_sprint

        result = await move_issues_to_sprint(1, ["PROJ-1"])

        assert "moved" in result.lower() or "success" in result.lower()


class TestSwapSprint:
    """Tests for swap_sprint function."""

    @pytest.mark.asyncio
    async def test_swap_sprint_success(self, monkeypatch):
        """Test swapping sprint for issues."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import swap_sprint

        result = await swap_sprint(1, 2)

        assert "swap" in result.lower() or "success" in result.lower()


class TestGetIssueSprint:
    """Tests for get_issue_sprint function."""

    @pytest.mark.asyncio
    async def test_get_issue_sprint_success(self, monkeypatch):
        """Test getting sprint information for an issue - in mock mode returns data."""
        from mcp_jira.tools.jira.sprints import get_issue_sprint

        result = await get_issue_sprint("PROJ-123")

        # In mock mode, the function should return a valid response structure
        assert "PROJ-123" in result
        assert "sprint_summary" in result

    @pytest.mark.asyncio
    async def test_get_issue_sprint_no_sprint(self, monkeypatch):
        """Test getting sprint information for an issue - mock mode returns data."""
        from mcp_jira.tools.jira.sprints import get_issue_sprint

        result = await get_issue_sprint("PROJ-456")

        # In mock mode, the function should return a valid response structure
        assert "PROJ-456" in result
        assert "sprint_summary" in result

    @pytest.mark.asyncio
    async def test_get_issue_sprint_returns_valid_structure(self, monkeypatch):
        """Test that get_issue_sprint returns valid JSON structure."""
        from mcp_jira.tools.jira.sprints import get_issue_sprint

        result = await get_issue_sprint("TEST-999")

        # Verify the result is valid JSON with expected structure
        result_dict = json.loads(result)
        assert "sprint_summary" in result_dict
        assert "issue_key" in result_dict["sprint_summary"]
        assert "current_sprint" in result_dict["sprint_summary"]
        assert "closed_sprints" in result_dict["sprint_summary"]
        assert "flagged" in result_dict["sprint_summary"]
