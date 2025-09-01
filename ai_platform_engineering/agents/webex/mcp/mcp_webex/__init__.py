# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio

import click
import logging
import sys
from .mcp_server import serve
from mcp.server import NotificationOptions
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server
from .__about__ import __version__


@click.command()
@click.option(
  "--auth-token",
  envvar="WEBEX_TOKEN",
  required=True,
  help="Webex bot token",
)
@click.option("--port", default=8000, help="Port to listen on for SSE", envvar="MCP_PORT")
@click.option(
  "--transport",
  type=click.Choice(["stdio", "sse", "http"]),
  default="stdio",
  envvar="MCP_MODE",
  help="Transport type",
)
@click.option("-v", "--verbose", count=True)
@click.option("--host", default="127.0.0.1", help="Host to listen on", envvar="MCP_HOST")
def main(auth_token: str, verbose: bool, transport: str, port: int, host: str) -> None:
  logging_level = logging.WARN
  if verbose == 1:
    logging_level = logging.INFO
  elif verbose >= 2:
    logging_level = logging.DEBUG

  logging.basicConfig(level=logging_level, stream=sys.stderr)

  if transport == "sse" or transport == "http":
    from mcp.server.sse import SseServerTransport
    from starlette.applications import Starlette
    from starlette.responses import Response
    from starlette.routing import Mount, Route

    sse = SseServerTransport("/messages/")

    async def handle_sse(request):
      async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
        server = await serve(auth_token)
        await server.run(
          streams[0],
          streams[1],
          make_initialization_options(server),
        )
      return Response()

    starlette_app = Starlette(
      debug=True,
      routes=[
        Route("/sse", endpoint=handle_sse, methods=["GET"]),
        Mount("/messages/", app=sse.handle_post_message),
      ],
    )

    import uvicorn

    uvicorn.run(starlette_app, host=host, port=port)
  else:

    async def _run():
      async with stdio_server() as (read_stream, write_stream):
        server = await serve(auth_token)
        await server.run(
          read_stream,
          write_stream,
          make_initialization_options(server),
        )

    asyncio.run(_run())


def make_initialization_options(server):
  return InitializationOptions(
    server_name="webex",
    server_version=__version__,
    capabilities=server.get_capabilities(
      notification_options=NotificationOptions(),
      experimental_capabilities={},
    ),
  )


if __name__ == "__main__":
  main()
