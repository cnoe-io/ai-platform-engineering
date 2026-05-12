"""
Auth-aware MCP tool proxies for Agent Gateway routing (FR-038e).

When ``AGENT_GATEWAY_URL`` is set, this module wraps RAG MCP tools in proxy
``BaseTool`` instances that read the per-session OBO token from
``RunnableConfig.configurable['obo_token']`` (injected by the supervisor
``stream`` method) and create an ephemeral MCP client routed through AG.

If ``AGENT_GATEWAY_URL`` is empty, tools are returned as-is (direct MCP).
"""

from __future__ import annotations

import os
import logging
from typing import Any, Optional, Type

from langchain_core.tools import BaseTool
from langchain_core.callbacks import CallbackManagerForToolRun, AsyncCallbackManagerForToolRun
from langchain_core.runnables.config import ensure_config
from pydantic import BaseModel

logger = logging.getLogger(__name__)

AGENT_GATEWAY_URL = os.getenv("AGENT_GATEWAY_URL", "")
RAG_SERVER_URL = os.getenv("RAG_SERVER_URL", "http://localhost:9446")


async def _invoke_via_ag(
    tool_name: str,
    tool_args: dict[str, Any],
    obo_token: Optional[str],
) -> Any:
    """Invoke a RAG MCP tool via Agent Gateway with per-user auth."""
    from langchain_mcp_adapters.client import MultiServerMCPClient

    headers: dict[str, str] = {}
    if obo_token:
        headers["Authorization"] = f"Bearer {obo_token}"

    url = f"{AGENT_GATEWAY_URL}/mcp/rag" if AGENT_GATEWAY_URL else f"{RAG_SERVER_URL}/mcp"

    client = MultiServerMCPClient(
        {"rag": {"url": url, "transport": "streamable_http", "headers": headers}}
    )
    tools = await client.get_tools()
    target = next((t for t in tools if t.name == tool_name), None)
    if not target:
        return {"error": f"Tool {tool_name} not found via AG"}
    return await target.ainvoke(tool_args)


class _AuthAwareProxyTool(BaseTool):
    """Proxy tool that routes MCP calls through AG with per-session OBO auth."""

    _target_tool_name: str = ""

    def _run(
        self,
        run_manager: Optional[CallbackManagerForToolRun] = None,
        **kwargs: Any,
    ) -> Any:
        raise NotImplementedError("Use async version")

    async def _arun(
        self,
        run_manager: Optional[AsyncCallbackManagerForToolRun] = None,
        **kwargs: Any,
    ) -> Any:
        config = ensure_config()
        obo_token: Optional[str] = None
        configurable = config.get("configurable")
        if isinstance(configurable, dict):
            obo_token = configurable.get("obo_token")

        if not obo_token:
            logger.warning(
                "No obo_token in RunnableConfig for tool %s — calling AG without auth",
                self._target_tool_name,
            )

        return await _invoke_via_ag(self._target_tool_name, kwargs, obo_token)


def wrap_rag_tools_with_auth(original_tools: list) -> list:
    """
    Wrap RAG MCP tools with auth-aware proxies routed through AG.

    When ``AGENT_GATEWAY_URL`` is not configured, returns the original
    tools unchanged (backward-compatible direct MCP).
    """
    if not AGENT_GATEWAY_URL:
        logger.info(
            "AGENT_GATEWAY_URL not set — RAG tools will use direct MCP (no AG)"
        )
        return original_tools

    logger.info(
        "Wrapping %d RAG tools with AG auth proxies (gateway=%s)",
        len(original_tools),
        AGENT_GATEWAY_URL,
    )

    proxied: list = []
    for tool in original_tools:
        tool_name = tool.name
        tool_desc = tool.description or f"Proxied RAG tool: {tool_name}"
        tool_schema: Optional[Type[BaseModel]] = getattr(tool, "args_schema", None)

        proxy = _AuthAwareProxyTool(
            name=tool_name,
            description=tool_desc,
        )
        proxy._target_tool_name = tool_name
        if tool_schema is not None:
            proxy.args_schema = tool_schema

        proxied.append(proxy)

    return proxied
