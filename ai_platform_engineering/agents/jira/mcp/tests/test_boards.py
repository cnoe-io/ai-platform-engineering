"""Unit tests for Jira boards MCP tools."""

import pytest
from unittest.mock import AsyncMock


class TestGetAllBoards:
    """Tests for get_all_boards function."""

    @pytest.mark.asyncio
    async def test_get_all_boards_success(self, monkeypatch):
        """Test getting all boards."""
        mock_response = {
            "values": [
                {
                    "id": 1,
                    "self": "https://jira.example.com/rest/agile/1.0/board/1",
                    "name": "Board 1",
                    "type": "scrum"
                },
                {
                    "id": 2,
                    "self": "https://jira.example.com/rest/agile/1.0/board/2",
                    "name": "Board 2",
                    "type": "kanban"
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_all_boards

        result = await get_all_boards()

        assert "Found 2 boards" in result
        assert "Board 1" in result
        assert "Board 2" in result
        assert "scrum" in result
        assert "kanban" in result

    @pytest.mark.asyncio
    async def test_get_all_boards_with_filters(self, monkeypatch):
        """Test getting boards with filters."""
        mock_response = {
            "values": [
                {
                    "id": 1,
                    "name": "Scrum Board",
                    "type": "scrum",
                    "location": {
                        "projectKey": "PROJ"
                    }
                }
            ],
            "total": 1
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_all_boards

        result = await get_all_boards(board_type="scrum", project_key="PROJ")

        assert "Scrum Board" in result

    @pytest.mark.asyncio
    async def test_get_all_boards_no_boards(self, monkeypatch):
        """Test getting boards when none exist."""
        async def mock_request(path, method="GET", **kwargs):
            return (True, {"values": [], "total": 0})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_all_boards

        result = await get_all_boards()

        assert "No boards found" in result or "0 boards" in result


class TestCreateBoard:
    """Tests for create_board function."""

    @pytest.mark.asyncio
    async def test_create_board_success(self, monkeypatch):
        """Test creating a board."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": 3,
            "self": "https://jira.example.com/rest/agile/1.0/board/3",
            "name": "New Board",
            "type": "scrum"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import create_board

        result = await create_board("New Board", "scrum", filter_id=10000)

        assert "Board created successfully" in result or "New Board" in result
        assert "3" in result

    @pytest.mark.asyncio
    async def test_create_board_read_only(self, monkeypatch):
        """Test that create_board respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.boards import create_board

        with pytest.raises(ValueError, match="read-only"):
            await create_board("New Board", "scrum", filter_id=10000)


class TestGetBoard:
    """Tests for get_board function."""

    @pytest.mark.asyncio
    async def test_get_board_success(self, monkeypatch):
        """Test getting board details."""
        mock_board = {
            "id": 1,
            "self": "https://jira.example.com/rest/agile/1.0/board/1",
            "name": "Team Board",
            "type": "scrum",
            "location": {
                "projectKey": "PROJ",
                "displayName": "Project Name"
            }
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_board)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board

        result = await get_board(1)

        assert "Team Board" in result
        assert "scrum" in result
        assert "PROJ" in result

    @pytest.mark.asyncio
    async def test_get_board_not_found(self, monkeypatch):
        """Test getting non-existent board."""
        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Board not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board

        result = await get_board(999)

        assert "Error" in result or "not found" in result.lower()


class TestDeleteBoard:
    """Tests for delete_board function."""

    @pytest.mark.asyncio
    async def test_delete_board_success(self, monkeypatch):
        """Test deleting a board."""
        # Disable delete protection
        monkeypatch.setenv("MCP_JIRA_BOARDS_DELETE_PROTECTION", "false")

        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import delete_board

        result = await delete_board(1)

        assert "Board deleted successfully" in result or "deleted" in result.lower()

    @pytest.mark.asyncio
    async def test_delete_board_protection_enabled(self, monkeypatch):
        """Test that board deletion is protected by default."""
        monkeypatch.setenv("MCP_JIRA_BOARDS_DELETE_PROTECTION", "true")

        # Reload module to pick up env var
        import importlib
        from mcp_jira.tools.jira import constants
        importlib.reload(constants)

        def mock_check_read_only():
            return None

        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.boards import delete_board

        result = await delete_board(1)

        assert "protected" in result.lower() or "disabled" in result.lower()


class TestGetBoardConfiguration:
    """Tests for get_board_configuration function."""

    @pytest.mark.asyncio
    async def test_get_board_configuration_success(self, monkeypatch):
        """Test getting board configuration."""
        mock_config = {
            "id": 1,
            "name": "Board 1",
            "type": "scrum",
            "filter": {
                "id": "10000",
                "self": "https://jira.example.com/rest/api/3/filter/10000"
            },
            "columnConfig": {
                "columns": [
                    {"name": "To Do"},
                    {"name": "In Progress"},
                    {"name": "Done"}
                ]
            }
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_config)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board_configuration

        result = await get_board_configuration(1)

        assert "Board 1" in result
        assert "To Do" in result
        assert "In Progress" in result
        assert "Done" in result


class TestGetBoardIssues:
    """Tests for get_board_issues function."""

    @pytest.mark.asyncio
    async def test_get_board_issues_success(self, monkeypatch):
        """Test getting board issues."""
        mock_response = {
            "issues": [
                {
                    "key": "PROJ-1",
                    "fields": {
                        "summary": "Issue 1",
                        "status": {"name": "To Do"},
                        "issuetype": {"name": "Story"}
                    }
                },
                {
                    "key": "PROJ-2",
                    "fields": {
                        "summary": "Issue 2",
                        "status": {"name": "In Progress"},
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

        from mcp_jira.tools.jira.boards import get_board_issues

        result = await get_board_issues(1)

        assert "2 issues" in result or "PROJ-1" in result
        assert "Issue 1" in result
        assert "Issue 2" in result


class TestGetBoardSprints:
    """Tests for get_board_sprints function."""

    @pytest.mark.asyncio
    async def test_get_board_sprints_success(self, monkeypatch):
        """Test getting board sprints."""
        mock_response = {
            "values": [
                {
                    "id": 1,
                    "name": "Sprint 1",
                    "state": "active",
                    "startDate": "2024-01-01T00:00:00.000Z",
                    "endDate": "2024-01-14T23:59:59.999Z"
                },
                {
                    "id": 2,
                    "name": "Sprint 2",
                    "state": "future"
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board_sprints

        result = await get_board_sprints(1)

        assert "2 sprints" in result or "Sprint 1" in result
        assert "Sprint 1" in result
        assert "Sprint 2" in result
        assert "active" in result
        assert "future" in result


class TestGetBoardEpics:
    """Tests for get_board_epics function."""

    @pytest.mark.asyncio
    async def test_get_board_epics_success(self, monkeypatch):
        """Test getting board epics."""
        mock_response = {
            "values": [
                {
                    "id": 100,
                    "key": "PROJ-100",
                    "name": "Epic 1",
                    "summary": "First epic",
                    "done": False
                },
                {
                    "id": 101,
                    "key": "PROJ-101",
                    "name": "Epic 2",
                    "summary": "Second epic",
                    "done": True
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board_epics

        result = await get_board_epics(1)

        assert "2 epics" in result or "PROJ-100" in result
        assert "Epic 1" in result
        assert "Epic 2" in result


class TestGetBoardVersions:
    """Tests for get_board_versions function."""

    @pytest.mark.asyncio
    async def test_get_board_versions_success(self, monkeypatch):
        """Test getting board versions."""
        mock_response = {
            "values": [
                {
                    "id": "10000",
                    "name": "Version 1.0",
                    "released": True
                },
                {
                    "id": "10001",
                    "name": "Version 2.0",
                    "released": False
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board_versions

        result = await get_board_versions(1)

        assert "2 versions" in result or "Version 1.0" in result
        assert "Version 1.0" in result
        assert "Version 2.0" in result


class TestGetBoardProjects:
    """Tests for get_board_projects function."""

    @pytest.mark.asyncio
    async def test_get_board_projects_success(self, monkeypatch):
        """Test getting board projects."""
        mock_response = {
            "values": [
                {
                    "id": "10000",
                    "key": "PROJ",
                    "name": "Project 1",
                    "projectTypeKey": "software"
                },
                {
                    "id": "10001",
                    "key": "PROJ2",
                    "name": "Project 2",
                    "projectTypeKey": "business"
                }
            ],
            "total": 2
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.boards import get_board_projects

        result = await get_board_projects(1)

        assert "2 projects" in result or "PROJ" in result
        assert "Project 1" in result
        assert "Project 2" in result

