# Backstage A2A Server

This directory contains the implementation of the Backstage agent using the A2A (Agent-to-Agent) protocol.

## Prerequisites

- Python 3.9+
- A2A Python SDK
- Backstage.io API token
- LLM API keys (OpenAI, Azure OpenAI, Anthropic Claude, or Google Gemini)

## Environment Variables

The following environment variables are required:

- `BACKSTAGE_API_TOKEN`: Your Backstage API key
- `BACKSTAGE_URL`: The Backstage API URL
- `LLM_PROVIDER`: The LLM provider to use (one of: "azure-openai", "openai", "anthropic-claude", "google-gemini")
- `OPENAI_API_KEY`: API key for OpenAI (if using OpenAI as the LLM provider)
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`: Required for Azure OpenAI
- `ANTHROPIC_API_KEY`: API key for Anthropic Claude (if using Anthropic Claude as the LLM provider)

## Running the A2A Server

To run the A2A server:

```bash
python -m agent_backstage.protocol_bindings.a2a_server
```

Or using the Makefile:

```bash
make run-a2a
```

## Implementation Details

The A2A server implementation consists of several key components:

- `agent.py`: Contains the `BackstageAgent` class that handles interactions with Backstage
- `agent_executor.py`: Contains the `BackstageAgentExecutor` class that handles task execution
- `state.py`: Defines the state models for the agent
- `helpers.py`: Provides utility functions for handling agent responses
- `__main__.py`: The entry point for running the server

## Features

The Backstage A2A server provides the following capabilities:

- Catalog Management: Create, read, update, and delete catalog entities
- Service Management: Manage and query service information
- Documentation Management: Handle documentation and metadata
- Plugin Management: Configure and manage Backstage plugins
- User Management: Handle user-related operations and permissions