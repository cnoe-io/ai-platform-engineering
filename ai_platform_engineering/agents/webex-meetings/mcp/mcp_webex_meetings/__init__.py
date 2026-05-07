# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
from typing import Literal

import click
from mcp.server.fastmcp.server import FastMCP

from .mcp_server import register_tools

InputTransport = Literal["stdio", "sse", "http", "streamable-http"]
RuntimeTransport = Literal["stdio", "sse", "streamable-http"]


@click.command()
@click.option(
    "--port",
    default=8000,
    help="Port to listen on for HTTP/SSE",
    envvar="MCP_PORT",
)
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse", "http", "streamable-http"]),
    default="streamable-http",
    envvar="MCP_MODE",
    help=(
        "Transport. Per-user OAuth requires HTTP/SSE so the runtime can "
        "inject the Authorization header per request — stdio is rejected."
    ),
)
@click.option(
    "--host",
    default="0.0.0.0",
    help="Host interface to bind",
    envvar="MCP_HOST",
)
@click.option("-v", "--verbose", count=True)
def main(verbose: int, transport: InputTransport, port: int, host: str) -> None:
    """Entry point for the Webex Meetings MCP server.

    Auth model: this server has no static token. The dynamic-agents runtime
    injects an ``Authorization: Bearer <user-token>`` header on every MCP
    request (resolved from the per-user vendor_connections Mongo doc).
    Each tool pulls that header off the inbound request and forwards it
    untouched to webexapis.com.
    """
    level = logging.INFO
    if verbose == 1:
        level = logging.INFO
    elif verbose >= 2:
        level = logging.DEBUG
    logging.basicConfig(level=level, stream=sys.stderr)
    logger = logging.getLogger(__name__)

    if transport == "http":
        selected: RuntimeTransport = "streamable-http"
    else:
        selected = transport  # type: ignore[assignment]

    if selected == "stdio":
        raise SystemExit(
            "mcp_webex_meetings does not support stdio transport: per-user "
            "OAuth requires HTTP/SSE so the runtime can inject "
            "Authorization headers per request."
        )

    log_level: Literal["INFO", "DEBUG"] = "DEBUG" if level == logging.DEBUG else "INFO"

    logger.info("🚀 Starting Webex Meetings MCP server")
    logger.info(f"📡 Transport: {selected}, host: {host}:{port}")

    server = FastMCP(
        name="mcp-webex-meetings",
        host=host,
        port=port,
        debug=level == logging.DEBUG,
        log_level=log_level,
    )
    register_tools(server)
    server.run(transport=selected)


if __name__ == "__main__":
    main()
