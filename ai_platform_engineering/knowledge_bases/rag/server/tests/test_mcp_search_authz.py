"""Tests for query-time RBAC on the live agent MCP path (`server/tools.py`).

The FastMCP `/mcp` search/fetch_document/list_datasources_and_entity_types
tools previously ignored the caller's OpenFGA-derived accessible datasource
set entirely — any authenticated MCP caller saw every datasource's content.
`AgentTools._resolve_accessible_datasource_ids` reads the `UserContext` set by
`MCPAuthMiddleware` (via `mcp_user_context_var`) and narrows every tool's
results to what `get_accessible_datasource_ids` returns for that user.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from common.models.rag import MCPToolConfig, ParallelSearch
from common.models.rbac import Role, UserContext
from server import tools as tools_module
from server.tools import AgentTools


def _user(role: str = Role.READONLY, email: str = "alice@example.com") -> UserContext:
    return UserContext(
        subject="alice-sub",
        email=email,
        role=role,
        is_authenticated=True,
        groups=[],
    )


def _make_tools() -> AgentTools:
    return AgentTools(
        redis_client=MagicMock(),
        vector_db_query_service=MagicMock(),
        metadata_storage=MagicMock(),
    )


def _make_single_label_config(label: str = "semantic_results", allow_runtime_filters: bool = False) -> MCPToolConfig:
    return MCPToolConfig(
        tool_id="search",
        parallel_searches=[ParallelSearch(label=label, semantic_weight=0.7)],
        allow_runtime_filters=allow_runtime_filters,
        enabled=True,
    )


# ---------------------------------------------------------------------------
# _resolve_accessible_datasource_ids
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_returns_none_when_no_mcp_user_context(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_get_mcp_user_context", staticmethod(lambda: None))

    assert await at._resolve_accessible_datasource_ids("read") is None


@pytest.mark.asyncio
async def test_resolve_returns_none_for_client_credentials_identity(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    client_user = _user(email="client:rag-ingestor")
    monkeypatch.setattr(AgentTools, "_get_mcp_user_context", staticmethod(lambda: client_user))

    assert await at._resolve_accessible_datasource_ids("read") is None


@pytest.mark.asyncio
async def test_resolve_returns_none_for_unrestricted_wildcard(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_get_mcp_user_context", staticmethod(_user))
    monkeypatch.setattr(tools_module, "get_accessible_datasource_ids", AsyncMock(return_value=["*"]))

    assert await at._resolve_accessible_datasource_ids("read") is None


@pytest.mark.asyncio
async def test_resolve_returns_accessible_list_for_scoped_user(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_get_mcp_user_context", staticmethod(_user))
    monkeypatch.setattr(tools_module, "get_accessible_datasource_ids", AsyncMock(return_value=["ds-a", "ds-b"]))

    assert await at._resolve_accessible_datasource_ids("read") == ["ds-a", "ds-b"]


@pytest.mark.asyncio
async def test_resolve_returns_empty_list_when_nothing_accessible(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_get_mcp_user_context", staticmethod(_user))
    monkeypatch.setattr(tools_module, "get_accessible_datasource_ids", AsyncMock(return_value=[]))

    assert await at._resolve_accessible_datasource_ids("read") == []


# ---------------------------------------------------------------------------
# search (_make_search_fn / _execute) — org admin / unrestricted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_unrestricted_user_queries_without_datasource_filter(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=None))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    search_fn = at._make_search_fn(_make_single_label_config(), graph_rag_enabled=False)
    await search_fn(query="test", limit=10, thought="")

    _, kwargs = at.vector_db_query_service.query.call_args
    assert kwargs["filters"] is None


# ---------------------------------------------------------------------------
# search — scoped user (team member)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_scoped_user_filters_to_accessible_datasources(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-a", "ds-b"]))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    search_fn = at._make_search_fn(_make_single_label_config(), graph_rag_enabled=False)
    await search_fn(query="test", limit=10, thought="")

    _, kwargs = at.vector_db_query_service.query.call_args
    assert sorted(kwargs["filters"]["datasource_id"]) == ["ds-a", "ds-b"]


@pytest.mark.asyncio
async def test_search_scoped_user_gets_no_results_when_nothing_accessible(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=[]))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    search_fn = at._make_search_fn(_make_single_label_config(), graph_rag_enabled=False)
    response = await search_fn(query="test", limit=10, thought="")

    assert response == {"semantic_results": []}
    at.vector_db_query_service.query.assert_not_called()


@pytest.mark.asyncio
async def test_search_config_narrowed_datasource_intersects_with_accessible(monkeypatch: pytest.MonkeyPatch):
    """A ParallelSearch pinned to specific datasource_ids (config narrowing)
    must intersect with the caller's accessible set, never widen it."""
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-a"]))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    config = MCPToolConfig(
        tool_id="search",
        parallel_searches=[ParallelSearch(label="results", datasource_ids=["ds-a", "ds-b"], semantic_weight=0.7)],
        allow_runtime_filters=False,
        enabled=True,
    )
    search_fn = at._make_search_fn(config, graph_rag_enabled=False)
    await search_fn(query="test", limit=10, thought="")

    _, kwargs = at.vector_db_query_service.query.call_args
    assert kwargs["filters"]["datasource_id"] == ["ds-a"]


@pytest.mark.asyncio
async def test_search_config_narrowed_datasource_empty_intersection_skips_query(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-c"]))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    config = MCPToolConfig(
        tool_id="search",
        parallel_searches=[ParallelSearch(label="results", datasource_ids=["ds-a", "ds-b"], semantic_weight=0.7)],
        allow_runtime_filters=False,
        enabled=True,
    )
    search_fn = at._make_search_fn(config, graph_rag_enabled=False)
    response = await search_fn(query="test", limit=10, thought="")

    assert response == {"results": []}
    at.vector_db_query_service.query.assert_not_called()


@pytest.mark.asyncio
async def test_search_runtime_filter_datasource_narrowed_by_accessible(monkeypatch: pytest.MonkeyPatch):
    """A runtime `filters={"datasource_id": ...}` (allow_runtime_filters=True)
    must also be intersected with the caller's accessible set."""
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-a", "ds-b"]))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    search_fn = at._make_search_fn(_make_single_label_config(allow_runtime_filters=True), graph_rag_enabled=False)
    await search_fn(query="test", filters={"datasource_id": "ds-a"}, limit=10, thought="")

    _, kwargs = at.vector_db_query_service.query.call_args
    assert kwargs["filters"]["datasource_id"] == "ds-a"


@pytest.mark.asyncio
async def test_search_runtime_filter_datasource_outside_accessible_returns_empty(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-a", "ds-b"]))
    at.vector_db_query_service.query = AsyncMock(return_value=[])

    search_fn = at._make_search_fn(_make_single_label_config(allow_runtime_filters=True), graph_rag_enabled=False)
    response = await search_fn(query="test", filters={"datasource_id": "ds-z"}, limit=10, thought="")

    assert response == {"semantic_results": []}
    at.vector_db_query_service.query.assert_not_called()


# ---------------------------------------------------------------------------
# fetch_document
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_document_unrestricted_user_no_datasource_filter(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=None))
    at.vector_db_query_service.query = AsyncMock(return_value=[{"id": "chunk-1"}])

    await at.fetch_document("doc-1")

    _, kwargs = at.vector_db_query_service.query.call_args
    assert "datasource_id" not in kwargs["filters"]


@pytest.mark.asyncio
async def test_fetch_document_scoped_user_filters_by_accessible_datasources(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-a"]))
    at.vector_db_query_service.query = AsyncMock(return_value=[{"id": "chunk-1"}])

    await at.fetch_document("doc-1")

    _, kwargs = at.vector_db_query_service.query.call_args
    assert kwargs["filters"]["datasource_id"] == ["ds-a"]


@pytest.mark.asyncio
async def test_fetch_document_returns_not_found_when_nothing_accessible(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=[]))
    at.vector_db_query_service.query = AsyncMock()

    result = await at.fetch_document("doc-1")

    assert "not found" in result
    at.vector_db_query_service.query.assert_not_called()


# ---------------------------------------------------------------------------
# list_datasources_and_entity_types
# ---------------------------------------------------------------------------


def _ds_info(datasource_id: str) -> MagicMock:
    info = MagicMock()
    info.datasource_id = datasource_id
    return info


@pytest.mark.asyncio
async def test_list_datasources_unrestricted_user_sees_all(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=None))
    at.metadata_storage.fetch_all_datasource_info = AsyncMock(return_value=[_ds_info("ds-a"), _ds_info("ds-b")])

    result = await at.list_datasources_and_entity_types()

    assert sorted(result["datasources"]) == ["ds-a", "ds-b"]


@pytest.mark.asyncio
async def test_list_datasources_scoped_user_sees_only_accessible(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=["ds-a"]))
    at.metadata_storage.fetch_all_datasource_info = AsyncMock(return_value=[_ds_info("ds-a"), _ds_info("ds-b")])

    result = await at.list_datasources_and_entity_types()

    assert result["datasources"] == ["ds-a"]


@pytest.mark.asyncio
async def test_list_datasources_scoped_user_sees_none_when_nothing_accessible(monkeypatch: pytest.MonkeyPatch):
    at = _make_tools()
    monkeypatch.setattr(AgentTools, "_resolve_accessible_datasource_ids", AsyncMock(return_value=[]))
    at.metadata_storage.fetch_all_datasource_info = AsyncMock(return_value=[_ds_info("ds-a"), _ds_info("ds-b")])

    result = await at.list_datasources_and_entity_types()

    assert result["datasources"] == []
