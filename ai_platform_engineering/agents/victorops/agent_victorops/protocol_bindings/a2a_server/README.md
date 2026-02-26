# VictorOps A2A Server

This directory contains the implementation of the VictorOps agent using the A2A (Agent-to-Agent) protocol.

## Prerequisites

- Python 3.13+
- A2A SDK
- VictorOps API credentials
- LLM API keys (OpenAI, Azure OpenAI, Anthropic Claude, or Google Gemini)

## Environment Variables

The following environment variables are required:

- `VICTOROPS_API_URL`: The VictorOps API URL
- `X_VO_API_KEY`: Your VictorOps API key
- `X_VO_API_ID`: Your VictorOps API ID
- `LLM_PROVIDER`: The LLM provider to use (one of: "azure-openai", "openai", "anthropic-claude", "google-gemini")
- `OPENAI_API_KEY`: API key for OpenAI (if using OpenAI as the LLM provider)
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`: Required for Azure OpenAI
- `ANTHROPIC_API_KEY`: API key for Anthropic Claude (if using Anthropic Claude as the LLM provider)

## Running the A2A Server

To run the A2A server:

```bash
python -m agent_victorops
```

Or using the Makefile from the agent root:

```bash
make run-a2a
```

## Implementation Details

The A2A server implementation consists of several key components:

- `agent.py`: Contains the `VictorOpsAgent` class that extends `BaseLangGraphAgent`
- `agent_executor.py`: Contains the `VictorOpsAgentExecutor` class that extends `BaseLangGraphAgentExecutor`
- `helpers.py`: Provides utility functions for handling agent responses
