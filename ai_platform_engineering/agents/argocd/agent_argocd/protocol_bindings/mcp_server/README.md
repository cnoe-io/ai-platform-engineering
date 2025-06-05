# 🧠 Argocd MCP Server

This module implements the **MCP protocol bindings** for the `Argocd` agent.

It auto-generates MCP compliant tools or data models and server code.

The server acts as a wrapper over the agent's async call loop and translates standard input/output formats.

---

## 📄 Overview

- **Description**: ArgoCD MCP Server
- **Version**: 0.1.0
- **Author**: Sri Aradhyula

---

## 📁 Module Structure

```
mcp_server/
├── mcp_argocd
│   ├── __init__.py
│   ├── api/
│   │   ├── __init__.py
│   │   └── client.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── base.py
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── api_foo.py
│   └── utils/
│       └── __init__.py
├── pyproject.toml
└── README.md
```

---

## 🚀 Running the MCP Server

Make sure dependencies are installed and environment variables are configured. Then run:

```bash
poetry run mcp_argocd
```

Or directly with Python:

```bash
python -m .protocol_bindings.mcp_server.main
```

---

## 🌐 API Endpoints

- `POST /v1/task` — Submit a task for execution
- `GET  /v1/task/{task_id}` — Query result of a submitted task
- `GET  /v1/spec` — Get OpenAPI spec for tool ingestion

You can test with:

```bash
curl -X POST http://localhost:8000/v1/task \
  -H "Content-Type: application/json" \
  -d '{
    "input": "status of ArgoCD app",
    "agent_id": "",
    "tool_config": {}
  }'
```

---

## ⚙️ Environment Variables

| Variable             | Description                              |
|----------------------|------------------------------------------|
| `_ID`   | Agent identifier used in API requests |
| `_PORT` | Port to run the MCP server (default: 8000) |

---

## 🧰 Available Tools

The following tools are exposed by this agent via the MCP protocol. These are defined in the `tools/` directory and registered at runtime.



---

## 🧪 Testing

To test locally:

```bash
make run-mcp
```

Or with the included MCP client:

```bash
python client/mcp_client.py
```

---

## 📚 References

- [OpenAPI MCP Codegen](https://github.com/cnoe-io/openapi-mcp-codegen)