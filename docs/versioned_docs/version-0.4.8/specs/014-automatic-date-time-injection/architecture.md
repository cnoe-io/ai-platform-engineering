---
sidebar_position: 1
id: 014-automatic-date-time-injection-architecture
sidebar_label: Architecture
---

# Architecture: Automatic Date/Time Injection for All Agents

**Date**: 2025-10-27

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



## Related

- Spec: [spec.md](./spec.md)
