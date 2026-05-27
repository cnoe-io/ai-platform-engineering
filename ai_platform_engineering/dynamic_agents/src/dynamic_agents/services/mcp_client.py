"""MCP Client wrapper for Dynamic Agents."""

import asyncio
import logging
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from dynamic_agents.models import MCPServerConfig, TransportType

logger = logging.getLogger(__name__)


def build_mcp_connection_config(server: MCPServerConfig) -> dict[str, Any]:
    """Build connection config dict for MultiServerMCPClient.

    Args:
        server: MCP server configuration

    Returns:
        Connection config dict compatible with langchain_mcp_adapters
    """
    if server.transport == TransportType.SSE:
        return {
            "url": server.endpoint,
            "transport": "sse",
        }
    elif server.transport == TransportType.HTTP:
        return {
            "url": server.endpoint,
            "transport": "streamable_http",
        }
    else:  # stdio
        config: dict[str, Any] = {
            "command": server.command,
            "transport": "stdio",
        }
        if server.args:
            config["args"] = server.args
        if server.env:
            config["env"] = server.env
        return config


def build_mcp_connections(
    servers: list[MCPServerConfig],
    server_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Build MCP connections dict for MultiServerMCPClient.

    Args:
        servers: List of all available MCP server configs
        server_ids: List of server IDs to include

    Returns:
        Dict mapping server_id to connection config
    """
    connections: dict[str, dict[str, Any]] = {}

    server_map = {s.id: s for s in servers}

    for server_id in server_ids:
        server = server_map.get(server_id)
        if not server:
            logger.warning(f"MCP server '{server_id}' not found in registry")
            continue
        if not server.enabled:
            logger.warning(f"MCP server '{server_id}' is disabled, skipping")
            continue

        connections[server_id] = build_mcp_connection_config(server)

    return connections


def filter_tools_by_allowed(
    all_tools: list,
    allowed_tools: dict[str, list[str]],
) -> tuple[list, list[str]]:
    """Filter tools based on allowed_tools config.

    Args:
        all_tools: List of all tools from MCP client (with namespaced names)
        allowed_tools: Config mapping server_id -> tool_names (empty = all)

    Returns:
        Tuple of (filtered_tools, missing_tool_names)
    """
    # Build set of allowed namespaced tool names
    allowed_names: set[str] = set()

    for server_id, tool_names in allowed_tools.items():
        if not tool_names:
            # Empty array = all tools from this server
            for tool in all_tools:
                # Tools are namespaced as "{server_id}_{tool_name}"
                if tool.name.startswith(f"{server_id}_"):
                    allowed_names.add(tool.name)
        else:
            # Specific tools only
            for tool_name in tool_names:
                namespaced = f"{server_id}_{tool_name}"
                allowed_names.add(namespaced)

    # Filter and validate tools
    filtered_tools = []
    missing_tools: list[str] = []
    available_names = {t.name for t in all_tools}

    for tool_name in allowed_names:
        if tool_name in available_names:
            tool = next(t for t in all_tools if t.name == tool_name)
            filtered_tools.append(tool)
        else:
            missing_tools.append(tool_name)

    return filtered_tools, missing_tools


def _extract_error_message(exc: BaseException) -> str:
    """Extract a user-friendly error message from an exception.

    Handles ExceptionGroup by extracting the most relevant nested error.
    """
    # Handle ExceptionGroup (Python 3.11+)
    if isinstance(exc, BaseExceptionGroup):
        # Get the first nested exception
        if exc.exceptions:
            return _extract_error_message(exc.exceptions[0])
        return str(exc)

    # Handle httpx.HTTPStatusError specifically
    if hasattr(exc, "response") and hasattr(exc.response, "status_code"):
        status = exc.response.status_code
        url = getattr(exc.response, "url", "unknown")
        return f"HTTP {status} error connecting to {url}"

    return str(exc)


async def get_tools_with_resilience(
    connections: dict[str, dict[str, Any]],
) -> tuple[list, list[str], dict[str, str]]:
    """Get tools from MCP servers with per-server error handling.

    Unlike MultiServerMCPClient.get_tools(), this connects to each server
    independently so that one failing server doesn't prevent others from
    connecting. Connections are made concurrently for performance.

    Args:
        connections: Dict mapping server_id to connection config

    Returns:
        Tuple of:
        - all_tools: List of tools from successfully connected servers
        - failed_servers: List of server IDs that failed to connect
        - failed_errors: Dict mapping server_id to error message
    """

    async def connect_single_server(
        server_id: str, connection_config: dict[str, Any]
    ) -> tuple[str, list | BaseException]:
        """Connect to a single server and return its tools or exception."""
        try:
            single_client = MultiServerMCPClient(
                {server_id: connection_config},
                tool_name_prefix=True,
            )
            server_tools = await single_client.get_tools()
            return server_id, server_tools
        except BaseException as e:
            return server_id, e

    # Connect to all servers concurrently
    tasks = [connect_single_server(server_id, config) for server_id, config in connections.items()]
    results = await asyncio.gather(*tasks)

    # Process results
    all_tools: list = []
    failed_servers: list[str] = []
    failed_errors: dict[str, str] = {}

    for server_id, result in results:
        if isinstance(result, BaseException):
            error_msg = _extract_error_message(result)
            logger.warning(f"Failed to connect to MCP server '{server_id}': {error_msg}")
            failed_servers.append(server_id)
            failed_errors[server_id] = error_msg
        else:
            all_tools.extend(result)
            logger.info(f"Connected to MCP server '{server_id}': {len(result)} tools")

    return all_tools, failed_servers, failed_errors


async def probe_server_tools(server: MCPServerConfig) -> list[dict[str, Any]]:
    """Probe an MCP server for its available tools.

    Args:
        server: MCP server configuration

    Returns:
        List of tool metadata dicts

    Raises:
        Exception with user-friendly message if probing fails
    """
    connection = build_mcp_connection_config(server)
    connections = {server.id: connection}

    # As of langchain-mcp-adapters 0.1.0, MultiServerMCPClient cannot be used
    # as a context manager. Use get_tools() directly instead.
    client = MultiServerMCPClient(connections, tool_name_prefix=True)

    try:
        tools = await client.get_tools()
    except BaseExceptionGroup as e:
        # Extract meaningful error from exception group
        error_msg = _extract_error_message(e)
        raise RuntimeError(f"Failed to connect to MCP server: {error_msg}") from e
    except Exception as e:
        error_msg = _extract_error_message(e)
        raise RuntimeError(f"Failed to probe MCP server: {error_msg}") from e

    # Convert tools to serializable dicts
    # Use removeprefix to only strip the server prefix, not all occurrences
    # (e.g., "argocd_search_argocd_resources" -> "search_argocd_resources", not "search_resources")
    prefix = f"{server.id}_"
    return [
        {
            "name": tool.name.removeprefix(prefix),
            "namespaced_name": tool.name,
            "description": getattr(tool, "description", ""),
        }
        for tool in tools
    ]


def _format_tool_error(tool_name: str, exc: Exception) -> str:
    """Build a descriptive error message for the LLM.

    Includes the tool name, exception type, and message so the LLM can
    decide whether to retry with different arguments or try another approach.
    Uses _extract_error_message to unwrap ExceptionGroup/TaskGroup wrappers
    and surface the actual root cause.
    """
    error_text = _extract_error_message(exc) or type(exc).__name__
    return (
        f"ERROR: Tool '{tool_name}' failed: {error_text}\n"
        f"You can retry with different arguments or try a different approach."
    )


def wrap_tools_with_error_handling(
    tools: list[BaseTool],
    agent_name: str = "agent",
) -> list[BaseTool]:
    """Wrap tools so that exceptions become LLM-visible error messages.

    Without this, MCP tool failures raise ToolException which propagates
    through LangGraph's ToolNode (default handler only catches
    ToolInvocationError) and terminates the entire agent loop.

    This follows the same pattern as built-in tools (fetch_url, sleep, etc.)
    which catch exceptions internally and return "ERROR: ..." strings.

    Args:
        tools: LangChain tools to wrap (MCP and/or built-in).
        agent_name: Label for log messages.

    Returns:
        New list of tools with error-handling wrappers.
    """
    wrapped: list[BaseTool] = []

    for tool in tools:
        tool_name = tool.name
        resp_fmt = getattr(tool, "response_format", "content")
        original_coro = getattr(tool, "coroutine", None)

        if original_coro is None:
            # Tool has no async coroutine (unusual) — keep as-is
            wrapped.append(tool)
            continue

        async def _safe_coro(
            *args: Any,
            _orig: Any = original_coro,
            _name: str = tool_name,
            _resp_fmt: str = resp_fmt,
            **kwargs: Any,
        ) -> Any:
            try:
                return await _orig(*args, **kwargs)
            except Exception as exc:
                msg = _format_tool_error(_name, exc)
                logger.error(f"[{agent_name}] Tool '{_name}' failed", exc_info=exc)
                # Return error in the format the tool's response_format expects.
                # MCP tools use content_and_artifact which requires a (content, artifact) tuple.
                if _resp_fmt == "content_and_artifact":
                    return (msg, [])
                return msg

        new_tool = StructuredTool(
            name=tool.name,
            description=tool.description or "",
            args_schema=tool.args_schema,
            coroutine=_safe_coro,
            response_format=resp_fmt,
            metadata=tool.metadata,
        )
        wrapped.append(new_tool)

    logger.info(f"[{agent_name}] Wrapped {len(wrapped)} tools with error handling")
    return wrapped
