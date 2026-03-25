# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Process-wide reference to the active supervisor MAS for skills refresh (FR-012)."""

from __future__ import annotations

from typing import Any

_mas_instance: Any = None


def set_mas_instance(mas: Any) -> None:
    """Register the running ``AIPlatformEngineerMAS`` (e.g. from FastAPI startup)."""
    global _mas_instance
    _mas_instance = mas


def get_mas_instance() -> Any:
    """Return the registered MAS, or ``None`` if not set."""
    return _mas_instance
