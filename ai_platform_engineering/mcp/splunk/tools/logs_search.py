# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Splunk Platform Log Search Tool

This tool connects to Splunk Cloud Platform's MCP Server for log searching.
Reference: https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-connecting-telemetry-sources-connecting-splunk.html
Splunk MCP Documentation: https://help.splunk.com/en/splunk-cloud-platform/mcp-server-for-splunk-platform/about-mcp-server-for-splunk-platform

Available tools from Splunk MCP:
- run_splunk_query: Execute SPL queries
- get_indexes: List all indexes
- get_index_info: Get specific index details
- get_metadata: Get hosts/sources/sourcetypes
- get_splunk_info: Get Splunk instance info
- get_user_info: Get current user info
- get_user_list: List all users
- get_kv_store_collections: Get KV store collections
- get_knowledge_objects: Get saved searches, alerts, macros, etc.
"""

import json
import logging
import os
from typing import Annotated, Optional, Literal

import httpx
from pydantic import Field

# Configure logging
logger = logging.getLogger("mcp-splunk-logs")

# Splunk Platform MCP configuration (separate from Observability)
SPLUNK_MCP_URL = os.getenv("SPLUNK_MCP_URL")  # e.g., https://<deployment>.api.scs.splunk.com/<deployment>/mcp/v1/
SPLUNK_MCP_TOKEN = os.getenv("SPLUNK_MCP_TOKEN")  # Bearer token with 'mcp' audience


async def _call_splunk_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Internal helper to call Splunk MCP tools via JSON-RPC."""
    if not SPLUNK_MCP_URL or not SPLUNK_MCP_TOKEN:
        return {
            "success": False,
            "error": "Splunk Platform MCP not configured",
            "message": "Set SPLUNK_MCP_URL and SPLUNK_MCP_TOKEN environment variables.",
        }

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {SPLUNK_MCP_TOKEN}",
    }

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                SPLUNK_MCP_URL.rstrip('/') + '/',
                headers=headers,
                json=payload,
            )

            if response.status_code == 200:
                # Handle SSE response format
                text = response.text
                if text.startswith("event:"):
                    # Parse SSE format
                    for line in text.split('\n'):
                        if line.startswith("data:"):
                            data = json.loads(line[5:].strip())
                            if "result" in data:
                                result = data["result"]
                                if result.get("isError"):
                                    return {"success": False, "error": result.get("content", [{}])[0].get("text", "Unknown error")}
                                # Parse structured content or text content
                                if "structuredContent" in result:
                                    return {"success": True, "data": result["structuredContent"]}
                                elif "content" in result:
                                    content = result["content"]
                                    if isinstance(content, list) and len(content) > 0:
                                        text_content = content[0].get("text", "")
                                        try:
                                            return {"success": True, "data": json.loads(text_content)}
                                        except json.JSONDecodeError:
                                            return {"success": True, "data": text_content}
                                return {"success": True, "data": result}
                            elif "error" in data:
                                return {"success": False, "error": data["error"]}
                else:
                    # Regular JSON response
                    data = response.json()
                    if "result" in data:
                        return {"success": True, "data": data["result"]}
                    elif "error" in data:
                        return {"success": False, "error": data["error"]}
                    return {"success": True, "data": data}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}", "details": response.text[:500]}

    except httpx.TimeoutException:
        return {"success": False, "error": "Request timeout", "message": "Splunk query timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def search_splunk_logs(
    query: Annotated[
        str,
        Field(
            description=(
                "Splunk Search Processing Language (SPL) query. "
                "Example: 'index=main error | head 100' or 'index=_internal | stats count by sourcetype'"
            )
        ),
    ],
    earliest_time: Annotated[
        Optional[str],
        Field(
            description=(
                "Earliest time for the search. Use Splunk time modifiers like '-24h', '-1d@d', '-7d', "
                "'-15m', or ISO 8601 format. Default: '-24h' (last 24 hours)"
            )
        ),
    ] = "-24h",
    latest_time: Annotated[
        Optional[str],
        Field(
            description=(
                "Latest time for the search. Use Splunk time modifiers like 'now', '@d', "
                "or ISO 8601 format. Default: 'now'"
            )
        ),
    ] = "now",
    row_limit: Annotated[
        Optional[int],
        Field(
            description="Maximum number of results to return. Default: 100",
            ge=0,
        ),
    ] = 100,
) -> str:
    """
    Search Splunk logs using SPL (Search Processing Language).

    This tool connects to Splunk Cloud Platform's MCP Server and calls the
    'run_splunk_query' tool for log searching.

    Args:
        query: SPL query string (e.g., 'index=main error | head 100')
        earliest_time: Start time for search (default: -24h)
        latest_time: End time for search (default: now)
        row_limit: Maximum results to return (default: 100)

    Returns:
        JSON string containing search results or error message.

    Example queries:
        - "index=main error" - Find errors in main index
        - "index=_internal | stats count by sourcetype" - Count by sourcetype
        - "index=* host=webserver* | head 50" - Logs from webservers
    """
    logger.info(f"Searching Splunk logs: query='{query}', earliest={earliest_time}, latest={latest_time}")

    result = await _call_splunk_mcp_tool("run_splunk_query", {
        "query": query,
        "earliest_time": earliest_time,
        "latest_time": latest_time,
        "row_limit": row_limit,
    })

    return json.dumps(result, indent=2, default=str)


async def get_splunk_indexes(
    row_limit: Annotated[
        Optional[int],
        Field(
            description="Maximum number of indexes to return. Default: 100",
            ge=0,
        ),
    ] = 100,
) -> str:
    """
    List available Splunk indexes.

    Retrieves the list of indexes accessible to the authenticated user
    from Splunk Cloud Platform.

    Returns:
        JSON string containing list of available indexes with name, size, and event count.
    """
    logger.info("Fetching available Splunk indexes")

    result = await _call_splunk_mcp_tool("get_indexes", {"row_limit": row_limit})
    return json.dumps(result, indent=2, default=str)


async def get_splunk_metadata(
    metadata_type: Annotated[
        Literal["hosts", "sources", "sourcetypes"],
        Field(description="Type of metadata to retrieve: 'hosts', 'sources', or 'sourcetypes'"),
    ],
    index: Annotated[
        Optional[str],
        Field(description="Index to retrieve metadata for. Use '*' for all indexes. Default: '*'"),
    ] = "*",
    earliest_time: Annotated[
        Optional[str],
        Field(description="Start time for metadata search. Default: '-24h'"),
    ] = "-24h",
    latest_time: Annotated[
        Optional[str],
        Field(description="End time for metadata search. Default: 'now'"),
    ] = "now",
    row_limit: Annotated[
        Optional[int],
        Field(description="Maximum number of metadata entries to return. Default: 100"),
    ] = 100,
) -> str:
    """
    Get metadata information from Splunk (hosts, sources, or sourcetypes).

    Args:
        metadata_type: Type of metadata - 'hosts', 'sources', or 'sourcetypes'
        index: Index to query. Default '*' for all indexes.
        earliest_time: Start time. Default '-24h'.
        latest_time: End time. Default 'now'.
        row_limit: Max results. Default 100.

    Returns:
        JSON string containing metadata results.
    """
    logger.info(f"Fetching Splunk metadata: type={metadata_type}, index={index}")

    result = await _call_splunk_mcp_tool("get_metadata", {
        "type": metadata_type,
        "index": index,
        "earliest_time": earliest_time,
        "latest_time": latest_time,
        "row_limit": row_limit,
    })
    return json.dumps(result, indent=2, default=str)


async def get_splunk_info() -> str:
    """
    Get comprehensive information about the Splunk instance.

    Returns:
        JSON string with version, build, serverName, OS details, hardware specs, and license status.
    """
    logger.info("Fetching Splunk instance info")

    result = await _call_splunk_mcp_tool("get_splunk_info", {})
    return json.dumps(result, indent=2, default=str)

