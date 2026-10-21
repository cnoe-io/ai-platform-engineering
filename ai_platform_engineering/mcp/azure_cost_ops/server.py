# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Azure Cost Ops MCP Server

Cost visibility and budget-alert tool for customer Azure environments,
composed the same way azure_power_ops composes its registry/runner split:
discovery-based registry (tools/registry.py) resolves a customer name or
"all" to resource groups, and tools/azure_runner.py runs a fixed `az`
command set after a lazy service-principal login. See tools/cost.py for
the known limitation on per-resource-group filtering and the deliberately
unimplemented forecast tool.
"""

import logging
import os
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware
from mcp_agent_auth.middleware import MCPAuthMiddleware

from tools import cost


def main():
    load_dotenv()

    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger("sse_starlette.sse").setLevel(logging.INFO)
    logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.INFO)

    MCP_MODE = os.getenv("MCP_MODE", "STDIO")
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info("Starting MCP server in {} mode on {}:{}".format(MCP_MODE, MCP_HOST, MCP_PORT))

    SERVER_NAME = os.getenv("SERVER_NAME", "AzureCostOps")
    logging.info("*" * 40)
    logging.info("MCP Server name: {}".format(SERVER_NAME))
    logging.info("*" * 40)

    mcp = FastMCP(f"{SERVER_NAME} MCP Server")

    # Read-only cost visibility
    mcp.tool()(cost.cost_get_current_spend)
    mcp.tool()(cost.cost_list_top_resources)

    # Budget alert creation - see tools/cost.py for the confirm=True guard.
    mcp.tool()(cost.cost_set_budget_alert)

    if MCP_MODE.lower() == "http":
        mcp.run(transport=MCP_MODE.lower(), host=MCP_HOST, port=MCP_PORT, middleware=[Middleware(MCPAuthMiddleware)])
    else:
        mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
    main()
