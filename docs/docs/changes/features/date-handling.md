# Agents with Enhanced Date Handling

## Overview

All agents automatically receive current date/time in their system prompts via `BaseLangGraphAgent._get_system_instruction_with_date()`.

This document lists agents that have **enhanced date handling guidelines** enabled (`include_date_handling=True` or `DATE_HANDLING_NOTES`).

## Agents with Enhanced Date Handling

### 1. PagerDuty

- **File**: `agents/pagerduty/agent_pagerduty/protocol_bindings/a2a_server/agent.py`
- **Why**: Incident management, on-call schedules - heavily date-dependent
- **Guidelines**: Calculate date ranges for incidents and on-call queries

### 2. Jira

- **File**: `agents/jira/agent_jira/protocol_bindings/a2a_server/agent.py`
- **Why**: Issue tracking with created/updated/resolved dates
- **Guidelines**: Convert relative dates to YYYY-MM-DD format for JQL queries

### 3. Splunk

- **File**: `agents/splunk/agent_splunk/protocol_bindings/a2a_server/agent.py`
- **Why**: Log searches always require time ranges
- **Guidelines**: Convert relative time to Splunk time syntax (earliest/latest parameters)

### 4. ArgoCD

- **File**: `agents/argocd/agent_argocd/protocol_bindings/a2a_server/agent.py`
- **Why**: Application deployments and sync status queries by date
- **Guidelines**: Use current date for filtering applications and resources

### 5. Backstage

- **File**: `agents/backstage/agent_backstage/protocol_bindings/a2a_server/agent.py`
- **Why**: Catalog entity searches and filtering
- **Guidelines**: Filter catalog entities by creation/modification date

### 6. Confluence

- **File**: `agents/confluence/agent_confluence/protocol_bindings/a2a_server/agent.py`
- **Why**: Document searches by creation/modification date
- **Guidelines**: Find recently updated or created pages

### 7. GitHub

- **File**: `agents/github/agent_github/protocol_bindings/a2a_server/agent.py`
- **Why**: Issues, PRs, and commits often filtered by date
- **Guidelines**: Filter GitHub resources using current date as reference

### 8. Komodor

- **File**: `agents/komodor/agent_komodor/protocol_bindings/a2a_server/agent.py`
- **Why**: Kubernetes events, audit logs, and issues with time ranges
- **Guidelines**: Calculate time ranges for "today's issues" or "last hour's events"

### 9. Slack

- **File**: `agents/slack/agent_slack/protocol_bindings/a2a_server/agent.py`
- **Why**: Message history searches by time
- **Guidelines**: Search messages with time-based filters

### 10. Webex

- **File**: `agents/webex/agent_webex/protocol_bindings/a2a_server/agent.py`
- **Why**: Message and room searches by time
- **Guidelines**: Filter messages and rooms by timestamp

## How It Works

### Automatic Date Injection (ALL Agents)

Every agent sees this at the start of their system prompt:

```
## Current Date and Time

Today's date: Sunday, October 26, 2025
Current time: 15:30:45 UTC
ISO format: 2025-10-26T15:30:45+00:00

Use this as the reference point for all date calculations...
```

### Enhanced Guidelines (Enabled Agents)

When `include_date_handling=True` is set, agents also receive:

```
## Important Notes

- The current date and time are provided at the top of these instructions
- Use the provided current date as the reference point for all date calculations
- For queries involving 'today', 'tomorrow', 'yesterday', or other relative dates, calculate from the provided current date
- Convert relative dates to absolute dates (YYYY-MM-DD format) before calling API tools
```

Plus service-specific guidelines in `additional_guidelines`.

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

## Example Queries

### PagerDuty
- "Show me incidents from today"
- "Who is on-call tomorrow?"
- "List all incidents from last week"

### Jira
- "Show issues created this week"
- "Find bugs resolved yesterday"
- "Issues updated in the last 7 days"

### Splunk
- "Search logs from the last hour"
- "Show errors from today"
- "Find warnings from last 24 hours"

### GitHub
- "Show PRs merged today"
- "Find issues created this month"
- "Recent commits from this week"

## Adding to New Agents

To enable enhanced date handling for a new agent:

```python
SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
    service_name="MyService",
    service_operations="manage time-sensitive operations",
    additional_guidelines=[
        "Your service-specific guidelines here",
        "When filtering by date, use current date provided above"
    ],
    include_error_handling=True,
    include_date_handling=True  # <-- Add this line
)
```

Or for agents using `build_system_instruction`:

```python
from ai_platform_engineering.utils.prompt_templates import DATE_HANDLING_NOTES

SYSTEM_INSTRUCTION = build_system_instruction(
    agent_name="MY AGENT",
    agent_purpose="...",
    response_guidelines=[...],
    important_notes=DATE_HANDLING_NOTES,  # <-- Add this
    graceful_error_handling=graceful_error_handling_template("MyService")
)
```

## Related Documentation

- **Implementation Guide**: [Date Handling Guide](./2025-10-27-date-handling-guide.md)
- **Changelog**: [Automatic Date/Time Injection](./2025-10-27-automatic-date-time-injection.md)
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

## Example Usage

### Before (Would have required adding a tool):
```
User: "Show me incidents from today"
Agent: [Would need to call a get_current_datetime tool first]
Agent: [Would receive 2025-10-26]
Agent: [Would then call get_incidents with since=2025-10-26]
```

### After (Automatic Injection):
```
User: "Show me incidents from today"
Agent: [Uses date/time auto-injected in system prompt: October 26, 2025]
Agent: [Directly calls get_incidents with since=2025-10-26]
```

## How to Enable for Time-Sensitive Agents

For agents that frequently handle date-based queries:

```python
SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
    service_name="MyService",
    service_operations="manage time-sensitive operations",
    include_date_handling=True  # <-- Add this
)
```

Or for agents using `build_system_instruction`:

```python
from ai_platform_engineering.utils.prompt_templates import DATE_HANDLING_NOTES

SYSTEM_INSTRUCTION = build_system_instruction(
    agent_name="MY AGENT",
    agent_purpose="...",
    response_guidelines=[...],
    important_notes=DATE_HANDLING_NOTES,  # <-- Add this
    graceful_error_handling=graceful_error_handling_template("MyService")
)
```

## Example Queries

### PagerDuty
- "Show me incidents from today"
- "Who is on-call tomorrow?"
- "List all incidents from last week"

### Jira
- "Show issues created this week"
- "Find bugs resolved yesterday"
- "Issues updated in the last 7 days"

### Splunk
- "Search logs from the last hour"
- "Show errors from today"
- "Find warnings from last 24 hours"

### GitHub
- "Show PRs merged today"
- "Find issues created this month"
- "Recent commits from this week"

## Testing

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

## Future Enhancements

Potential improvements:
- User timezone detection from request headers
- Multi-timezone display
- Date range validation
- Enhanced natural language date parsing

## Files Modified

- `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
- `ai_platform_engineering/utils/prompt_templates.py`
- `ai_platform_engineering/agents/pagerduty/agent_pagerduty/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/jira/agent_jira/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/splunk/agent_splunk/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/argocd/agent_argocd/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/backstage/agent_backstage/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/confluence/agent_confluence/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/github/agent_github/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/komodor/agent_komodor/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/slack/agent_slack/protocol_bindings/a2a_server/agent.py`
- `ai_platform_engineering/agents/webex/agent_webex/protocol_bindings/a2a_server/agent.py`

## Migration Notes

No migration needed! This feature is:
- ✅ Backward compatible
- ✅ Automatically enabled for all agents
- ✅ Non-breaking change
- ✅ Optional enhanced guidelines via `include_date_handling=True`

Existing agents will automatically benefit from this feature without any code changes.

# Date Handling in AI Platform Engineering Agents

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




