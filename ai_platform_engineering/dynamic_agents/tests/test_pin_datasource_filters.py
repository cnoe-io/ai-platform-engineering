"""Agent<->datasource binding: pin_datasource_filters narrows RAG search tools."""

from __future__ import annotations

from langchain_core.tools import StructuredTool

from dynamic_agents.services.mcp_client import pin_datasource_filters

_SEARCH_SCHEMA = {
    "title": "SearchArgs",
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "filters": {"type": "object"},
        "limit": {"type": "integer"},
    },
    "required": ["query"],
}


async def _search_coro(**kwargs: object) -> dict[str, object]:
    return dict(kwargs)


def _search_tool(name: str = "knowledge-base_search") -> StructuredTool:
    return StructuredTool(
        name=name,
        description="Search the knowledge base.",
        args_schema=_SEARCH_SCHEMA,
        coroutine=_search_coro,
    )


def test_no_datasource_ids_leaves_tools_untouched():
    tool = _search_tool()
    result = pin_datasource_filters([tool], None, agent_name="test-agent")
    assert result == [tool]


def test_tool_without_filters_arg_is_untouched():
    schema = {"type": "object", "properties": {"query": {"type": "string"}}}
    tool = StructuredTool(
        name="fetch_document", description="Fetch a document.", args_schema=schema, coroutine=_search_coro
    )
    result = pin_datasource_filters([tool], ["kb-1"], agent_name="test-agent")
    assert result == [tool]


async def test_pins_datasource_id_when_caller_supplies_no_filters():
    tool = _search_tool()
    pinned = pin_datasource_filters([tool], ["kb-1", "kb-2"], agent_name="test-agent")[0]

    output = await pinned.coroutine(query="deploy process")

    assert output["filters"]["datasource_id"] == ["kb-1", "kb-2"]


async def test_intersects_when_caller_requests_a_subset():
    tool = _search_tool()
    pinned = pin_datasource_filters([tool], ["kb-1", "kb-2"], agent_name="test-agent")[0]

    output = await pinned.coroutine(query="deploy process", filters={"datasource_id": ["kb-2", "kb-9"]})

    assert output["filters"]["datasource_id"] == ["kb-2"]


async def test_intersects_when_caller_requests_a_single_string_id():
    tool = _search_tool()
    pinned = pin_datasource_filters([tool], ["kb-1"], agent_name="test-agent")[0]

    output = await pinned.coroutine(query="deploy process", filters={"datasource_id": "kb-9"})

    assert output["filters"]["datasource_id"] == []


def test_leaves_non_search_tools_in_the_same_order():
    search = _search_tool()
    other_schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    other = StructuredTool(
        name="sleep", description="Sleep.", args_schema=other_schema, coroutine=_search_coro
    )

    result = pin_datasource_filters([other, search], ["kb-1"], agent_name="test-agent")

    assert result[0] is other
    assert result[1].name == search.name
