#!/usr/bin/env python3
"""
PagerDuty MCP Server

This server provides a Model Context Protocol (MCP) interface to the PagerDuty API,
allowing large language models and AI assistants to manage PagerDuty resources.
"""
import logging
import os
import sys
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from agent_pagerduty.protocol_bindings.mcp_server.pagerduty_mcp.tools import (
    incidents,
    services,
    users,
    schedules,
    oncalls,
)

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Create server instance
mcp = FastMCP("PagerDuty MCP Server")

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

# Start server when run directly
if __name__ == "__main__":
    mcp.run() 