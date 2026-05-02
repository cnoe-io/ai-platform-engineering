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
    "--port", default=8000, help="Port to listen on for HTTP/SSE", envvar="MCP_PORT"
)
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse", "http", "streamable-http"]),
    default="streamable-http",
    envvar="MCP_MODE",
    help="Transport (stdio, sse, http/streamable-http).",
)
@click.option("--host", default="0.0.0.0", help="Host interface to bind", envvar="MCP_HOST")
@click.option("-v", "--verbose", count=True)
def main(verbose: int, transport: InputTransport, port: int, host: str) -> None:
    """Entry point for the Scheduler MCP.

    Wraps caipe-scheduler's REST API as MCP tools so any dynamic agent can
    register/list/cancel cron-style scheduled chat fires. Reads
    ``SCHEDULER_URL`` and ``SCHEDULER_SERVICE_TOKEN`` from env.
    """
    level = logging.INFO
    if verbose == 1:
        level = logging.INFO
    elif verbose >= 2:
        level = logging.DEBUG
    logging.basicConfig(level=level, stream=sys.stderr)

    if transport == "http":
        selected: RuntimeTransport = "streamable-http"
    else:
        selected = transport  # type: ignore[assignment]

    log_level: Literal["INFO", "DEBUG"] = "DEBUG" if level == logging.DEBUG else "INFO"
    server = FastMCP("scheduler", host=host, port=port, log_level=log_level)
    register_tools(server)
    server.run(transport=selected)
