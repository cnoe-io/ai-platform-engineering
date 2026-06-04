# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
from typing import Literal

import click
from fastmcp import FastMCP
from starlette.middleware import Middleware
from mcp_agent_auth.middleware import MCPAuthMiddleware

from .mcp_server import register_tools

# Type aliases for clarity
authToken = str  # Simple semantic alias
InputTransport = Literal[
    "stdio", "sse", "http", "streamable-http"
]  # Accepted via CLI (legacy includes 'http')
RuntimeTransport = Literal[
    "stdio", "sse", "streamable-http"
]  # Actual transports supported by FastMCP


@click.command()
@click.option(
    "--auth-token",
    envvar="WEBEX_TOKEN",
    required=False,
    default=None,
    help="Webex bot token (optional in HTTP mode; supplied via Authorization: Bearer header)",
)
@click.option(
    "--port", default=8000, help="Port to listen on for SSE/HTTP", envvar="MCP_PORT"
)
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse", "http", "streamable-http"]),
    default="stdio",
    envvar="MCP_MODE",
    help="Transport type",
)
@click.option("-v", "--verbose", count=True)
@click.option(
    "--host", default="127.0.0.1", help="Host to listen on", envvar="MCP_HOST"
)
def main(
    auth_token: authToken, verbose: int, transport: InputTransport, port: int, host: str
) -> None:
    """Entry point for the Webex MCP server.

    Parameters:
      auth_token: Webex bot token (from env/CLI).
      verbose: Verbosity flag count (-v / -vv) mapping to log level.
      transport: CLI selected transport (may include legacy 'http').
      port: Port to bind for SSE/HTTP transports.
      host: Host interface to bind.
    """
    logging_level = logging.INFO  # Changed from WARN to INFO for better visibility
    if verbose == 1:
        logging_level = logging.INFO
    elif verbose >= 2:
        logging_level = logging.DEBUG
    logging.basicConfig(level=logging_level, stream=sys.stderr)
    
    logger = logging.getLogger(__name__)
    logger.info("🚀 Starting Webex MCP Server")
    logger.info(f"📡 Transport: {transport}")
    logger.info(f"🌐 Host: {host}:{port}")
    logger.info(f"🔑 Auth token configured: {'✅' if auth_token else '❌'}")
    logger.info(f"📊 Log level: {logging.getLevelName(logging_level)}")

    # Map 'http' to FastMCP 'streamable-http' without mutating input param
    if transport == "http":
        selected_transport: RuntimeTransport = "streamable-http"
        logger.info("🔄 Mapping 'http' transport to 'streamable-http'")
    else:
        selected_transport = transport  # type: ignore[assignment]

    allowed_transports: tuple[RuntimeTransport, ...] = (
        "stdio",
        "sse",
        "streamable-http",
    )
    if selected_transport not in allowed_transports:
        raise ValueError(f"Invalid transport: {selected_transport}")

    logger.info(f"🔧 Initializing FastMCP server with transport: {selected_transport}")

    server = FastMCP(name="mcp-webex")

    logger.info("🛠️ Registering Webex tools...")
    register_tools(server, auth_token=auth_token)
    logger.info("✅ Tools registered successfully")

    logger.info(f"🎯 Starting server on {host}:{port} with transport {selected_transport}")
    if selected_transport == "streamable-http":
        server.run(
            transport=selected_transport,
            host=host,
            port=port,
            middleware=[Middleware(MCPAuthMiddleware)],
        )
    else:
        server.run(transport=selected_transport)


if __name__ == "__main__":
    main()
