# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
from typing import Literal

import click
from mcp.server.fastmcp.server import FastMCP

from .mcp_server import register_tools

# Type aliases for clarity
authToken = str  # Simple semantic alias
InputTransport = Literal[
    "stdio", "sse", "http", "streamable-http"
]  # Accepted via CLI (legacy includes 'http')
RuntimeTransport = Literal[
    "stdio", "sse", "streamable-http"
]  # Actual transports supported by FastMCP
LogLevel = Literal["WARNING", "INFO", "DEBUG"]


@click.command()
@click.option(
    "--auth-token",
    envvar="WEBEX_TOKEN",
    required=True,
    help="Webex bot token",
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
    logging_level = logging.WARN
    if verbose == 1:
        logging_level = logging.INFO
    elif verbose >= 2:
        logging_level = logging.DEBUG
    logging.basicConfig(level=logging_level, stream=sys.stderr)

    # Map 'http' to FastMCP 'streamable-http' without mutating input param
    if transport == "http":
        selected_transport: RuntimeTransport = "streamable-http"
    else:
        selected_transport = transport  # type: ignore[assignment]

    allowed_transports: tuple[RuntimeTransport, ...] = (
        "stdio",
        "sse",
        "streamable-http",
    )
    if selected_transport not in allowed_transports:
        raise ValueError(f"Invalid transport: {selected_transport}")

    log_levels: dict[int, LogLevel] = {0: "WARNING", 1: "INFO", 2: "DEBUG"}
    log_level: LogLevel = log_levels.get(verbose, "WARNING")

    # Instantiate FastMCP server
    server = FastMCP(
        name="mcp-webex",
        host=host,
        port=port,
        debug=logging_level == logging.DEBUG,
        log_level=log_level,
    )

    register_tools(server, auth_token=auth_token)

    # Run server with selected transport
    server.run(transport=selected_transport)


if __name__ == "__main__":
    main()
