# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Azure Power Ops MCP Server

Power on/off switch for customer Azure environments (AKS + Postgres
Flexible Server), composed the same way power_ops composes infra_ops's
podman primitive: it does not replace kendra-platform-agent.sh (the
existing CLI for one customer at a time), it exposes the same stop/start
sequencing as an MCP tool so it can be called by name, resolved against a
discoverable registry (tools/registry.py), and gated by confirm=True on
every customer group. See tools/power.py for the shutdown/startup ordering.
"""

import logging
import os
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware
from mcp_agent_auth.middleware import MCPAuthMiddleware

from tools import power
from tools import status


def main():
    load_dotenv()

    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger("sse_starlette.sse").setLevel(logging.INFO)
    logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.INFO)

    MCP_MODE = os.getenv("MCP_MODE", "STDIO")
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info("Starting MCP server in {} mode on {}:{}".format(MCP_MODE, MCP_HOST, MCP_PORT))

    SERVER_NAME = os.getenv("SERVER_NAME", "AzurePowerOps")
    logging.info("*" * 40)
    logging.info("MCP Server name: {}".format(SERVER_NAME))
    logging.info("*" * 40)

    mcp = FastMCP(f"{SERVER_NAME} MCP Server")

    # Read-only component/group listing and state (Phase 1)
    mcp.tool()(status.power_list_components)

    # Power on/off actions (Phase 2) - see tools/power.py for the
    # confirm=True guard and the RBAC caveat before enabling in production.
    mcp.tool()(power.power_on)
    mcp.tool()(power.power_off)

    if MCP_MODE.lower() == "http":
        mcp.run(transport=MCP_MODE.lower(), host=MCP_HOST, port=MCP_PORT, middleware=[Middleware(MCPAuthMiddleware)])
    else:
        mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
    main()
