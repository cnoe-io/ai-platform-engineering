# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os


class HealthCheckFilter(logging.Filter):
    """Filter to suppress INFO-level logs for health check endpoints."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Filter out health check logs at INFO level."""
        # Allow DEBUG and above, but filter INFO for health checks
        if record.levelno > logging.INFO:
            return True

        # Get the log message
        message = record.getMessage()

        # Filter out health check endpoints
        health_check_paths = [
            '/.well-known/agent-card.json',
            '/healthz',
            '/health',
            '/mcp/v1',
        ]

        # Check if this is a health check log
        for path in health_check_paths:
            if path in message:
                # Check if it's a ping/health operation for MCP
                if path == '/mcp/v1' and ('ping' in message.lower() or 'health' in message.lower()):
                    return False
                elif path != '/mcp/v1':
                    return False

        # Allow all other logs
        return True


def configure_logging():
    """Configure logging to suppress noisy health check logs."""
    # Get the root logger
    root_logger = logging.getLogger()

    # Add the health check filter to all handlers
    health_check_filter = HealthCheckFilter()
    for handler in root_logger.handlers:
        handler.addFilter(health_check_filter)

    # Also configure a2a.utils.helpers logger to DEBUG (as per previous configuration)
    a2a_helpers_logger = logging.getLogger('a2a.utils.helpers')
    a2a_helpers_logger.setLevel(logging.DEBUG)
