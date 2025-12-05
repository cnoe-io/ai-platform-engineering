"""Unit tests for Jira backlogs MCP tools."""

import pytest
from unittest.mock import AsyncMock


class TestGetBacklogIssues:
    """Tests for get_backlog_issues function."""

    @pytest.mark.asyncio
    async def test_get_backlog_issues_success(self, monkeypatch):
        """Test getting backlog issues."""
        mock_response = {
            "issues": [
                {
                    "key": "PROJ-1",
                    "fields": {
                        "summary": "Backlog Issue 1",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Story"},
                        "priority": {"name": "High"}
                    }
                },
                {
                    "key": "PROJ-2",
                    "fields": {
                        "summary": "Backlog Issue 2",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Task"},
                        "priority": {"name": "Medium"}
                    }
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_backlog_issues

        result = await get_backlog_issues(1)

        assert "2 issues" in result or "PROJ-1" in result
        assert "Backlog Issue 1" in result
        assert "Backlog Issue 2" in result

    @pytest.mark.asyncio
    async def test_get_backlog_issues_empty(self, monkeypatch):
        """Test getting backlog issues when none exist."""
        async def mock_request(path, method="GET", **kwargs):
            return (True, {"issues": [], "total": 0})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_backlog_issues

        result = await get_backlog_issues(1)

        assert "No backlog issues found" in result or "0 issues" in result

    @pytest.mark.asyncio
    async def test_get_backlog_issues_with_pagination(self, monkeypatch):
        """Test getting backlog issues with pagination."""
        mock_response = {
            "issues": [
                {
                    "key": f"PROJ-{i}",
                    "fields": {
                        "summary": f"Issue {i}",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Story"}
                    }
                }
                for i in range(1, 11)
            ],
            "total": 100
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_backlog_issues

        result = await get_backlog_issues(1, start_at=0, max_results=10)

        assert "10 issues" in result or "PROJ-1" in result


class TestMoveIssuesToBacklog:
    """Tests for move_issues_to_backlog function."""

    @pytest.mark.asyncio
    async def test_move_issues_to_backlog_success(self, monkeypatch):
        """Test moving issues to backlog."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import move_issues_to_backlog

        result = await move_issues_to_backlog(["PROJ-1", "PROJ-2"])

        assert "Issues moved to backlog successfully" in result or "moved" in result.lower()

    @pytest.mark.asyncio
    async def test_move_issues_to_backlog_single_issue(self, monkeypatch):
        """Test moving a single issue to backlog."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import move_issues_to_backlog

        result = await move_issues_to_backlog(["PROJ-1"])

        assert "moved" in result.lower()

    @pytest.mark.asyncio
    async def test_move_issues_to_backlog_read_only(self, monkeypatch):
        """Test that move_issues_to_backlog respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.backlogs import move_issues_to_backlog

        with pytest.raises(ValueError, match="read-only"):
            await move_issues_to_backlog(["PROJ-1"])


class TestMoveIssuesToBacklogForBoard:
    """Tests for move_issues_to_backlog_for_board function."""

    @pytest.mark.asyncio
    async def test_move_issues_to_backlog_for_board_success(self, monkeypatch):
        """Test moving issues to backlog for a specific board."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import move_issues_to_backlog_for_board

        result = await move_issues_to_backlog_for_board(1, ["PROJ-1", "PROJ-2"])

        assert "Issues moved to backlog successfully" in result or "moved" in result.lower()

    @pytest.mark.asyncio
    async def test_move_issues_to_backlog_for_board_with_rank(self, monkeypatch):
        """Test moving issues to backlog with rank before."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import move_issues_to_backlog_for_board

        result = await move_issues_to_backlog_for_board(
            1,
            ["PROJ-1"],
            rank_before_issue="PROJ-5"
        )

        assert "moved" in result.lower()


class TestGetIssuesWithoutEpic:
    """Tests for get_issues_without_epic function."""

    @pytest.mark.asyncio
    async def test_get_issues_without_epic_success(self, monkeypatch):
        """Test getting issues without epic."""
        mock_response = {
            "issues": [
                {
                    "key": "PROJ-1",
                    "fields": {
                        "summary": "Issue without epic 1",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Story"}
                    }
                },
                {
                    "key": "PROJ-2",
                    "fields": {
                        "summary": "Issue without epic 2",
                        "status": {"name": "In Progress"},
                        "issuetype": {"name": "Task"}
                    }
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_issues_without_epic

        result = await get_issues_without_epic(1)

        assert "2 issues without epic" in result or "PROJ-1" in result
        assert "Issue without epic 1" in result
        assert "Issue without epic 2" in result

    @pytest.mark.asyncio
    async def test_get_issues_without_epic_none_found(self, monkeypatch):
        """Test when all issues have epics."""
        async def mock_request(path, method="GET", **kwargs):
            return (True, {"issues": [], "total": 0})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_issues_without_epic

        result = await get_issues_without_epic(1)

        assert "No issues without epic" in result or "0 issues" in result


class TestGetBoardIssuesForEpic:
    """Tests for get_board_issues_for_epic function."""

    @pytest.mark.asyncio
    async def test_get_board_issues_for_epic_success(self, monkeypatch):
        """Test getting issues for an epic."""
        mock_response = {
            "issues": [
                {
                    "key": "PROJ-10",
                    "fields": {
                        "summary": "Epic issue 1",
                        "status": {"name": "In Progress"},
                        "issuetype": {"name": "Story"}
                    }
                },
                {
                    "key": "PROJ-11",
                    "fields": {
                        "summary": "Epic issue 2",
                        "status": {"name": "Done"},
                        "issuetype": {"name": "Task"}
                    }
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_board_issues_for_epic

        result = await get_board_issues_for_epic(1, 100)

        assert "2 issues for epic" in result or "PROJ-10" in result
        assert "Epic issue 1" in result
        assert "Epic issue 2" in result

    @pytest.mark.asyncio
    async def test_get_board_issues_for_epic_no_issues(self, monkeypatch):
        """Test getting issues for epic with no issues."""
        async def mock_request(path, method="GET", **kwargs):
            return (True, {"issues": [], "total": 0})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_board_issues_for_epic

        result = await get_board_issues_for_epic(1, 100)

        assert "No issues found for epic" in result or "0 issues" in result

    @pytest.mark.asyncio
    async def test_get_board_issues_for_epic_with_filters(self, monkeypatch):
        """Test getting epic issues with filters."""
        mock_response = {
            "issues": [
                {
                    "key": "PROJ-10",
                    "fields": {
                        "summary": "Filtered issue",
                        "status": {"name": "Done"},
                        "issuetype": {"name": "Story"}
                    }
                }
            ],
            "total": 1
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_board_issues_for_epic

        result = await get_board_issues_for_epic(
            1,
            100,
            done_issues=True,
            start_at=0,
            max_results=50
        )

        assert "Filtered issue" in result


class TestBacklogApiErrors:
    """Tests for API error handling in backlog tools."""

    @pytest.mark.asyncio
    async def test_get_backlog_issues_api_error(self, monkeypatch):
        """Test backlog issues with API error."""
        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Board not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import get_backlog_issues

        result = await get_backlog_issues(999)

        assert "Error" in result or "error" in result.lower()

    @pytest.mark.asyncio
    async def test_move_issues_api_error(self, monkeypatch):
        """Test move issues with API error."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Issues not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.backlogs import move_issues_to_backlog

        result = await move_issues_to_backlog(["INVALID-1"])

        assert "Error" in result or "error" in result.lower()

