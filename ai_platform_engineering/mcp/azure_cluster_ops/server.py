# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Azure Cluster Ops MCP Server

Cluster visibility and node-pool scaling for customer AKS clusters,
composed the same way azure_power_ops and azure_cost_ops compose their
registry/runner split: discovery-based registry (tools/registry.py)
resolves a customer name or "all" to AKS cluster(s), and
tools/azure_runner.py runs a fixed `az` command set after a lazy
service-principal login. See tools/cluster.py for the confirm=True guard
on the only write tool, and README.md for what's deliberately out of
scope (power on/off, Kubernetes version upgrades).
"""

import logging
import os
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware
from mcp_agent_auth.middleware import MCPAuthMiddleware

from tools import cluster


def main():
    load_dotenv()

    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger("sse_starlette.sse").setLevel(logging.INFO)
    logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.INFO)

    MCP_MODE = os.getenv("MCP_MODE", "STDIO")
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info("Starting MCP server in {} mode on {}:{}".format(MCP_MODE, MCP_HOST, MCP_PORT))

    SERVER_NAME = os.getenv("SERVER_NAME", "AzureClusterOps")
    logging.info("*" * 40)
    logging.info("MCP Server name: {}".format(SERVER_NAME))
    logging.info("*" * 40)

    mcp = FastMCP(f"{SERVER_NAME} MCP Server")

    # Read-only cluster/node-pool visibility
    mcp.tool()(cluster.cluster_get_status)
    mcp.tool()(cluster.cluster_list_node_pools)

    # Node pool scaling - see tools/cluster.py for the confirm=True guard.
    mcp.tool()(cluster.cluster_scale_node_pool)

    if MCP_MODE.lower() == "http":
        mcp.run(transport=MCP_MODE.lower(), host=MCP_HOST, port=MCP_PORT, middleware=[Middleware(MCPAuthMiddleware)])
    else:
        mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
    main()
