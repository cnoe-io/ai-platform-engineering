"""Logging utilities for MAS agents.

This module provides JSON logging capabilities for structured logging
compatible with Datadog.
"""

import json
import logging
import traceback
from datetime import datetime, timezone


class HealthCheckFilter(logging.Filter):
    """Filter to exclude health check endpoints from logs."""

    def filter(self, record):
        # Filter out health check endpoints from uvicorn access logs
        if record.name == "uvicorn.access":
            message = record.getMessage()
            if "/healthz" in message or "/readyz" in message:
                return False
        return True


class JSONFormatter(logging.Formatter):
    """Custom JSON formatter for structured logging with multi-line support."""

    def __init__(self, service_name: str = "mas-agent"):
        """Initialize with optional service name."""
        super().__init__()
        self.service_name = service_name

    def format(self, record):
        # Get the basic message
        message = record.getMessage()

        # Handle exception information if present
        if record.exc_info:
            # Format the exception as a string
            exc_text = self.formatException(record.exc_info)
            # Combine message with exception info
            if message:
                message = f"{message}\n{exc_text}"
            else:
                message = exc_text

        # Handle multi-line stack traces from record.stack_info
        if getattr(record, "stack_info", None):
            if message:
                message = f"{message}\n{record.stack_info}"
            else:
                message = record.stack_info

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "service": self.service_name,
        }

        # Add exception details as separate fields if available
        if record.exc_info:
            exc_type, exc_value, exc_traceback = record.exc_info
            log_entry["exception"] = {
                "type": exc_type.__name__ if exc_type else None,
                "value": str(exc_value) if exc_value else None,
                "traceback": traceback.format_exception(exc_type, exc_value, exc_traceback),
            }

        if hasattr(record, "extra"):
            log_entry.update(record.extra)

        # Ensure JSON serialization handles newlines properly
        return json.dumps(log_entry, ensure_ascii=False, separators=(",", ":"))


def get_uvicorn_log_config(service_name: str = "mas-agent"):
    """Get uvicorn logging config that uses JSON formatting.

    Args:
        service_name: Name of the service for log entries
    """
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "()": "mas_agent_base.utils.logging.JSONFormatter",
                "service_name": service_name,
            },
        },
        "filters": {
            "health_check": {
                "()": "mas_agent_base.utils.logging.HealthCheckFilter",
            },
        },
        "handlers": {
            "json_console": {
                "formatter": "json",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "filters": ["health_check"],
            },
        },
        "loggers": {
            "uvicorn": {
                "handlers": ["json_console"],
                "level": "INFO",
                "propagate": False,
            },
            "uvicorn.error": {
                "handlers": ["json_console"],
                "level": "INFO",
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["json_console"],
                "level": "INFO",
                "propagate": False,
            },
        },
    }


def setup_json_logging(level: int = logging.INFO, service_name: str = "mas-agent") -> None:
    """
    Configure JSON logging for the application.

    Args:
        level: The minimum logging level to display (default: INFO)
        service_name: Name of the service for log entries
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add JSON formatter handler with health check filter
    handler = logging.StreamHandler()
    formatter = JSONFormatter(service_name=service_name)
    handler.setFormatter(formatter)
    handler.addFilter(HealthCheckFilter())
    root_logger.addHandler(handler)

    # Configure uvicorn logger
    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.setLevel(level)
    uvicorn_logger.handlers = []
    uvicorn_logger.addHandler(handler)
    uvicorn_logger.propagate = False

    # Configure specific loggers - including LangChain loggers for multi-line support
    loggers = [
        "uvicorn.access",
        "a2a",
        "mas_agent_base",
        "langchain",
        "langchain_core",
        "langchain.agents",
        "ddtrace",
    ]

    for logger_name in loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        # Ensure these loggers use the same handler for consistent formatting
        logger.handlers = []
        logger.addHandler(handler)
        logger.propagate = False
