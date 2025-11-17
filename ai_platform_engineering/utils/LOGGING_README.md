# Logging Configuration

## Health Check Log Filtering

To reduce log noise from health check endpoints while maintaining useful logging information, we've implemented a custom logging filter.

### What it does

The `HealthCheckFilter` in `logging_config.py` suppresses INFO-level logs for:
- Agent card endpoints: `/.well-known/agent-card.json`
- Health check endpoints: `/healthz`, `/health`
- MCP health checks: `/mcp/v1` with ping/health operations

These logs will still appear if DEBUG logging is enabled.

### Usage

Add this line early in your application startup (after `load_dotenv()` but before starting the server):

```python
from ai_platform_engineering.utils.logging_config import configure_logging

configure_logging()
```

### Example

Before:
```
INFO:     127.0.0.1:58368 - "GET /.well-known/agent-card.json HTTP/1.1" 200 OK
INFO:     127.0.0.1:58368 - "GET /.well-known/agent-card.json HTTP/1.1" 200 OK
INFO:     127.0.0.1:58368 - "GET /.well-known/agent-card.json HTTP/1.1" 200 OK
```

After:
```
(no output at INFO level, but visible with DEBUG logging enabled)
```

### Implementation Status

Currently configured in all sub-agents:
- argocd, backstage, confluence, github, jira, komodor, pagerduty, slack, splunk, weather, webex, petstore/template
- AWS agent
- Platform Engineer (main.py)

To add to new agents, import and call `configure_logging()` after `load_dotenv()` in the agent's main module.

