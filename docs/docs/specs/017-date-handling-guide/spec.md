---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-27: Date Handling in AI Platform Engineering Agents"
---

# Date Handling in AI Platform Engineering Agents

**Status**: 🟢 In-use (Part of consolidated date handling feature)
**Category**: Features & Enhancements
**Date**: October 27, 2025 (Consolidated into 2025-11-05-date-handling.md)

This guide explains how agents automatically receive current date/time context and how to properly handle date-related queries.

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


## Related

- Architecture: [architecture.md](./architecture.md)
