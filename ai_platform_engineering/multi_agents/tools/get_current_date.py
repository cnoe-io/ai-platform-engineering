# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Current Date/Time Tool

Provides fresh, real-time date and time information for each request.
Use this tool when handling queries that involve dates, times, or relative time periods.
"""

from langchain_core.tools import tool
from datetime import datetime
from zoneinfo import ZoneInfo


@tool
def get_current_date() -> str:
    """Get the current date and time in ISO 8601 format.

    Use this tool when handling queries that involve dates, times, or relative time periods
    (e.g., "today", "yesterday", "last week", "this month").

    Returns:
        Current date and time in ISO 8601 format (YYYY-MM-DDTHH:MM:SS+00:00)
    """
    # Get current date/time in UTC
    now_utc = datetime.now(ZoneInfo("UTC"))

    # Return ISO 8601 format
    return now_utc.isoformat()


# Export for use in agent tool lists
__all__ = ['get_current_date']

