# Agents with Enhanced Date Handling

**Status**: 🟢 In-use (Part of consolidated date handling feature)
**Category**: Features & Enhancements
**Date**: October 27, 2025 (Consolidated into 2025-11-05-date-handling.md)

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

