# 🤖 GitHub AI Agent

This is a LangGraph-powered Github Agent that interacts with users via Github, executing tasks using MCP tools and large language models. Built for **ACP** and **A2A** protocol support.

# GitHub Agent

A natural language agent for GitHub operations using LangChain, LangGraph, and MCP.

## Setup

1. Install dependencies:
```bash
pip install -e .
```

2. Create a `.env` file with your GitHub token:
```env
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_token
```

## Running the Agent

1. Start the server (choose one):
```bash
# For A2A protocol
make run-a2a

# For ACP protocol
make run-acp
```

2. In a new terminal, run the client:
```bash
# For A2A protocol
make run-a2a-client

# For ACP protocol
make run-acp-client
```

## How it Works

The agent connects to GitHub through the official GitHub MCP server running in Docker. The configuration is in `.vscode/mcp.json`:

```json
{
  "servers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN=${github_token}",
        "ghcr.io/github/github-mcp-server:latest"
      ],
      "transport": "stdio"
    }
  }
}
```

This configuration:
- Uses Docker to run the official GitHub MCP server (`ghcr.io/github/github-mcp-server:latest`)
- Passes your GitHub token to the container
- Uses stdio for communication

## Requirements

- Docker Desktop running
- GitHub Personal Access Token
- Python 3.12+

## License

Apache 2.0

