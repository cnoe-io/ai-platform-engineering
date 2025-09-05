# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Main entry point for the Splunk A2A server."""

import asyncio
import logging
import os
import signal
from typing import Any

import typer
from a2a.server import Server
from a2a.server.events.event_queue import InMemoryEventQueue
from agent_splunk.protocol_bindings.a2a_server.agent_executor import SplunkAgentExecutor # type: ignore[import-untyped]

app = typer.Typer()
logger = logging.getLogger(__name__)


def signal_handler(signum: int, frame: Any) -> None:
    """Handle shutdown signals gracefully."""
    logger.info(f"Received signal {signum}, shutting down gracefully...")
    raise KeyboardInterrupt


@app.command()
def main(
    host: str = typer.Option("0.0.0.0", help="Host to bind the server to"),
    port: int = typer.Option(8000, help="Port to bind the server to"),
) -> None:
    """Start the Splunk A2A server."""
    # Set up signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    logger.info(f"Starting Splunk A2A server on {host}:{port}")
    
    try:
        asyncio.run(async_main(host, port))
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
    except Exception as e:
        logger.error(f"Server failed to start: {e}")
        raise


async def async_main(host: str, port: int) -> None:
    """Async main function to start the server."""
    try:
        # Validate required environment variables
        required_vars = ["SPLUNK_TOKEN", "SPLUNK_API_URL"]
        missing_vars = [var for var in required_vars if not os.getenv(var)]
        if missing_vars:
            raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

        # Create the server components
        event_queue = InMemoryEventQueue()
        agent_executor = SplunkAgentExecutor()
        
        # Create and configure the A2A server
        server = Server(
            host=host,
            port=port,
            event_queue=event_queue,
            agent_executor=agent_executor,
        )

        logger.info("Server components initialized successfully")
        logger.info(f"Splunk A2A server starting on http://{host}:{port}")
        
        # Start the server
        await server.serve()
        
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise


if __name__ == "__main__":
    app()
