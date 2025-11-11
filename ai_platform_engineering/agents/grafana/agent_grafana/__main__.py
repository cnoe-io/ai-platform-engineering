# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Main entry point for Grafana Agent A2A server."""

import asyncio
import logging
import os
import sys

# Configure logging early
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Suppress noisy loggers in development
if os.getenv("DD_ENV") == "development":
    for logger_name in [
        "ddtrace.internal.remoteconfig.worker",
        "ddtrace.internal.flare._subscribers",
        "ddtrace.internal",
        "ddtrace",
        "httpx",
        "mcp.server",
        "mcp.client",
    ]:
        logging.getLogger(logger_name).setLevel(logging.WARNING)

from ai_platform_engineering.agents.grafana.agent_grafana.protocol_bindings.a2a_server.agent import GrafanaAgent

logger = logging.getLogger(__name__)


async def main():
    """Main entry point."""
    try:
        logger.info("Starting Grafana Agent A2A Server...")
        logger.info("Using official Grafana MCP server via MCP_HOST service")

        # Initialize agent
        _agent = GrafanaAgent()  # noqa: F841
        logger.info("Grafana Agent initialized successfully")

        # Start A2A server (implementation depends on A2A SDK)
        # This would typically involve setting up FastAPI/uvicorn with A2A endpoints
        # TODO: Implement A2A server startup

        # For now, keep the process running
        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        logger.info("Shutting down Grafana Agent...")
    except Exception as e:
        logger.error(f"Error starting Grafana Agent: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
