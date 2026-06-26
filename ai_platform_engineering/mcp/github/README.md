# GitHub MCP Agent

The GitHub agent is provided by the **external official MCP image**
[`ghcr.io/github/github-mcp-server`](https://github.com/github/github-mcp-server).
There is no local Python package or MCP server in this directory.

## What lives here

- `pyproject.toml` — project metadata only (no runtime dependencies, no
  build target). Kept so the agent is discoverable alongside its peers.
- `Makefile` — self-contained; `run` / `run-mcp` are stubs because there is
  no local server to launch.
- `.vscode/mcp.json` — example VS Code MCP client config that points at
  the external image.

## Running the agent

The agent is launched via the external GitHub MCP image. For example:

```bash
docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<your-github-token> \
  ghcr.io/github/github-mcp-server:latest
```

See the upstream image documentation for the full set of supported
environment variables, scopes, and tools.

## Configuration

Provide a GitHub Personal Access Token (or GitHub App credentials) with
the scopes required for the actions you want the agent to perform.
Set it as `GITHUB_PERSONAL_ACCESS_TOKEN` in the environment of whichever
runtime (Docker, Compose, Helm, etc.) is hosting the MCP image.
