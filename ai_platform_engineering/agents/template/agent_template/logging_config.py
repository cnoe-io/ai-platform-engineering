# SPDX-License-Identifier: Apache-2.0

"""logging_configuration.py
==========================
A **self‑contained, dependency‑free** (aside from the optional
``coloredlogs`` package) helper that gives any Python project
production‑ready logging in a single import.

Why use it?
-----------
* **Consistent formatting** across libraries & your own code.
* **Structured JSON** output for log aggregation platforms *or*
  **colourised human‑friendly** output for local debugging – selectable at
  runtime.
* **Zero boilerplate** – call :pyfunc:`get_logger` and start logging.
* **Drop‑in** for CLI tools, web frameworks (FastAPI / Django / Flask),
  serverless functions, and background jobs.

Quick‑start
~~~~~~~~~~~
```python
from logging_configuration import get_logger

log = get_logger(__name__)
log.info("Hello, world!")
```
With no environment variables set, messages appear on ``stdout`` using a
colourised format at ``INFO`` level.

Environment Variables
---------------------
The behaviour can be tweaked entirely via environment variables – no code
changes required.

============================== =================== ============================================
Variable                       Example             Purpose / Effect
============================== =================== ============================================
``LOG_LEVEL``                  ``"DEBUG"``         Root log level (default: ``INFO``)
``LOG_FORMATTER``              ``"json"``          ``"json"`` or ``"colored"`` (default)
``LOG_TO_FILE``                ``"1"``             Write JSON logs to *logs/application.log*
``LOGCONF_AUTO_CONFIGURE_LOGGING`` ``"0"``         **Disable** auto‑configuration on import
``HTTP_CLIENT_DEBUG``          ``"1"``             Enable verbose ``http.client`` wire‑logging
============================== =================== ============================================

Usage patterns
--------------
**1. Application entry‑point** (recommended) – explicit configuration::

    import logging_configuration as logconf

    logconf.configure_logging()  # configure as early as possible
    logger = logconf.get_logger(__name__)

**2. Library / reusable package** – rely on auto‑configuration::

    from logging_configuration import get_logger

    log = get_logger(__name__)
    log.debug("Library initialised")

Advanced configuration
~~~~~~~~~~~~~~~~~~~~~~
* **File logging** – set ``LOG_TO_FILE=1`` to mirror JSON logs to
  *logs/application.log* (rotated on every start‑up).
* **Disable colour** – choose ``LOG_FORMATTER=json`` or pipe output to a
  file; colour codes are suppressed automatically when ``isatty`` is
  ``False``.
* **HTTP debugging** – set ``HTTP_CLIENT_DEBUG=1`` to dump full request &
  response bodies via the standard library's ``http.client`` module.

API Reference
-------------
.. autofunction:: configure_logging
.. autofunction:: get_logger
"""
from __future__ import annotations

import json
import logging
import logging.config
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Final, Mapping

import coloredlogs

__all__: list[str] = ["configure_logging", "get_logger"]

# ---------------------------------------------------------------------------
# Optional: verbose HTTP client debugging
# ---------------------------------------------------------------------------
if os.getenv("HTTP_CLIENT_DEBUG", "0") == "1":
    import http.client as _http_client  # pylint: disable=import-error

    _http_client.HTTPConnection.debuglevel = 1  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Custom JSON formatter
# ---------------------------------------------------------------------------
class JSONFormatter(logging.Formatter):
    """Format :class:`logging.LogRecord` instances as JSON.

    The formatter adds a UTC ISO‑8601 ``timestamp`` field and, when
    ``exc_info`` is present, an ``error`` object containing type, message
    and stack trace. This structure is compatible with most log
    aggregation back‑ends (ELK, Loki, Datadog, etc.).
    """

    default_time_format: Final = "%Y-%m-%dT%H:%M:%S.%fZ"

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:  # noqa: N802
        """Return an ISO‑8601 timestamp in **UTC** with millisecond precision."""
        return (
            datetime.fromtimestamp(record.created, tz=timezone.utc)
            .strftime(datefmt or self.default_time_format)
            .rstrip("0Z")
            + "Z"
        )

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        """Return the log record serialised as a JSON string."""
        log_data: dict[str, object] = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "logger": record.name,
            "pid": record.process,
            "thread": record.threadName,
        }

        if record.exc_info:
            log_data["error"] = {
                "type": str(record.exc_info[0]),
                "message": str(record.exc_info[1]),
                "stack_trace": traceback.format_exc(),
            }

        return json.dumps(log_data, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _log_dir() -> Path:
    """Return *logs/* directory path, creating it if required."""
    path = Path(__file__).resolve().parent.parent / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _log_file() -> Path:
    """Return *logs/application.log* and remove stale file on start‑up."""
    log_file = _log_dir() / "application.log"
    if log_file.exists():
        log_file.unlink(missing_ok=True)
    return log_file


def _log_level() -> str:
    """Resolve log level from ``LOG_LEVEL`` (defaults to *INFO*)."""
    return os.getenv("LOG_LEVEL", "INFO").upper()


def _build_config(log_file: Path | None, log_level: str) -> Mapping[str, object]:
    """Construct a ``logging.dictConfig`` mapping.

    The mapping defines two formatters (JSON & coloured), a console handler
    and an optional file handler, then applies them to common library
    loggers plus the application root.
    """
    formatter_choice = os.getenv("LOG_FORMATTER", "colored").lower()
    if formatter_choice not in {"json", "colored"}:
        formatter_choice = "colored"

    handlers: dict[str, dict[str, object]] = {
        "console": {
            "class": "logging.StreamHandler",
            "level": log_level,
            "formatter": formatter_choice,
        }
    }

    if log_file and os.getenv("LOG_TO_FILE", "0") == "1":
        handlers["file"] = {
            "class": "logging.FileHandler",
            "level": log_level,
            "filename": str(log_file),
            "formatter": "json",
        }

    common_handler_names = list(handlers.keys())

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {"()": JSONFormatter},
            "colored": {
                "format": "%(asctime)s [%(name)s] [%(levelname)s] "
                "[%(funcName)s:%(lineno)d] %(message)s",
            },
        },
        "handlers": handlers,
        "loggers": {
            "uvicorn": {"handlers": common_handler_names, "level": log_level, "propagate": False},
            "fastapi": {"handlers": common_handler_names, "level": log_level, "propagate": False},
            "app": {"handlers": common_handler_names, "level": log_level, "propagate": False},
            "requests.packages.urllib3": {"handlers": ["console"], "level": log_level, "propagate": True},
        },
        "root": {"handlers": common_handler_names, "level": log_level},
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def configure_logging(*, install_coloredlogs: bool = True) -> None:
    """Configure global logging based on environment variables.

    Should be invoked **once** at the very start of your program.  If you
    import :pyfunc:`get_logger` without having called this function, a
    safe, default configuration will be applied automatically.

    Parameters
    ----------
    install_coloredlogs:
        When *True* (default) and the chosen formatter is *colored*,
        installs the `coloredlogs` handler to improve readability in a
        terminal.  Set to *False* if your application already installs its
        own rich formatter.
    """
    log_file = _log_file() if os.getenv("LOG_TO_FILE", "0") == "1" else None
    log_level = _log_level()

    logging.config.dictConfig(_build_config(log_file, log_level))

    if install_coloredlogs and os.getenv("LOG_FORMATTER", "colored").lower() != "json":
        coloredlogs.install(
            level=log_level,
            fmt="%(asctime)s [%(name)s] [%(levelname)s] [%(funcName)s:%(lineno)d] %(message)s",
        )

    logging.getLogger(__name__).debug("Logging configured (level=%s, file=%s)", log_level, log_file)


def get_logger(name: str | None = None) -> logging.Logger:
    """Return a logger with the given *name*.

    If logging has not yet been configured, this function performs a lazy
    call to :pyfunc:`configure_logging` using default settings.  This makes
    the helper safe to use inside third‑party libraries.
    """
    if not logging.getLogger().handlers:
        configure_logging()
    return logging.getLogger(name or "app")


# ---------------------------------------------------------------------------
# Auto‑configure on import (can be disabled)
# ---------------------------------------------------------------------------
if os.getenv("LOGCONF_AUTO_CONFIGURE_LOGGING", "1") == "1":
  configure_logging()