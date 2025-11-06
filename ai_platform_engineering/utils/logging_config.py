# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Logging configuration utilities for reducing noise from health check endpoints.
"""

import logging
import re


class HealthCheckFilter(logging.Filter):
    """
    Filter that downgrades health check and agent-card endpoint logs to DEBUG level.

    This prevents noisy INFO-level logs from uvicorn access logger for health checks
    while still allowing them to be visible when DEBUG logging is enabled.
    """

    # Patterns for health check endpoints
    HEALTH_PATTERNS = [
        r'GET\s+/\.well-known/agent-card\.json',
        r'GET\s+/healthz',
        r'GET\s+/health\b',
        r'POST\s+/mcp/v1.*\b(ping|health)',
    ]

    def __init__(self, name=''):
        super().__init__(name)
        self.health_regex = re.compile('|'.join(self.HEALTH_PATTERNS), re.IGNORECASE)

    def filter(self, record: logging.LogRecord) -> bool:
        """
        Return False to filter out (suppress) INFO-level health check logs.
        DEBUG-level logs will still pass through if DEBUG logging is enabled.
        """
        # Only filter INFO level logs
        if record.levelno != logging.INFO:
            return True

        # Check if the message matches health check patterns
        message = record.getMessage()
        if self.health_regex.search(message):
            # Downgrade to DEBUG by preventing INFO-level logging
            return False

        return True


def configure_logging():
    """
    Configure logging to suppress health check endpoint logs at INFO level.

    Call this early in your application startup (after basic logging setup).
    """
    # Add filter to uvicorn access logger
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.addFilter(HealthCheckFilter())

    # Also filter uvicorn.error logger which may log similar messages
    error_logger = logging.getLogger("uvicorn.error")
    error_logger.addFilter(HealthCheckFilter())

    # Filter FastAPI/Starlette access logs
    starlette_logger = logging.getLogger("starlette.access")
    starlette_logger.addFilter(HealthCheckFilter())

