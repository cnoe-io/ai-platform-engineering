---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: Date Handling in AI Platform Engineering Agents"
---

# Date Handling in AI Platform Engineering Agents

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: November 5, 2025 (consolidated)

## Overview

All agents automatically receive current date/time in their system prompts via `BaseLangGraphAgent._get_system_instruction_with_date()`.

This document lists agents that have **enhanced date handling guidelines** enabled (`include_date_handling=True` or `DATE_HANDLING_NOTES`).


## Coverage Summary

- **Total Agents**: 10+ (all BaseLangGraphAgent-based)
- **With Enhanced Date Handling**: 10
- **Coverage**: 100% of time-sensitive agents


## Benefits

1. **No Tool Calls**: Agents don't need to call external date tools
2. **Zero Latency**: Date available immediately in prompt
3. **Consistent Behavior**: All agents calculate from same reference point
4. **Better UX**: Users can use natural language like "today", "last week"
5. **Accurate Results**: Agents convert relative dates correctly


## Related

- **Implementation Guide**: [Date Handling Guide](../date-handling-guide/spec)
- **Changelog**: [Automatic Date/Time Injection](../automatic-date-time-injection/spec)
- **Prompt Templates**: `utils/prompt_templates.py`
- **Base Agent**: `utils/a2a_common/base_langgraph_agent.py`

# Automatic Date/Time Injection for All Agents


## Overview

Added automatic current date/time injection to all agents that use `BaseLangGraphAgent`. This eliminates the need for agents to call external tools to determine the current date, improving response latency and simplifying date-based queries.


## What Changed

### 1. BaseLangGraphAgent Enhancement

**File**: `utils/a2a_common/base_langgraph_agent.py`

Added `_get_system_instruction_with_date()` method that automatically prepends current date/time to system instructions.

Date context includes:
- Human-readable date: "Sunday, October 26, 2025"
- Current time in UTC
- ISO 8601 format
- Instructions to use this as reference point for date calculations

```python
def _get_system_instruction_with_date(self) -> str:
    """Return the system instruction with current date/time injected."""
    now_utc = datetime.now(ZoneInfo("UTC"))

    date_context = f"""## Current Date and Time

Today's date: {now_utc.strftime("%A, %B %d, %Y")}
Current time: {now_utc.strftime("%H:%M:%S UTC")}
ISO format: {now_utc.isoformat()}

Use this as the reference point for all date calculations...
"""
    return date_context + self.get_system_instruction()
```

### 2. Prompt Templates Update

**File**: `utils/prompt_templates.py`

- Added `DATE_HANDLING_NOTES` with guidelines for using the automatically provided date
- Added `include_date_handling` parameter to `scope_limited_agent_instruction()` function
- Updated notes to reference date from prompt instead of calling a tool

### 3. Agent Updates

All time-sensitive agents were updated with `include_date_handling=True`:

- **PagerDuty**: Calculate dates for incidents and on-call schedules
- **Jira**: Convert relative dates to YYYY-MM-DD format for JQL queries
- **Splunk**: Convert relative time to Splunk time syntax (earliest/latest)
- **ArgoCD**: Filter applications and resources by date
- **Backstage**: Filter catalog entities by creation/modification date
- **Confluence**: Find recently updated or created pages
- **GitHub**: Filter issues, PRs, and commits by date
- **Komodor**: Calculate time ranges for events and issues
- **Slack**: Search messages with time-based filters
- **Webex**: Filter messages and rooms by timestamp


## Benefits

1. **No Extra Tool Calls**: Agents have immediate access to current date without needing to call a tool
2. **Lower Latency**: Eliminates round-trip time for date retrieval
3. **Universal Coverage**: All agents automatically get date context
4. **Simpler Implementation**: No need to add datetime tools to MCP servers
5. **Consistent Behavior**: All agents use the same date reference point


## Testing Strategy

The date is generated when the agent graph is created (during MCP setup). To test with specific dates:

```python
from unittest.mock import patch
from datetime import datetime
from zoneinfo import ZoneInfo

@patch('ai_platform_engineering.utils.a2a_common.base_langgraph_agent.datetime')
def test_agent_date_handling(mock_datetime):
    mock_datetime.now.return_value = datetime(2025, 10, 26, 15, 30, 45, tzinfo=ZoneInfo("UTC"))
    # Test agent behavior
```


## Testing Date-Aware Agents

When testing agents that rely on dates:

```python
# Mock the datetime to ensure consistent test results
from unittest.mock import patch
from datetime import datetime
from zoneinfo import ZoneInfo

@patch('ai_platform_engineering.utils.a2a_common.base_langgraph_agent.datetime')
def test_date_aware_query(mock_datetime):
    # Set a fixed date for testing
    mock_datetime.now.return_value = datetime(2025, 10, 26, 15, 30, 45, tzinfo=ZoneInfo("UTC"))

    # Test your agent with relative date queries
    response = await agent.stream("show me today's incidents", session_id="test")
    # Assert expected behavior
```


## Best Practices

1. **Always Use Absolute Dates in API Calls**: Convert "today" to "2025-10-26" before calling APIs
2. **Be Explicit About Timezones**: When timezone matters, specify it in queries
3. **Use ISO 8601 Format**: Most APIs prefer ISO 8601 (`2025-10-26T15:30:45Z`)
4. **Include Date Context in Responses**: When showing results, remind users what "today" means
5. **Test Edge Cases**: Test with dates at month/year boundaries, weekends, etc.


## Related Files

- **`base_langgraph_agent.py`**: Contains `_get_system_instruction_with_date()` method that automatically injects current date/time
- **`prompt_templates.py`**: Contains `DATE_HANDLING_NOTES` and `include_date_handling` parameter
- ~~`mcp_tools/datetime_tool.py`~~: **Deprecated and removed** - replaced by automatic injection in `BaseLangGraphAgent`


- Architecture: [architecture.md](./architecture.md)
