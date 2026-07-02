# 🧠 Argocd MCP Server

This module implements the **MCP protocol bindings** for the `Argocd` agent.

It auto-generates MCP compliant tools or data models and server code.

The server acts as a wrapper over the agent's async call loop and translates standard input/output formats.

---

## Setup MCP Server in Streamable HTTP Mode
- Setup UV

```bash
# On macOS and Linux.
curl -LsSf https://astral.sh/uv/install.sh | sh
```
- uv venv
```bash
uv venv && source .venv/bin/activate
```
- uv sync
```bash
uv sync
```
- Copy .env.example to .env
- Setup .env
```bash
BACKSTAGE_API_TOKEN=
BACKSTAGE_URL=
MCP_MODE=http
MCP_HOST=0.0.0.0
MCP_PORT=18000
```

```bash
set -a; source .env; set +a && uv run python mcp_argocd/server.py
```

## MCP Inspector Tool

The **MCP Inspector** is a utility for inspecting and debugging MCP servers. It provides a visual interface to explore generated tools, models, and APIs.

### Installation

To install the MCP Inspector, use the following command:

```bash
npx @modelcontextprotocol/inspector
```

### Usage

Run the inspector in your project directory to analyze the generated MCP server:

```bash
npx @modelcontextprotocol/inspector
```

This will launch a web-based interface where you can:

- Explore available tools and their operations
- Inspect generated models and their schemas
- Test API endpoints directly from the interface

For more details, visit the [MCP Inspector Documentation](https://modelcontextprotocol.io/legacy/tools/inspector).

## 📚 Additional References

- [OpenAPI MCP Codegen](https://github.com/cnoe-io/openapi-mcp-codegen)