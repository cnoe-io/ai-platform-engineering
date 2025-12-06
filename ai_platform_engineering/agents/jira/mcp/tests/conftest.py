"""Shared pytest fixtures for Jira MCP tests."""

import os
import pytest


@pytest.fixture(autouse=True)
def enable_mock_mode(monkeypatch):
    """Enable mock mode for all tests by default."""
    monkeypatch.setenv("MCP_JIRA_MOCK_RESPONSE", "true")
    monkeypatch.setenv("MCP_JIRA_READ_ONLY", "false")
    monkeypatch.setenv("MCP_JIRA_ISSUES_DELETE_PROTECTION", "false")
    monkeypatch.setenv("MCP_JIRA_SPRINTS_DELETE_PROTECTION", "false")
    monkeypatch.setenv("MCP_JIRA_BOARDS_DELETE_PROTECTION", "false")
    
    # Reload the config module to pick up the new env vars
    import importlib
    from mcp_jira import config
    importlib.reload(config)
    
    # Update constants that import from config
    from mcp_jira.tools.jira import constants
    importlib.reload(constants)


@pytest.fixture
def mock_jira_fields():
    """Mock Jira field metadata response."""
    return [
        {
            "id": "summary",
            "name": "Summary",
            "custom": False,
            "schema": {"type": "string", "system": "summary"}
        },
        {
            "id": "description",
            "name": "Description",
            "custom": False,
            "schema": {"type": "string", "system": "description"}
        },
        {
            "id": "customfield_10006",
            "name": "Epic Link",
            "custom": True,
            "schema": {
                "type": "string",
                "custom": "com.pyxis.greenhopper.jira:gh-epic-link"
            }
        },
        {
            "id": "customfield_10011",
            "name": "Epic Name",
            "custom": True,
            "schema": {
                "type": "string",
                "custom": "com.pyxis.greenhopper.jira:gh-epic-label"
            }
        },
        {
            "id": "customfield_10016",
            "name": "Story Points",
            "custom": True,
            "schema": {
                "type": "number",
                "custom": "com.atlassian.jira.plugin.system.customfieldtypes:float"
            }
        },
        {
            "id": "assignee",
            "name": "Assignee",
            "custom": False,
            "schema": {"type": "user", "system": "assignee"}
        },
        {
            "id": "labels",
            "name": "Labels",
            "custom": False,
            "schema": {"type": "array", "items": "string", "system": "labels"}
        },
        {
            "id": "duedate",
            "name": "Due Date",
            "custom": False,
            "schema": {"type": "date", "system": "duedate"}
        }
    ]


@pytest.fixture
def mock_api_request_success(monkeypatch):
    """Mock make_api_request to return success."""
    async def mock_request(path, method="GET", **kwargs):
        return (True, {"status": "success"})

    from mcp_jira.api import client
    monkeypatch.setattr(client, "make_api_request", mock_request)
    return mock_request


@pytest.fixture
def mock_api_request_fields(monkeypatch, mock_jira_fields):
    """Mock make_api_request to return field metadata."""
    async def mock_request(path, method="GET", **kwargs):
        if "/rest/api/3/field" in path or "field" in path:
            return (True, mock_jira_fields)
        return (True, {"status": "success"})

    import mcp_jira.api.client
    monkeypatch.setattr(mcp_jira.api.client, "make_api_request", mock_request)
    # Also patch it in the field_discovery module
    import mcp_jira.utils.field_discovery
    monkeypatch.setattr(mcp_jira.utils.field_discovery, "make_api_request", mock_request)
    return mock_request


@pytest.fixture
def sample_adf_doc():
    """Sample ADF document."""
    return {
        "version": 1,
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Hello World"}
                ]
            }
        ]
    }


@pytest.fixture
def sample_issue_data():
    """Sample Jira issue data."""
    return {
        "key": "PROJ-123",
        "fields": {
            "summary": "Test Issue",
            "description": {
                "version": 1,
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Test description"}]
                    }
                ]
            },
            "issuetype": {"name": "Story"},
            "project": {"key": "PROJ"}
        }
    }

