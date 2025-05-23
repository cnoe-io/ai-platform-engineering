# 🤖 Github AI Agent

This is a LangGraph-powered Github Agent that interacts with users via Github, executing tasks using MCP tools and large language models. Built for **ACP** and **A2A** protocol support.

# GitHub Agent

A natural language agent for GitHub operations using LangChain, LangGraph, and MCP.

## Setup

1. Install dependencies:
```bash
pip install -e .
```

2. Create a `.env` file with your credentials:
```env
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_token
OPENAI_API_KEY=your_openai_key
```

3. Run the agent:
```bash
wfsm deploy -m ./data/agent.json -e .env
```

## Features

- Repository management
- Issue tracking
- Pull request operations
- Code review
- User management
- Security scanning

## Configuration

The agent supports various configuration options through environment variables:

- `GITHUB_PERSONAL_ACCESS_TOKEN`: Your GitHub token
- `GITHUB_HOST`: (Optional) GitHub Enterprise host
- `GITHUB_TOOLSETS`: (Optional) Comma-separated list of enabled toolsets
- `GITHUB_DYNAMIC_TOOLSETS`: (Optional) Enable dynamic toolsets

## Development

1. Install development dependencies:
```bash
pip install -e ".[dev]"
```

2. Run tests:
```bash
pytest
```

## License

Apache 2.0

