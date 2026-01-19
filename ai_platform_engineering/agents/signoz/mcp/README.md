# SigNoz MCP Server

MCP (Model Context Protocol) server for SigNoz observability platform.

## Features

- Query distributed traces
- Query metrics (PromQL)
- Query logs
- Manage dashboards
- Manage alert rules
- View service dependencies

## Usage

```bash
mcp-signoz
```

## Environment Variables

- `SIGNOZ_API_URL`: SigNoz API URL (default: http://localhost:3301)
- `SIGNOZ_API_KEY`: SigNoz API key (optional)
