"""Unit tests for Jira sprints MCP tools."""

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

        assert "Sprint created successfully" in result or "Sprint 1" in result
        assert "1" in result

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

        assert "Sprint created successfully" in result or "Sprint 2" in result

    @pytest.mark.asyncio
    async def test_create_sprint_read_only(self, monkeypatch):
        """Test that create_sprint respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.sprints import create_sprint

        with pytest.raises(ValueError, match="read-only"):
            await create_sprint("Sprint 1", 1)


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

        assert "Sprint 1" in result
        assert "active" in result
        assert "Complete user stories" in result

    @pytest.mark.asyncio
    async def test_get_sprint_not_found(self, monkeypatch):
        """Test getting non-existent sprint."""
        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Sprint not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import get_sprint

        result = await get_sprint(999)

        assert "Error" in result or "not found" in result.lower()


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

        assert "Sprint updated successfully" in result or "Updated Sprint 1" in result

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

        assert "Sprint updated successfully" in result or "closed" in result


class TestDeleteSprint:
    """Tests for delete_sprint function."""

    @pytest.mark.asyncio
    async def test_delete_sprint_success(self, monkeypatch):
        """Test deleting a sprint."""
        # Mock environment variable to disable delete protection
        monkeypatch.setenv("MCP_JIRA_SPRINTS_DELETE_PROTECTION", "false")

        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import delete_sprint

        result = await delete_sprint(1)

        assert "Sprint deleted successfully" in result or "deleted" in result.lower()

    @pytest.mark.asyncio
    async def test_delete_sprint_protection_enabled(self, monkeypatch):
        """Test that sprint deletion is protected by default."""
        # Ensure protection is enabled
        monkeypatch.setenv("MCP_JIRA_SPRINTS_DELETE_PROTECTION", "true")

        # Reload module to pick up env var
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)

        def mock_check_read_only():
            return None

        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.sprints import delete_sprint

        result = await delete_sprint(1)

        # Should return protection message, not actually delete
        assert "protected" in result.lower() or "disabled" in result.lower()


class TestGetSprintIssues:
    """Tests for get_sprint_issues function."""

    @pytest.mark.asyncio
    async def test_get_sprint_issues_success(self, monkeypatch):
        """Test getting issues in a sprint."""
        mock_response = {
            "issues": [
                {
                    "key": "PROJ-1",
                    "fields": {
                        "summary": "Issue 1",
                        "status": {"name": "In Progress"},
                        "issuetype": {"name": "Story"}
                    }
                },
                {
                    "key": "PROJ-2",
                    "fields": {
                        "summary": "Issue 2",
                        "status": {"name": "Done"},
                        "issuetype": {"name": "Bug"}
                    }
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.sprints import get_sprint_issues

        result = await get_sprint_issues(1)

        assert "2 issues" in result or "PROJ-1" in result
        assert "Issue 1" in result
        assert "Issue 2" in result


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

        assert "Issues moved successfully" in result or "moved" in result.lower()

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

        assert "moved" in result.lower()


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

        assert "Sprint swap completed" in result or "swapped" in result.lower()

