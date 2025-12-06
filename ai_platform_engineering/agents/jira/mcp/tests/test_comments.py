"""Unit tests for Jira comments MCP tools."""

import pytest


class TestGetComments:
    """Tests for get_comments function."""

    @pytest.mark.asyncio
    async def test_get_comments_success(self, monkeypatch):
        """Test getting comments for an issue."""
        mock_response = {
            "comments": [
                {
                    "id": "10000",
                    "body": {
                        "type": "doc",
                        "version": 1,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "First comment"}]
                            }
                        ]
                    },
                    "author": {"displayName": "John Doe"},
                    "created": "2024-01-01T12:00:00.000Z"
                },
                {
                    "id": "10001",
                    "body": {
                        "type": "doc",
                        "version": 1,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "Second comment"}]
                            }
                        ]
                    },
                    "author": {"displayName": "Jane Smith"},
                    "created": "2024-01-02T12:00:00.000Z"
                }
            ]
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import get_comments

        result = await get_comments("PROJ-123")

        assert "Found 2 comments" in result
        assert "First comment" in result
        assert "Second comment" in result
        assert "John Doe" in result
        assert "Jane Smith" in result

    @pytest.mark.asyncio
    async def test_get_comments_no_comments(self, monkeypatch):
        """Test getting comments when none exist."""
        async def mock_request(path, method="GET", **kwargs):
            return (True, {"comments": []})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import get_comments

        result = await get_comments("PROJ-123")

        assert "No comments found" in result

    @pytest.mark.asyncio
    async def test_get_comments_api_error(self, monkeypatch):
        """Test get_comments with API error."""
        async def mock_request(path, method="GET", **kwargs):
            return (False, {"errorMessages": ["Issue not found"]})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import get_comments

        result = await get_comments("INVALID-123")

        assert "Error" in result or "error" in result.lower()


class TestGetComment:
    """Tests for get_comment function."""

    @pytest.mark.asyncio
    async def test_get_comment_success(self, monkeypatch):
        """Test getting a specific comment."""
        mock_comment = {
            "id": "10000",
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Specific comment"}]
                    }
                ]
            },
            "author": {"displayName": "Test User"},
            "created": "2024-01-01T12:00:00.000Z",
            "updated": "2024-01-01T13:00:00.000Z"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_comment)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import get_comment

        result = await get_comment("PROJ-123", "10000")

        assert "Comment ID: 10000" in result
        assert "Specific comment" in result
        assert "Test User" in result


class TestAddComment:
    """Tests for add_comment function."""

    @pytest.mark.asyncio
    async def test_add_comment_success(self, monkeypatch):
        """Test adding a comment."""
        # Mock check_read_only to allow operations
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "10002",
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "New comment"}]
                    }
                ]
            },
            "author": {"displayName": "Current User"},
            "created": "2024-01-03T12:00:00.000Z"
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import add_comment

        result = await add_comment("PROJ-123", "New comment")

        assert "Comment added successfully" in result or "10002" in result

    @pytest.mark.asyncio
    async def test_add_comment_read_only(self, monkeypatch):
        """Test that add_comment respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.comments import add_comment

        with pytest.raises(ValueError, match="read-only"):
            await add_comment("PROJ-123", "Test comment")


class TestUpdateComment:
    """Tests for update_comment function."""

    @pytest.mark.asyncio
    async def test_update_comment_success(self, monkeypatch):
        """Test updating a comment."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        mock_response = {
            "id": "10000",
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Updated comment"}]
                    }
                ]
            }
        }

        async def mock_request(path, method="GET", **kwargs):
            return (True, mock_response)

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import update_comment

        result = await update_comment("PROJ-123", "10000", "Updated comment")

        assert "Comment updated successfully" in result or "Updated" in result


class TestDeleteComment:
    """Tests for delete_comment function."""

    @pytest.mark.asyncio
    async def test_delete_comment_success(self, monkeypatch):
        """Test deleting a comment."""
        def mock_check_read_only():
            return None

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        async def mock_request(path, method="GET", **kwargs):
            return (True, {})

        from mcp_jira.api import client
        monkeypatch.setattr(client, "make_api_request", mock_request)

        from mcp_jira.tools.jira.comments import delete_comment

        result = await delete_comment("PROJ-123", "10000")

        assert "Comment deleted successfully" in result or "deleted" in result.lower()

    @pytest.mark.asyncio
    async def test_delete_comment_read_only(self, monkeypatch):
        """Test that delete_comment respects read-only mode."""
        def mock_check_read_only():
            raise ValueError("Jira MCP is in read-only mode")

        from mcp_jira.tools.jira import constants
        monkeypatch.setattr(constants, "check_read_only", mock_check_read_only)

        from mcp_jira.tools.jira.comments import delete_comment

        with pytest.raises(ValueError, match="read-only"):
            await delete_comment("PROJ-123", "10000")

