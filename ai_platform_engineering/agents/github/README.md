# 🤖 GitHub AI Agent

This is a LangGraph-powered Github Agent that interacts with users via Github, executing tasks using MCP tools and large language models. Built for **ACP** and **A2A** protocol support.

# GitHub Agent

A powerful GitHub agent that can interact with your repositories, manage issues, and perform various GitHub operations through both ACP (Agent Control Protocol) and A2A (Agent-to-Agent) interfaces.

## Prerequisites

- Python 3.11 or higher
- Docker
- Poetry (Python package manager)
- uv (Python package installer)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/cnoe-io/agent-github.git
cd agent-github
```

2. Install uv:
```bash
make install-uv
```

3. Install A2A SDK:
```bash
make install-a2a
```

4. Install dependencies:
```bash
make install
```

## Environment Setup

Create a `.env` file in the root directory with the following structure:

```env
############################
# GitHub Agent Environment
############################

AGENT_NAME="github"
CNOE_AGENT_GITHUB_ID="your-agent-id"
CNOE_AGENT_GITHUB_API_KEY="your-api-key"
CNOE_AGENT_GITHUB_PORT=10000

############################
# GitHub MCP Tool Auth
############################

GITHUB_PERSONAL_ACCESS_TOKEN="your-github-token"

############################
# A2A Agent Configuration
############################

A2A_AGENT_HOST=localhost
A2A_AGENT_PORT=8000

############################
# MCP Server Configuration
############################

MCP_HOST=localhost
MCP_PORT=9000

############################
# Azure OpenAI Configuration
############################

LLM_PROVIDER=azure-openai
AZURE_OPENAI_API_KEY="your-azure-key"
AZURE_OPENAI_ENDPOINT="your-azure-endpoint"
AZURE_OPENAI_API_VERSION="2025-04-01-preview"
AZURE_OPENAI_DEPLOYMENT="gpt-4.1"

############################
# Google Gemini (Optional)
############################

GOOGLE_API_KEY="your-google-api-key"

############################
# Docker Image Configuration
############################

ACP_AGENT_IMAGE=ghcr.io/cnoe-io/agent-github:acp-latest
A2A_AGENT_IMAGE=ghcr.io/cnoe-io/agent-github:a2a-latest
```

Note: Replace all placeholder values (like `your-github-token`, `your-azure-key`, etc.) with your actual credentials. Never commit the `.env` file to version control.

## Building Docker Images

### ACP Image
```bash
make build-docker-acp
```

### A2A Image
```bash
make build-docker-a2a
```

## Running the Agent

### Local Development

#### ACP Mode
```bash
make run-acp
```

#### A2A Mode
```bash
make run-a2a
```

### Docker Mode

#### ACP Mode
```bash
make run-docker-acp
```

#### A2A Mode
```bash
make run-docker-a2a
```

## Running the Client

### ACP Client
```bash
make run-acp-client
```

### A2A Client
```bash
make run-a2a-client
```

## Example Interactions

### Listing Repositories
```
🧑‍💻 You: list me my repositories
⏳ Waiting for GitHub agent... /

╭────────────────────────── GitHub Agent Response ──────────────────────────╮
│                                                                           │
│  Here are your GitHub repositories:                                       │
│                                                                           │
│   1 OOP: OOPCoursework (Private)                                          │
│   2 EasyAHack: (Public, Language: Rust)                                   │
│   3 desktop-tutorial: GitHub Desktop tutorial repository (Private)        │
│   4 browsy_backend: (Private, Language: Python)                           │
│   5 ai_browser_agent: Contains frontend and backend for AI Agent          │
│     (Private, Language: JavaScript)                                       │
│   6 HackathonDevFolio: (Private, Language: Python)                        │
│   7 slack_mcp_agent: (Public, Language: Python)                           │
│                                                                           │
│  If you need more details about any specific repository, feel free to     │
│  ask!                                                                     │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯
```

### Creating Issues
```
🧑‍💻 You: create an issue in slack_mcp_agent with title "Add new feature" and body "Implement new MCP server functionality"
⏳ Waiting for GitHub agent... /

╭────────────────────────── GitHub Agent Response ──────────────────────────╮
│                                                                           │
│  Issue created successfully!                                              │
│                                                                           │
│  Title: Add new feature                                                   │
│  Repository: slack_mcp_agent                                              │
│  Issue #: 123                                                             │
│  URL: https://github.com/yourusername/slack_mcp_agent/issues/123          │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯
```

### Managing Pull Requests
```
🧑‍💻 You: create a pull request from feature-branch to main in slack_mcp_agent
⏳ Waiting for GitHub agent... /

╭────────────────────────── GitHub Agent Response ──────────────────────────╮
│                                                                           │
│  Pull request created successfully!                                       │
│                                                                           │
│  Title: Feature: Implement new MCP server functionality                    │
│  Repository: slack_mcp_agent                                              │
│  PR #: 45                                                                 │
│  URL: https://github.com/yourusername/slack_mcp_agent/pull/45             │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯
```

## Troubleshooting

### Common Issues

1. **Docker Connection Issues**
   - Ensure Docker is running on your system
   - Check if the Docker socket is properly mounted in the container
   - Verify the Docker socket permissions

2. **Port Conflicts**
   - ACP server runs on port 10000
   - A2A server runs on port 8000
   - MCP server runs on port 9000
   - Ensure these ports are available

3. **Authentication Issues**
   - Verify your GitHub token has the necessary permissions
   - Check if the token is properly set in the `.env` file
   - Ensure Azure OpenAI credentials are correctly configured
   - Verify ArgoCD token and URL if using ArgoCD features

4. **LLM Provider Issues**
   - Check if the correct LLM provider is set (azure-openai)
   - Verify Azure OpenAI deployment name and version
   - Ensure API keys and endpoints are correctly configured

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

