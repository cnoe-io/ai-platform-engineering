# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging

logging.basicConfig(level=logging.INFO)

from mcp_kubernetes.server import mcp


def main():
    """Run the Kubernetes MCP Server."""
    logging.info("Starting Kubernetes MCP Server...")
    mcp.run()


if __name__ == "__main__":
    main()
