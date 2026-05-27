# VictorOps AI Agent

An LLM-powered agent for managing VictorOps incidents and services using the [LangGraph ReAct Agent](https://langchain-ai.github.io/langgraph/agents/agents/) workflow and [MCP tools](https://modelcontextprotocol.io/introduction).

## Features

- CRUD operations on VictorOps incidents and services
- On-call schedule lookups
- Incident note management
- Compatible with [A2A](https://github.com/google/A2A) protocol

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VICTOROPS_API_URL` | Yes | VictorOps API base URL |
| `X_VO_API_KEY` | Yes | VictorOps API key |
| `X_VO_API_ID` | Yes | VictorOps API key ID |

For LLM configuration, see [cnoe-agent-utils](https://github.com/cnoe-io/cnoe-agent-utils#-usage).

## Getting Started

1. Copy `.env.example` to `.env` and configure your VictorOps credentials and LLM provider.
2. Run the agent:

```bash
make run-a2a
```

## License

Apache-2.0
