# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
import os

logging.basicConfig(level=logging.INFO)

from mcp_kubernetes.server import mcp

# Get MCP mode from environment
MCP_MODE = os.getenv("MCP_MODE", "stdio")


def main():
    """Run the Kubernetes MCP Server."""
    logging.info(f"Starting Kubernetes MCP Server with transport: {MCP_MODE.lower()}")
    mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
    main()
