#!/usr/bin/env python3
"""
PagerDuty MCP Server

This server provides a Model Context Protocol (MCP) interface to the PagerDuty API,
allowing large language models and AI assistants to manage PagerDuty resources.
"""
import os
import logging
from dotenv import load_dotenv
from fastmcp import FastMCP

from mcp_pagerduty.tools import (
  incidents,
  services,
  users,
  schedules,
  oncalls,
)

def main():
    """
    Main entry point for the PagerDuty MCP server.
    This function initializes the server, loads configuration from environment variables,
    and registers the necessary tools for managing PagerDuty resources.
    """
    # Load environment variables from .env file
    load_dotenv()

    # Configure logging
    logging.basicConfig(level=logging.DEBUG)

    # Get MCP configuration from environment variables
    MCP_MODE = os.getenv("MCP_MODE", "STDIO")

    # Get host and port for server
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info(f"Starting MCP server in {MCP_MODE} mode on {MCP_HOST}:{MCP_PORT}")

    # Get agent name from environment variables
    SERVER_NAME = os.getenv("AGENT_NAME", "PagerDuty")
    logging.info('*'*40)
    logging.info(f"MCP Server name: {SERVER_NAME}")
    logging.info('*'*40)

    # Create server instance
    if MCP_MODE.lower() in ["sse", "http"]:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
    else:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server")


    # Register incident tools
    mcp.tool()(incidents.get_incidents)
    mcp.tool()(incidents.create_incident)
    mcp.tool()(incidents.update_incident)
    mcp.tool()(incidents.resolve_incident)
    mcp.tool()(incidents.acknowledge_incident)

    # Register service tools
    mcp.tool()(services.get_services)
    mcp.tool()(services.create_service)
    mcp.tool()(services.update_service)

    # Register user tools
    mcp.tool()(users.get_users)

    # Register schedule tools
    mcp.tool()(schedules.get_schedules)

    # Register oncall tools
    mcp.tool()(oncalls.get_oncalls)

    # Run the MCP server
    logging.info("="*40)
    mcp.run(transport=MCP_MODE.lower())
    logging.info("="*40)

# Start server when run directly
if __name__ == "__main__":
  main()
