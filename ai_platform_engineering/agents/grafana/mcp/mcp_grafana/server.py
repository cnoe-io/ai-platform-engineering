"""
Grafana MCP Server

Provides tools for interacting with Grafana instances including:
- Dashboard search and management
- Alert monitoring and management
- Datasource querying
- User and team management
"""

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import typer
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .client import get_client
from .tools import dashboard_tools, alert_tools, datasource_tools, user_tools

logging.basicConfig(level=logging.WARNING)

app = typer.Typer()

MCP_SERVER_INSTRUCTIONS = """
You are a Grafana MCP server that provides tools for interacting with Grafana instances.

Available capabilities:
- Search and retrieve dashboards
- Monitor and manage alerts
- Query datasources (Prometheus, etc.)
- Manage users and teams

When users ask for information about their Grafana resources, use the appropriate tools
to fetch real data from their Grafana instance.
"""


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[None]:
    """Lifespan context manager for the MCP server."""
    # Initialize any required resources here
    try:
        yield
    finally:
        # Cleanup resources here
        pass


def create_server() -> FastMCP:
    """Create and configure the Grafana MCP server."""
    server = FastMCP("Grafana MCP Server")
    
    # Register all tool groups
    dashboard_tools(server)
    alert_tools(server)
    datasource_tools(server)
    user_tools(server)
    
    return server


@app.command()
def main():
    """Run the Grafana MCP server."""
    server = create_server()
    server.run()


if __name__ == "__main__":
    main()