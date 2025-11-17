# Date Handling in AI Platform Engineering Agents

**Status**: 🟢 In-use (Part of consolidated date handling feature)
**Category**: Features & Enhancements
**Date**: October 27, 2025 (Consolidated into 2025-11-05-date-handling.md)

This guide explains how agents automatically receive current date/time context and how to properly handle date-related queries.

## Automatic Date Injection

All agents using `BaseLangGraphAgent` automatically receive the current date and time in their system prompt. This happens in the `_get_system_instruction_with_date()` method, which prepends date context before the agent's custom system instruction.

### What Gets Injected

Every agent automatically receives:

```
## Current Date and Time

Today's date: Sunday, October 26, 2025
Current time: 15:30:45 UTC
ISO format: 2025-10-26T15:30:45+00:00

Use this as the reference point for all date calculations. When users say "today", "tomorrow", "yesterday", or other relative dates, calculate from this date.
```

### Benefits

1. **No Tool Calls Needed**: Agents don't need to call an external tool to get the current date
2. **Reduced Latency**: Date information is immediately available in the prompt
3. **Consistent Behavior**: All agents automatically have temporal awareness
4. **Simple Implementation**: Works for all agents inheriting from `BaseLangGraphAgent`

## Enabling Date Handling Guidelines for Specific Agents

For agents that frequently work with dates (e.g., PagerDuty, Jira, incident management), enable additional date handling guidelines:

```python
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction

SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
    service_name="PagerDuty",
    service_operations="get information about incidents, services, and schedules",
    additional_guidelines=[
        "When querying incidents or on-call schedules, calculate date ranges based on the current date provided above",
        "Always convert relative dates (today, tomorrow, this week) to absolute dates in YYYY-MM-DD format before calling API tools"
    ],
    include_error_handling=True,
    include_date_handling=True  # <-- Enable date handling guidelines
)
```

When `include_date_handling=True`, the agent receives these additional instructions:

- "The current date and time are provided at the top of these instructions"
- "Use the provided current date as the reference point for all date calculations"
- "For queries involving 'today', 'tomorrow', 'yesterday', or other relative dates, calculate from the provided current date"
- "Convert relative dates to absolute dates (YYYY-MM-DD format) before calling API tools"

## Example: PagerDuty Agent with Date Handling

```python
# ai_platform_engineering/agents/pagerduty/agent_pagerduty/protocol_bindings/a2a_server/agent.py

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction

class PagerDutyAgent(BaseLangGraphAgent):
    """PagerDuty Agent for incident and schedule management."""

    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="PagerDuty",
        service_operations="get information about incidents, services, and schedules",
        additional_guidelines=[
            "Perform actions like creating, updating, or resolving incidents",
            "When querying incidents or on-call schedules, calculate date ranges based on the current date provided above",
            "Always convert relative dates (today, tomorrow, this week) to absolute dates in YYYY-MM-DD format before calling API tools"
        ],
        include_error_handling=True,
        include_date_handling=True  # Enable date handling guidelines
    )
```

## How It Works

### 1. Agent Initialization

When an agent is initialized, the graph is created with the date-enhanced prompt:

```python
# In BaseLangGraphAgent._setup_mcp_and_graph()
self.graph = create_react_agent(
    self.model,
    tools,
    checkpointer=memory,
    prompt=self._get_system_instruction_with_date(),  # <-- Uses date-enhanced prompt
    response_format=(
        self.get_response_format_instruction(),
        self.get_response_format_class()
    ),
)
```

### 2. Date Context Generation

The `_get_system_instruction_with_date()` method:
- Gets the current UTC time
- Formats it in multiple ways (human-readable, ISO 8601)
- Prepends it to the agent's system instruction

### 3. LLM Processing

When the LLM receives a query like "show me incidents from today", it:
1. Sees the current date at the top of the system prompt
2. Calculates that "today" means "2025-10-26"
3. Calls the API with `since=2025-10-26T00:00:00Z`

## Common Date Query Patterns

### Today
- User: "Show me incidents from today"
- Agent calculates: `2025-10-26`
- API call: `since=2025-10-26T00:00:00Z&until=2025-10-26T23:59:59Z`

### Yesterday
- User: "Who was on-call yesterday?"
- Agent calculates: `2025-10-25`
- API call: `since=2025-10-25T00:00:00Z&until=2025-10-25T23:59:59Z`

### Last Week
- User: "Show incidents from last week"
- Agent calculates: Previous Sunday to Saturday
- API call: `since=2025-10-20T00:00:00Z&until=2025-10-26T23:59:59Z`

### Tomorrow
- User: "Who is on-call tomorrow?"
- Agent calculates: `2025-10-27`
- API call: `since=2025-10-27T00:00:00Z&until=2025-10-27T23:59:59Z`

## Custom Date Handling

If you need custom date handling logic, you can:

1. **Override** `_get_system_instruction_with_date()` in your agent class
2. **Add** timezone-specific logic
3. **Include** additional temporal context

Example:

```python
class MyCustomAgent(BaseLangGraphAgent):
    def _get_system_instruction_with_date(self) -> str:
        """Custom date injection with timezone support."""
        now_utc = datetime.now(ZoneInfo("UTC"))
        now_local = datetime.now(ZoneInfo("America/New_York"))

        date_context = f"""## Current Date and Time

UTC: {now_utc.strftime("%A, %B %d, %Y %H:%M:%S")}
Local (America/New_York): {now_local.strftime("%A, %B %d, %Y %H:%M:%S")}

"""
        return date_context + self.get_system_instruction()
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

## Troubleshooting

### Agent Not Using Current Date

**Problem**: Agent seems to use incorrect dates or doesn't understand "today"

**Solution**:
1. Verify agent inherits from `BaseLangGraphAgent`
2. Check that `include_date_handling=True` if needed
3. Review agent logs to see the actual system prompt being used

### Timezone Issues

**Problem**: Dates are off by hours or days

**Solution**:
- Current implementation uses UTC by default
- Override `_get_system_instruction_with_date()` to add timezone-specific context
- Ensure API calls use UTC timestamps or specify timezone explicitly

### Date Format Mismatches

**Problem**: API rejects date format

**Solution**:
- Add explicit format instructions in `additional_guidelines`
- Example: "Always use ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ"

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

## Future Enhancements

Potential improvements for date handling:

1. **User Timezone Detection**: Detect user's timezone from request headers
2. **Multi-Timezone Support**: Show times in multiple timezones simultaneously
3. **Natural Language Date Parsing**: Enhanced parsing of complex date expressions
4. **Date Range Validation**: Validate date ranges before API calls
5. **Caching**: Cache date calculations to avoid repetitive computations




